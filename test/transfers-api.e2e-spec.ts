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
// Wallets are funded with real postings from a clearing account, so balances reconcile.
describe('Transfers API (e2e)', () => {
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
  const newWallet = async (auth: string, currency = 'AED', funds?: string) => {
    const res = await http()
      .post('/v1/wallets')
      .set('Authorization', auth)
      .send({ currency })
      .expect(201);
    const id = res.body.data.id as string;
    if (funds) {
      const { ledgerAccountId } = await prisma.wallet.findUniqueOrThrow({
        where: { id },
      });
      const clearing = await ledger.ensureSystemAccount({
        code: `e2e:${randomUUID()}`,
        currency,
        allowNegative: true,
      });
      await ledger.post({
        ref: `e2e:${randomUUID()}`,
        entries: [
          { accountId: clearing.id, amount: `-${funds}` },
          { accountId: ledgerAccountId, amount: funds },
        ],
      });
    }
    return id;
  };
  const balance = async (auth: string, walletId: string) =>
    (
      await http()
        .get(`/v1/wallets/${walletId}`)
        .set('Authorization', auth)
        .expect(200)
    ).body.data.balance as string;
  const transfer = (
    auth: string,
    body: object,
    key: string | null = randomUUID(),
  ) => {
    const req = http().post('/v1/transfers').set('Authorization', auth);
    return (key === null ? req : req.set('Idempotency-Key', key)).send(body);
  };

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
  });

  // Fresh users per test: each test opens wallets, and a user may hold WALLETS_MAX_PER_USER
  beforeEach(async () => {
    [alice, bob] = await Promise.all([newUserToken(), newUserToken()]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires an access token', async () => {
    await http().post('/v1/transfers').send({}).expect(401);
  });

  it.each([
    ['missing', null],
    ['malformed', 'has space'],
  ])('a %s Idempotency-Key is 400 INVALID_IDEMPOTENCY_KEY', async (_, key) => {
    const from = await newWallet(alice, 'AED', '50.00');
    const to = await newWallet(bob);
    const res = await transfer(
      alice,
      { fromWalletId: from, toWalletId: to, amount: '1.00', currency: 'AED' },
      key,
    ).expect(400);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_IDEMPOTENCY_KEY',
      details: [{ field: 'Idempotency-Key' }],
    });
    expect(await balance(alice, from)).toBe('50.00');
  });

  it('moves money to another user and answers 201 without internal ids', async () => {
    const from = await newWallet(alice, 'AED', '100.00');
    const to = await newWallet(bob);
    const res = await transfer(alice, {
      fromWalletId: from,
      toWalletId: to,
      amount: '12.5',
      currency: 'AED',
    }).expect(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(res.body).toMatchObject({
      success: true,
      statusCode: 201,
      message: 'Transfer completed',
      data: {
        fromWalletId: from,
        toWalletId: to,
        amount: '12.50',
        currency: 'AED',
        status: 'COMPLETED',
      },
    });
    expect(Object.keys(res.body.data as object).sort()).toEqual([
      'amount',
      'createdAt',
      'currency',
      'fromWalletId',
      'id',
      'status',
      'toWalletId',
    ]);
    expect(await balance(alice, from)).toBe('87.50');
    expect(await balance(bob, to)).toBe('12.50');
    const row = await prisma.transfer.findUniqueOrThrow({
      where: { id: res.body.data.id as string },
    });
    expect(row.ref).toMatch(/^transfer:/);
    expect(await prisma.ledgerEntry.count({ where: { ref: row.ref } })).toBe(2);
  });

  it('same request + same key 10 times: money moves once, identical responses (2.10, 2.17)', async () => {
    const from = await newWallet(alice, 'AED', '100.00');
    const to = await newWallet(bob);
    const body = {
      fromWalletId: from,
      toWalletId: to,
      amount: '10.00',
      currency: 'AED',
    };
    const key = randomUUID();
    const responses = [];
    for (let i = 0; i < 10; i++)
      responses.push(await transfer(alice, body, key).expect(201));
    expect(
      new Set(responses.map((r) => JSON.stringify(r.body.data))).size,
    ).toBe(1);
    expect(responses.map((r) => r.headers['idempotent-replayed'])).toEqual([
      undefined,
      ...Array(9).fill('true'),
    ]);
    expect(await balance(alice, from)).toBe('90.00');
    expect(await prisma.transfer.count({ where: { fromWalletId: from } })).toBe(
      1,
    );
  });

  it('20 parallel requests with one key: one transfer, identical responses', async () => {
    const from = await newWallet(alice, 'AED', '100.00');
    const to = await newWallet(bob);
    const body = {
      fromWalletId: from,
      toWalletId: to,
      amount: '10.00',
      currency: 'AED',
    };
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => transfer(alice, body, key)),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(20).fill(201));
    expect(
      new Set(responses.map((r) => JSON.stringify(r.body.data))).size,
    ).toBe(1);
    expect(await balance(alice, from)).toBe('90.00');
    expect(await prisma.transfer.count({ where: { fromWalletId: from } })).toBe(
      1,
    );
  });

  it('100 parallel withdrawals of 10 from 500: exactly 50 succeed, final balance 0 (2.10)', async () => {
    const from = await newWallet(alice, 'AED', '500.00');
    const to = await newWallet(bob);
    const body = {
      fromWalletId: from,
      toWalletId: to,
      amount: '10.00',
      currency: 'AED',
    };
    const responses = await Promise.all(
      Array.from({ length: 100 }, () => transfer(alice, body)),
    );
    const codes = responses.map((r) =>
      r.status === 201 ? 201 : `${r.status} ${r.body.error.code as string}`,
    );
    expect(codes.filter((c) => c === 201)).toHaveLength(50);
    expect(codes.filter((c) => c === '422 INSUFFICIENT_FUNDS')).toHaveLength(
      50,
    );
    expect(await balance(alice, from)).toBe('0.00');
    expect(await balance(bob, to)).toBe('500.00');
  });

  it('the same key with a different body is 422 IDEMPOTENCY_KEY_REUSED and moves nothing', async () => {
    const from = await newWallet(alice, 'AED', '100.00');
    const to = await newWallet(bob);
    const body = {
      fromWalletId: from,
      toWalletId: to,
      amount: '10.00',
      currency: 'AED',
    };
    const key = randomUUID();
    await transfer(alice, body, key).expect(201);
    const res = await transfer(alice, { ...body, amount: '20.00' }, key).expect(
      422,
    );
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await balance(alice, from)).toBe('90.00');
  });

  it("keys are scoped per user: bob's request with alice's key is a new transfer", async () => {
    const [aliceFrom, bobFrom, target] = await Promise.all([
      newWallet(alice, 'AED', '100.00'),
      newWallet(bob, 'AED', '100.00'),
      newWallet(alice),
    ]);
    const key = randomUUID();
    const a = await transfer(
      alice,
      {
        fromWalletId: aliceFrom,
        toWalletId: target,
        amount: '1.00',
        currency: 'AED',
      },
      key,
    ).expect(201);
    const b = await transfer(
      bob,
      {
        fromWalletId: bobFrom,
        toWalletId: target,
        amount: '1.00',
        currency: 'AED',
      },
      key,
    ).expect(201);
    expect(b.headers['idempotent-replayed']).toBeUndefined();
    expect(b.body.data.id).not.toBe(a.body.data.id);
  });

  it('a failed attempt is not stored: the same key succeeds once funds arrive', async () => {
    const from = await newWallet(alice, 'AED', '5.00');
    const to = await newWallet(bob);
    const body = {
      fromWalletId: from,
      toWalletId: to,
      amount: '10.00',
      currency: 'AED',
    };
    const key = randomUUID();
    const first = await transfer(alice, body, key).expect(422);
    expect(first.body.error).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      details: [
        {
          field: 'amount',
          issue: 'Requested amount 10.00 exceeds available balance of 5.00',
        },
      ],
    });
    const { ledgerAccountId } = await prisma.wallet.findUniqueOrThrow({
      where: { id: from },
    });
    const clearing = await ledger.ensureSystemAccount({
      code: `e2e:${randomUUID()}`,
      currency: 'AED',
      allowNegative: true,
    });
    await ledger.post({
      ref: `e2e:${randomUUID()}`,
      entries: [
        { accountId: clearing.id, amount: '-5.00' },
        { accountId: ledgerAccountId, amount: '5.00' },
      ],
    });
    const retry = await transfer(alice, body, key).expect(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(await balance(alice, from)).toBe('0.00');
  });

  describe('rejections', () => {
    let owner: string;
    let other: string;
    let from: string;
    let to: string;
    let bobAed: string;
    let usd: string;

    beforeAll(async () => {
      [owner, other] = await Promise.all([newUserToken(), newUserToken()]);
      [from, to, bobAed, usd] = await Promise.all([
        newWallet(owner, 'AED', '100.00'),
        newWallet(owner),
        newWallet(other, 'AED', '100.00'),
        newWallet(other, 'USD'),
      ]);
    });

    afterAll(async () => {
      expect(await balance(owner, from)).toBe('100.00');
      expect(await balance(other, bobAed)).toBe('100.00');
    });

    const valid = () => ({
      fromWalletId: from,
      toWalletId: to,
      amount: '1.00',
      currency: 'AED',
    });

    it.each([
      ['a JSON number amount', { amount: 1 }],
      ['a negative amount', { amount: '-1.00' }],
      ['a zero amount', { amount: '0.00' }],
      ['a non-UUID wallet id', { toWalletId: 'abc' }],
      ['an unknown field', { fee: '0.00' }],
    ])('400 VALIDATION_FAILED for %s', async (_, change) => {
      const res = await transfer(owner, { ...valid(), ...change }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it.each([
      [
        'another user’s source wallet',
        () => ({ fromWalletId: bobAed }),
        404,
        'WALLET_NOT_FOUND',
        'fromWalletId',
      ],
      [
        'an unknown target wallet',
        () => ({ toWalletId: randomUUID() }),
        404,
        'WALLET_NOT_FOUND',
        'toWalletId',
      ],
      [
        'the same wallet twice',
        () => ({ toWalletId: from }),
        422,
        'INVALID_TRANSFER',
        'toWalletId',
      ],
      [
        'a target in another currency',
        () => ({ toWalletId: usd }),
        422,
        'CURRENCY_MISMATCH',
        'toWalletId',
      ],
      [
        'a currency that differs from the wallets',
        () => ({ currency: 'USD' }),
        422,
        'CURRENCY_MISMATCH',
        'fromWalletId',
      ],
      [
        'an unsupported currency',
        () => ({ currency: 'GBP' }),
        422,
        'UNSUPPORTED_CURRENCY',
        'currency',
      ],
      [
        'more decimals than AED allows',
        () => ({ amount: '1.001' }),
        422,
        'INVALID_AMOUNT',
        undefined,
      ],
      [
        'more than the balance',
        () => ({ amount: '100.01' }),
        422,
        'INSUFFICIENT_FUNDS',
        'amount',
      ],
    ])('%s: %i %s', async (_, change, status, code, field) => {
      const res = await transfer(owner, { ...valid(), ...change() }).expect(
        status,
      );
      expect(res.body.error.code).toBe(code);
      if (field) expect(res.body.error.details[0].field).toBe(field);
    });
  });
});
