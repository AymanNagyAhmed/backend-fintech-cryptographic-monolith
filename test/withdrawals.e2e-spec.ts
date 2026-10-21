import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import type { EnvironmentVariables } from '../src/config/env.validation.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { hotp, totpStep } from '../src/modules/auth/totp/totp.js';
import { signWebhookHeaders } from '../src/modules/payments/webhook-signature.js';

const base32Decode = (s: string) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

describe('Withdrawals payout (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let secret: string;
  const password = 'S3cure!pass-123';
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({
      rawBody: true,
      logger: false,
    });
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    secret = app
      .get<ConfigService<EnvironmentVariables, true>>(ConfigService)
      .get('WEBHOOK_SECRET_STRIPE', { infer: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('each payout needs a fresh code, and a reused code does not move money', async () => {
    const now = { t: Date.now() };
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now.t);
    try {
      const email = `e2e-${randomUUID()}@example.com`;
      await http()
        .post('/v1/auth/register')
        .send({ email, password })
        .expect(201);
      const login = await http()
        .post('/v1/auth/login')
        .send({ email, password })
        .expect(200);
      const access = login.body.data.accessToken as string;

      const setup = await http()
        .post('/v1/auth/totp/setup')
        .set(bearer(access))
        .expect(200);
      const key = base32Decode(setup.body.data.secret);
      const codeAt = (stepsAhead: number) =>
        hotp(key, totpStep(now.t) + stepsAhead);
      await http()
        .post('/v1/auth/totp/enable')
        .set(bearer(access))
        .send({ code: codeAt(0) })
        .expect(200);

      const wallet = await http()
        .post('/v1/wallets')
        .set(bearer(access))
        .send({ currency: 'AED' })
        .expect(201);
      const walletId = wallet.body.data.id as string;

      const created = await http()
        .post('/v1/withdrawals/beneficiaries')
        .set(bearer(access))
        .send({
          label: 'Bank',
          currency: 'AED',
          address: 'AE070331234567890123456',
          network: 'bank_aed',
        })
        .expect(201);
      const beneficiaryId = created.body.data.id as string;
      now.t += 30_000;
      await http()
        .post(`/v1/withdrawals/beneficiaries/${beneficiaryId}/confirm`)
        .set(bearer(access))
        .send({ totpCode: codeAt(0) })
        .expect(201);
      const stored = await prisma.beneficiary.findUniqueOrThrow({
        where: { id: beneficiaryId },
      });
      await prisma.beneficiary.update({
        where: { id: beneficiaryId },
        data: { activeAt: stored.confirmedAt ?? new Date(now.t) },
      });

      const deposit = JSON.stringify({
        id: `evt_${randomUUID().replace(/-/g, '')}`,
        type: 'payment.succeeded',
        data: { walletId, amount: '100.00', currency: 'AED' },
      });
      await http()
        .post('/v1/webhooks/stripe')
        .set(signWebhookHeaders(secret, deposit))
        .set('Content-Type', 'application/json')
        .send(deposit)
        .expect(200);

      const balance = async () =>
        (
          await http()
            .get(`/v1/wallets/${walletId}`)
            .set(bearer(access))
            .expect(200)
        ).body.data.balance as string;
      expect(await balance()).toBe('100.00');

      now.t += 30_000;
      const firstCode = codeAt(0);
      const paid = await http()
        .post('/v1/withdrawals')
        .set(bearer(access))
        .set('Idempotency-Key', randomUUID())
        .send({
          walletId,
          beneficiaryId,
          amount: '10.00',
          currency: 'AED',
          totpCode: firstCode,
        })
        .expect(201);
      expect(paid.body.data.amount).toBe('10.00');
      expect(await balance()).toBe('90.00');

      const entries = () =>
        prisma.ledgerEntry.count({
          where: { ref: paid.body.data.id as string },
        });
      expect(await entries()).toBe(2);

      const reused = await http()
        .post('/v1/withdrawals')
        .set(bearer(access))
        .set('Idempotency-Key', randomUUID())
        .send({
          walletId,
          beneficiaryId,
          amount: '10.00',
          currency: 'AED',
          totpCode: firstCode,
        })
        .expect(422);
      expect(reused.body.error.code).toBe('INVALID_TOTP');
      expect(await balance()).toBe('90.00');
      expect(await entries()).toBe(2);

      now.t += 30_000;
      const second = await http()
        .post('/v1/withdrawals')
        .set(bearer(access))
        .set('Idempotency-Key', randomUUID())
        .send({
          walletId,
          beneficiaryId,
          amount: '10.00',
          currency: 'AED',
          totpCode: codeAt(0),
        })
        .expect(201);
      expect(second.body.data.id).not.toBe(paid.body.data.id);
      expect(await balance()).toBe('80.00');
    } finally {
      clock.mockRestore();
    }
  });
});
