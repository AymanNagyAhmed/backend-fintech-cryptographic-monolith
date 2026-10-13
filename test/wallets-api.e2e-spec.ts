import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';

// Needs the Compose PostgreSQL (`make up`) with all migrations applied.
// app_writer cannot DELETE, so every run uses fresh users and leaves its rows behind.
describe('Wallets API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ledger: LedgerService;
  const password = 'S3cure!pass-123';
  const http = () => request(app.getHttpServer());

  const newUserToken = async () => {
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
  const createWallet = (auth: string, body: object) =>
    http().post('/v1/wallets').set('Authorization', auth).send(body);

  let alice: string;
  let bob: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Every request comes from 127.0.0.1; limits are covered by rate-limit.e2e-spec.ts
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    [alice, bob] = await Promise.all([newUserToken(), newUserToken()]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires an access token', async () => {
    const res = await http().get('/v1/wallets').expect(401);
    expect(res.body).toMatchObject({ success: false, statusCode: 401 });
  });

  it('POST creates a wallet with a zero balance string and no internal ids', async () => {
    const res = await createWallet(alice, {
      currency: 'BTC',
      label: '  Cold storage ',
    }).expect(201);
    expect(res.body).toMatchObject({
      success: true,
      statusCode: 201,
      message: 'Wallet created',
      data: {
        currency: 'BTC',
        label: 'Cold storage',
        status: 'active',
        balance: '0.00000000',
      },
    });
    expect(res.body.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(res.body.data).not.toHaveProperty('ownerUserId');
    expect(res.body.data).not.toHaveProperty('ledgerAccountId');

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { id: res.body.data.id as string },
    });
    await expect(
      ledger.findById(wallet.ledgerAccountId),
    ).resolves.toMatchObject({ currency: 'BTC', kind: 'wallet' });
  });

  it('POST rejects bad input with the right codes', async () => {
    const gbp = await createWallet(alice, { currency: 'GBP' }).expect(422);
    expect(gbp.body.error.code).toBe('UNSUPPORTED_CURRENCY');
    const label = await createWallet(alice, {
      currency: 'AED',
      label: 'a\nb',
    }).expect(422);
    expect(label.body.error.code).toBe('INVALID_LABEL');
    const extra = await createWallet(alice, {
      currency: 'AED',
      balance: '1000.00',
    }).expect(400);
    expect(extra.body.error.code).toBe('VALIDATION_FAILED');
    await createWallet(alice, {}).expect(400);
  });

  it('GET /wallets pages through the caller wallets only, by cursor', async () => {
    const carol = await newUserToken();
    const created: string[] = [];
    for (const currency of ['AED', 'AED', 'USD', 'EUR', 'BTC'])
      created.push(
        (await createWallet(carol, { currency }).expect(201)).body.data
          .id as string,
      );
    await createWallet(bob, { currency: 'AED' }).expect(201);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await http()
        .get('/v1/wallets')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .set('Authorization', carol)
        .expect(200);
      expect(res.body.data.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.data.items.map((w: { id: string }) => w.id));
      cursor = res.body.data.nextCursor as string | null;
    } while (cursor);
    expect(seen).toEqual(created);

    const dave = await newUserToken();
    const empty = await http()
      .get('/v1/wallets')
      .set('Authorization', dave)
      .expect(200);
    expect(empty.body.data).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    [{ limit: 0 }],
    [{ limit: 101 }],
    [{ limit: 'ten' }],
    [{ cursor: 'not-a-uuid' }],
  ])('GET /wallets rejects the query %o', async (query) => {
    const res = await http()
      .get('/v1/wallets')
      .query(query)
      .set('Authorization', alice)
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('GET /wallets/:id shows the ledger balance and hides other users wallets', async () => {
    const { id } = (await createWallet(alice, { currency: 'AED' }).expect(201))
      .body.data as { id: string };
    const { ledgerAccountId } = await prisma.wallet.findUniqueOrThrow({
      where: { id },
    });
    const clearing = await ledger.ensureSystemAccount({
      code: 'e2e_clearing:aed',
      currency: 'AED',
      allowNegative: true,
    });
    await ledger.post({
      ref: `e2e-deposit-${randomUUID()}`,
      entries: [
        { accountId: ledgerAccountId, amount: '12.5' },
        { accountId: clearing.id, amount: '-12.5' },
      ],
    });

    const res = await http()
      .get(`/v1/wallets/${id}`)
      .set('Authorization', alice)
      .expect(200);
    expect(res.body.data).toMatchObject({ id, balance: '12.50' });

    const other = await http()
      .get(`/v1/wallets/${id}`)
      .set('Authorization', bob)
      .expect(404);
    expect(other.body.error.code).toBe('WALLET_NOT_FOUND');
    await http()
      .get(`/v1/wallets/${randomUUID()}`)
      .set('Authorization', alice)
      .expect(404);
    const bad = await http()
      .get('/v1/wallets/123')
      .set('Authorization', alice)
      .expect(400);
    expect(bad.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'id', issue: 'id must be a UUID' }],
    });
  });

  it('PATCH /wallets/:id sets and clears the label; checks owner, input and status', async () => {
    const { id } = (await createWallet(alice, { currency: 'USD' }).expect(201))
      .body.data as { id: string };
    const patch = (auth: string, body: object, walletId = id) =>
      http()
        .patch(`/v1/wallets/${walletId}`)
        .set('Authorization', auth)
        .send(body);

    const renamed = await patch(alice, { label: ' Travel ' }).expect(200);
    expect(renamed.body).toMatchObject({
      message: 'Wallet updated',
      data: { id, label: 'Travel', balance: '0.00' },
    });
    await expect(
      patch(alice, { label: null }).expect(200),
    ).resolves.toMatchObject({ body: { data: { label: null } } });

    expect((await patch(alice, {}).expect(400)).body.error.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (await patch(alice, { label: 'x'.repeat(51) }).expect(422)).body.error
        .code,
    ).toBe('INVALID_LABEL');
    expect(
      (await patch(bob, { label: 'Mine now' }).expect(404)).body.error.code,
    ).toBe('WALLET_NOT_FOUND');

    await prisma.$executeRaw`
      UPDATE wallet.wallets SET status = 'closed' WHERE id = ${id}::uuid`;
    expect(
      (await patch(alice, { label: 'Late' }).expect(409)).body.error.code,
    ).toBe('WALLET_CLOSED');
  });
});
