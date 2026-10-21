import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { canonicalJsonSha256 } from '../src/common/crypto/canonical-json.js';
import { isCurrency } from '../src/common/money/currency.js';
import { Money } from '../src/common/money/money.js';
import type { EnvironmentVariables } from '../src/config/env.validation.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';
import {
  PROVIDER_EVENTS,
  ProviderEventUnavailable,
  type ProviderEvents,
  type ProviderPayment,
} from '../src/modules/payments/provider-events.js';
import { signWebhookHeaders } from '../src/modules/payments/webhook-signature.js';

/** E2e stand-in for Stripe's event retrieve. A missing row is a failed fetch. */
class ScriptedProviderEvents implements ProviderEvents {
  readonly rows = new Map<string, ProviderPayment | 'fail'>();

  load(provider: 'stripe', eventId: string): Promise<ProviderPayment> {
    const row = this.rows.get(eventId);
    if (!row || row === 'fail' || row.provider !== provider)
      return Promise.reject(new ProviderEventUnavailable());
    return Promise.resolve(row);
  }
}

const providerEvents = new ScriptedProviderEvents();

const PATH = '/v1/webhooks/stripe';

// Needs the Compose PostgreSQL (`make up`) with all migrations applied and Redis.
// app_writer cannot DELETE, so every run uses fresh users, wallets and event ids.
describe('Payment webhooks (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let secret: string;
  const password = 'S3cure!pass-123';
  const http = () => request(app.getHttpServer());

  const newEventId = () => `evt_${randomUUID().replace(/-/g, '')}`;
  /** An event type without an action, for the signature checks. */
  const pingBody = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ id: newEventId(), type: 'test.ping', data: {}, ...over });
  const depositBody = (
    walletId: string,
    amount = '250.00',
    currency = 'AED',
    id = newEventId(),
  ) =>
    JSON.stringify({
      id,
      type: 'payment.succeeded',
      data: { walletId, amount, currency },
    });
  const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /** A valid payment.succeeded with no scripted row is a matching provider record. */
  const rememberMatch = (body: string) => {
    try {
      const parsed = JSON.parse(body) as {
        id?: string;
        type?: string;
        data?: { walletId?: unknown; amount?: unknown; currency?: unknown };
      };
      const data = parsed.data;
      if (
        parsed.type !== 'payment.succeeded' ||
        !parsed.id ||
        !data ||
        providerEvents.rows.has(parsed.id) ||
        typeof data.walletId !== 'string' ||
        !UUID.test(data.walletId) ||
        typeof data.amount !== 'string' ||
        !isCurrency(data.currency)
      )
        return;
      Money.of(data.amount, data.currency);
      providerEvents.rows.set(parsed.id, {
        provider: 'stripe',
        eventId: parsed.id,
        destination: data.walletId,
        amount: data.amount,
        currency: data.currency,
      });
    } catch {
      // Non-JSON or an amount the ledger would refuse: nothing to retrieve.
    }
  };
  const send = (
    body: string,
    headers: Record<string, string> = signWebhookHeaders(secret, body),
    path = PATH,
    contentType = 'application/json',
  ) => {
    rememberMatch(body);
    return http()
      .post(path)
      .set(headers)
      .set('Content-Type', contentType)
      .send(body);
  };

  const newUser = async () => {
    const email = `e2e-${randomUUID()}@example.com`;
    await http()
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    const res = await http()
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return `Bearer ${res.body.data.accessToken as string}`;
  };
  const newWallet = async (auth: string, currency = 'AED') =>
    (
      await http()
        .post('/v1/wallets')
        .set('Authorization', auth)
        .send({ currency })
        .expect(201)
    ).body.data.id as string;
  const balance = async (auth: string, walletId: string) =>
    (
      await http()
        .get(`/v1/wallets/${walletId}`)
        .set('Authorization', auth)
        .expect(200)
    ).body.data.balance as string;
  const entriesOf = (eventId: string) =>
    prisma.ledgerEntry.count({ where: { ref: `webhook:stripe:${eventId}` } });
  const eventIdOf = (body: string) => (JSON.parse(body) as { id: string }).id;
  const storedEvents = (eventId: string) =>
    prisma.webhookEvent.findMany({ where: { provider: 'stripe', eventId } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Limits are covered by rate-limit.e2e-spec.ts
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(PROVIDER_EVENTS)
      .useValue(providerEvents)
      .compile();
    // rawBody as in main.ts: the signature is over the exact bytes sent
    app = moduleRef.createNestApplication<INestApplication<App>>({
      rawBody: true,
      logger: false,
    });
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    secret = app
      .get<ConfigService<EnvironmentVariables, true>>(ConfigService)
      .get('WEBHOOK_SECRET_STRIPE', { infer: true });
  });

  afterAll(() => app.close());

  describe('signature', () => {
    it('answers 200 for a signed event without a Bearer token', async () => {
      const body = pingBody();
      const res = await send(body).expect(200);
      expect(res.body).toMatchObject({
        success: true,
        statusCode: 200,
        message: 'Webhook received',
        data: {
          provider: 'stripe',
          eventId: eventIdOf(body),
          type: 'test.ping',
          status: 'ignored',
        },
      });
    });

    it('allows provider fields the service does not read', async () => {
      await send(pingBody({ object: 'event', livemode: false })).expect(200);
    });

    it('checks the signature over the exact bytes, not the parsed JSON', async () => {
      const body = pingBody();
      const pretty = JSON.stringify(JSON.parse(body), null, 2);
      const res = await send(pretty, signWebhookHeaders(secret, body)).expect(
        400,
      );
      expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    });

    it.each([
      ['a changed event id', (b: string) => b.replace('evt_', 'evt_x')],
      ['a trailing space', (b: string) => `${b} `],
    ])('answers 400 INVALID_WEBHOOK_SIGNATURE for %s', async (_, change) => {
      const body = pingBody();
      const res = await send(change(body), signWebhookHeaders(secret, body));
      expect([res.status, res.body.error.code]).toEqual([
        400,
        'INVALID_WEBHOOK_SIGNATURE',
      ]);
    });

    it('answers 400 for another secret', async () => {
      const body = pingBody();
      const res = await send(body, signWebhookHeaders(`${secret}x`, body));
      expect([res.status, res.body.error.code]).toEqual([
        400,
        'INVALID_WEBHOOK_SIGNATURE',
      ]);
    });

    it.each([301, -301])(
      'answers 400 WEBHOOK_TIMESTAMP_EXPIRED %i seconds off',
      async (offset) => {
        const body = pingBody();
        const ts = String(Math.floor(Date.now() / 1000) - offset);
        const res = await send(body, signWebhookHeaders(secret, body, ts));
        expect([res.status, res.body.error.code]).toEqual([
          400,
          'WEBHOOK_TIMESTAMP_EXPIRED',
        ]);
      },
    );

    it('answers 200 at 290 seconds off', async () => {
      const body = pingBody();
      const ts = String(Math.floor(Date.now() / 1000) - 290);
      await send(body, signWebhookHeaders(secret, body, ts)).expect(200);
    });

    it.each(['x-timestamp', 'x-signature'])(
      'answers 400 WEBHOOK_SIGNATURE_HEADERS_INVALID without %s',
      async (missing) => {
        const body = pingBody();
        const headers = signWebhookHeaders(secret, body);
        delete (headers as Record<string, string>)[missing];
        const res = await send(body, headers).expect(400);
        expect(res.body.error).toMatchObject({
          code: 'WEBHOOK_SIGNATURE_HEADERS_INVALID',
          details: [{ field: missing, issue: 'missing or malformed' }],
        });
      },
    );

    it('checks the signature before the event fields', async () => {
      const res = await send('{"junk":true}', {
        'x-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-signature': '0'.repeat(64),
      }).expect(400);
      expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    });

    it('answers 400 INVALID_WEBHOOK_EVENT for a signed event without the needed fields', async () => {
      const res = await send(
        JSON.stringify({ id: 'evt 1', type: 'test.ping' }),
      ).expect(400);
      expect(res.body.error.code).toBe('INVALID_WEBHOOK_EVENT');
      expect(
        res.body.error.details.map((d: { field: string }) => d.field),
      ).toEqual(['id', 'data']);
    });

    it('answers 400 for a non-JSON body signed as sent', async () => {
      const res = await send('id=evt_1', undefined, PATH, 'text/plain').expect(
        400,
      );
      // No parsed body, so no raw body either: the signature cannot match
      expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    });

    it('answers 404 WEBHOOK_PROVIDER_NOT_FOUND for an unknown provider', async () => {
      const body = pingBody();
      const res = await send(
        body,
        signWebhookHeaders(secret, body),
        '/v1/webhooks/paypal',
      ).expect(404);
      expect(res.body.error.code).toBe('WEBHOOK_PROVIDER_NOT_FOUND');
    });
  });

  describe('deposits (payment.succeeded)', () => {
    let user: string;

    beforeEach(async () => {
      user = await newUser();
    });

    it('does not credit when the provider record shows a different amount', async () => {
      const walletId = await newWallet(user);
      const body = depositBody(walletId, '250.00');
      const id = eventIdOf(body);
      providerEvents.rows.set(id, {
        provider: 'stripe',
        eventId: id,
        destination: walletId,
        amount: '1.00',
        currency: 'AED',
      });
      const res = await send(body).expect(200);
      expect(res.body.data).toMatchObject({
        status: 'rejected',
        reason: { code: 'PROVIDER_MISMATCH' },
      });
      expect(await balance(user, walletId)).toBe('0.00');
      expect(await entriesOf(id)).toBe(0);
      const again = await send(body).expect(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(await balance(user, walletId)).toBe('0.00');
    });

    it('does not credit when the provider event cannot be loaded', async () => {
      const walletId = await newWallet(user);
      const body = depositBody(walletId, '80.00');
      providerEvents.rows.set(eventIdOf(body), 'fail');
      const res = await send(body).expect(200);
      expect(res.body.data.reason.code).toBe('PROVIDER_UNAVAILABLE');
      expect(await balance(user, walletId)).toBe('0.00');
      expect(await entriesOf(eventIdOf(body))).toBe(0);
    });

    it('credits the wallet once and answers the receipt', async () => {
      const walletId = await newWallet(user);
      const body = depositBody(walletId, '250');
      const res = await send(body).expect(200);
      expect(res.headers['idempotent-replayed']).toBeUndefined();
      expect(res.body.data).toEqual({
        provider: 'stripe',
        eventId: eventIdOf(body),
        type: 'payment.succeeded',
        status: 'credited',
        deposit: { walletId, amount: '250.00', currency: 'AED' },
      });
      expect(await balance(user, walletId)).toBe('250.00');
      expect(await entriesOf(eventIdOf(body))).toBe(2);
    });

    it('same event 10 times sequentially and 20 in parallel: one deposit, all 200 (2.17)', async () => {
      const walletId = await newWallet(user);
      const body = depositBody(walletId);
      const sequential = [];
      for (let i = 0; i < 10; i++) sequential.push(await send(body));
      const parallel = await Promise.all(
        Array.from({ length: 20 }, () => send(body)),
      );
      const all = [...sequential, ...parallel];
      expect(all.map((r) => r.status)).toEqual(all.map(() => 200));
      expect(
        all.filter((r) => r.headers['idempotent-replayed'] !== 'true'),
      ).toHaveLength(1);
      expect(new Set(all.map((r) => JSON.stringify(r.body.data))).size).toBe(1);
      expect(await balance(user, walletId)).toBe('250.00');
      expect(await entriesOf(eventIdOf(body))).toBe(2);
      expect(await storedEvents(eventIdOf(body))).toHaveLength(1);
    });

    it('20 parallel first deliveries of one event: one deposit', async () => {
      const walletId = await newWallet(user);
      const body = depositBody(walletId, '7.00');
      const all = await Promise.all(
        Array.from({ length: 20 }, () => send(body)),
      );
      expect(all.every((r) => r.status === 200)).toBe(true);
      expect(await balance(user, walletId)).toBe('7.00');
      expect(await entriesOf(eventIdOf(body))).toBe(2);
    });

    it('crash before COMMIT and redeliver: one deposit', async () => {
      const walletId = await newWallet(user);
      const body = depositBody(walletId, '40.00');
      const realPost = ledger.post.bind(ledger);
      const spy = vi
        .spyOn(ledger, 'post')
        .mockImplementationOnce(async (input, tx) => {
          await realPost(input, tx);
          throw new Error('crash after the posting, before COMMIT');
        });
      try {
        await send(body).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(await entriesOf(eventIdOf(body))).toBe(0);
      expect(await balance(user, walletId)).toBe('0.00');
      expect(await storedEvents(eventIdOf(body))).toHaveLength(0);

      const res = await send(body).expect(200);
      expect(res.body.data.status).toBe('credited');
      expect(res.headers['idempotent-replayed']).toBeUndefined();
      await send(body).expect(200);
      expect(await balance(user, walletId)).toBe('40.00');
      expect(await entriesOf(eventIdOf(body))).toBe(2);
    });

    it('debits the clearing account by the same amount', async () => {
      const walletId = await newWallet(user);
      const clearing = await ledger.ensureSystemAccount({
        code: 'clearing:stripe:aed',
        currency: 'AED',
        allowNegative: true,
      });
      const body = depositBody(walletId, '12.34');
      await send(body).expect(200);
      const entries = await prisma.ledgerEntry.findMany({
        where: { ref: `webhook:stripe:${eventIdOf(body)}` },
        select: { accountId: true, amount: true },
      });
      const amountOf = (clearingSide: boolean) =>
        entries
          .filter((e) => (e.accountId === clearing.id) === clearingSide)
          .map((e) => e.amount.toFixed(2));
      expect(amountOf(true)).toEqual(['-12.34']);
      expect(amountOf(false)).toEqual(['12.34']);
    });

    it('same event id with another body: 422 IDEMPOTENCY_KEY_REUSED, nothing more credited', async () => {
      const walletId = await newWallet(user);
      const id = newEventId();
      await send(depositBody(walletId, '10.00', 'AED', id)).expect(200);
      const res = await send(depositBody(walletId, '99.00', 'AED', id)).expect(
        422,
      );
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await balance(user, walletId)).toBe('10.00');
    });

    describe('rejected: 200, stored, nothing credited', () => {
      const expectRejected = async (body: string, code: string) => {
        const first = await send(body).expect(200);
        expect(first.body.data).toMatchObject({
          status: 'rejected',
          reason: { code },
        });
        const again = await send(body).expect(200);
        expect(again.headers['idempotent-replayed']).toBe('true');
        expect(again.body.data).toEqual(first.body.data);
        expect(
          await prisma.posting.findUnique({
            where: { ref: `webhook:stripe:${eventIdOf(body)}` },
          }),
        ).toBeNull();
        expect(await storedEvents(eventIdOf(body))).toMatchObject([
          {
            outcome: 'rejected',
            reasonCode: code,
            reasonMessage: first.body.data.reason.message,
            reviewStatus: 'pending',
            reviewedAt: null,
          },
        ]);
      };
      const setWalletStatus = (id: string, status: string) =>
        prisma.$executeRaw`
          UPDATE wallet.wallets SET status = ${status}::wallet.wallet_status, updated_at = now()
          WHERE id = ${id}::uuid`;

      it('unknown wallet: WALLET_NOT_FOUND', async () => {
        await expectRejected(depositBody(randomUUID()), 'WALLET_NOT_FOUND');
      });

      it('wallet in another currency: CURRENCY_MISMATCH', async () => {
        const walletId = await newWallet(user, 'USD');
        await expectRejected(depositBody(walletId), 'CURRENCY_MISMATCH');
        expect(await balance(user, walletId)).toBe('0.00');
      });

      it.each([
        ['frozen', 'ACCOUNT_FROZEN'],
        ['closed', 'ACCOUNT_CLOSED'],
      ])('%s wallet: %s', async (status, code) => {
        const walletId = await newWallet(user);
        await setWalletStatus(walletId, status);
        await expectRejected(depositBody(walletId), code);
      });

      it('frozen ledger account behind an active wallet: ACCOUNT_FROZEN, no half posting', async () => {
        const walletId = await newWallet(user);
        const { ledgerAccountId } = await prisma.wallet.findUniqueOrThrow({
          where: { id: walletId },
        });
        await prisma.account.update({
          where: { id: ledgerAccountId },
          data: { status: 'frozen' },
        });
        await expectRejected(depositBody(walletId), 'ACCOUNT_FROZEN');
        await prisma.account.update({
          where: { id: ledgerAccountId },
          data: { status: 'active' },
        });
        expect(await balance(user, walletId)).toBe('0.00');
      });
    });

    it.each([
      ['data.amount', { amount: '1.001' }],
      ['data.amount', { amount: 250 }],
      ['data.walletId', { walletId: 'w1' }],
      ['data.currency', { currency: 'GBP' }],
    ])(
      'a bad %s is 400 INVALID_WEBHOOK_EVENT and not stored',
      async (field, over) => {
        const walletId = await newWallet(user);
        const id = newEventId();
        const bad = JSON.stringify({
          id,
          type: 'payment.succeeded',
          data: { walletId, amount: '5.00', currency: 'AED', ...over },
        });
        const res = await send(bad).expect(400);
        expect(res.body.error).toMatchObject({
          code: 'INVALID_WEBHOOK_EVENT',
          details: [{ field }],
        });
        expect(await storedEvents(id)).toHaveLength(0);
        // Nothing stored under the id: a corrected delivery is processed
        await send(depositBody(walletId, '5.00', 'AED', id)).expect(200);
        expect(await balance(user, walletId)).toBe('5.00');
      },
    );
  });

  describe('payments.webhook_events', () => {
    let user: string;

    beforeEach(async () => {
      user = await newUser();
    });

    it('stores one row per event with the allow-listed payload and the signature time', async () => {
      const walletId = await newWallet(user);
      const id = newEventId();
      const body = JSON.stringify({
        id,
        type: 'payment.succeeded',
        created: 1760464800,
        object: 'event',
        livemode: false,
        data: {
          walletId,
          amount: '3.50',
          currency: 'AED',
          customer: { email: 'alice@example.com' },
          description: 'Order 42',
        },
      });
      const ts = String(Math.floor(Date.now() / 1000) - 60);
      await send(body, signWebhookHeaders(secret, body, ts)).expect(200);
      await send(body).expect(200);
      const rows = await storedEvents(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: 'payment.succeeded',
        outcome: 'credited',
        reasonCode: null,
        requestHash: canonicalJsonSha256(JSON.parse(body)),
        payload: {
          id,
          type: 'payment.succeeded',
          created: 1760464800,
          data: { walletId, amount: '3.50', currency: 'AED' },
        },
        signedAt: new Date(Number(ts) * 1000),
        reviewStatus: null,
      });
      expect(JSON.stringify(rows[0].payload)).not.toMatch(/alice|Order 42/);
    });

    it('stores an ignored event without data', async () => {
      const body = pingBody({ data: { secret: 'x' } });
      await send(body).expect(200);
      expect(await storedEvents(eventIdOf(body))).toMatchObject([
        {
          outcome: 'ignored',
          payload: { id: eventIdOf(body), type: 'test.ping' },
          reviewStatus: null,
        },
      ]);
    });

    describe('redelivery after the idempotency key was purged', () => {
      // Same state as a purged key: the event row exists, the key does not
      const storeWithoutKey = (
        body: string,
        outcome: 'rejected' | 'credited',
      ) =>
        prisma.webhookEvent.create({
          data: {
            provider: 'stripe',
            eventId: eventIdOf(body),
            type: 'payment.succeeded',
            outcome,
            ...(outcome === 'rejected' && {
              reasonCode: 'ACCOUNT_FROZEN',
              reasonMessage: 'The wallet is frozen.',
              reviewStatus: 'pending' as const,
            }),
            requestHash: canonicalJsonSha256(JSON.parse(body)),
            payload: { id: eventIdOf(body), type: 'payment.succeeded' },
            signedAt: new Date(),
          },
        });

      it('answers the stored rejection and never credits the now active wallet', async () => {
        const walletId = await newWallet(user);
        const body = depositBody(walletId, '9.00');
        await storeWithoutKey(body, 'rejected');
        const res = await send(body).expect(200);
        expect(res.body.data).toEqual({
          provider: 'stripe',
          eventId: eventIdOf(body),
          type: 'payment.succeeded',
          status: 'rejected',
          deposit: { walletId, amount: '9.00', currency: 'AED' },
          reason: { code: 'ACCOUNT_FROZEN', message: 'The wallet is frozen.' },
        });
        expect(await balance(user, walletId)).toBe('0.00');
        expect(await entriesOf(eventIdOf(body))).toBe(0);
        expect(await storedEvents(eventIdOf(body))).toHaveLength(1);
      });

      it('answers 422 IDEMPOTENCY_KEY_REUSED for the same event id with another body', async () => {
        const walletId = await newWallet(user);
        const id = newEventId();
        await storeWithoutKey(
          depositBody(walletId, '9.00', 'AED', id),
          'credited',
        );
        const res = await send(depositBody(walletId, '90.00', 'AED', id));
        expect([res.status, res.body.error.code]).toEqual([
          422,
          'IDEMPOTENCY_KEY_REUSED',
        ]);
        expect(await balance(user, walletId)).toBe('0.00');
      });
    });
  });
});
