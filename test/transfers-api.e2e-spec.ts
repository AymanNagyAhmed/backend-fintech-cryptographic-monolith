import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { Money } from '../src/common/money/money.js';
import type { EnvironmentVariables } from '../src/config/env.validation.js';
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
    // Same transaction wrote ledger.outbox (A-B6.4 / A-B9.3); chainer has not claimed yet
    const outbox = await prisma.ledgerOutbox.findMany({
      where: {
        processedAt: null,
        payload: { path: ['transferId'], equals: row.id },
      },
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].payload).toMatchObject({
      type: 'transfer.completed',
      schemaVersion: 1,
      transferId: row.id,
      sourceWalletId: from,
      destinationWalletId: to,
      currency: 'AED',
      amount: '12.50',
    });
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

  describe('frozen and closed wallets', () => {
    const setWalletStatus = (id: string, status: string) =>
      prisma.$executeRaw`
        UPDATE wallet.wallets SET status = ${status}::wallet.wallet_status, updated_at = now()
        WHERE id = ${id}::uuid`;
    const ledgerAccountOf = async (walletId: string) =>
      (await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } }))
        .ledgerAccountId;

    it.each([
      ['source', 'fromWalletId', 'frozen', 'ACCOUNT_FROZEN'],
      ['source', 'fromWalletId', 'closed', 'ACCOUNT_CLOSED'],
      ['target', 'toWalletId', 'frozen', 'ACCOUNT_FROZEN'],
      ['target', 'toWalletId', 'closed', 'ACCOUNT_CLOSED'],
    ])(
      'a %s wallet that is %s: 422 and nothing moves',
      async (_, field, status, code) => {
        const from = await newWallet(alice, 'AED', '50.00');
        const to = await newWallet(bob);
        await setWalletStatus(field === 'fromWalletId' ? from : to, status);
        const res = await transfer(alice, {
          fromWalletId: from,
          toWalletId: to,
          amount: '1.00',
          currency: 'AED',
        }).expect(422);
        expect(res.body.error).toMatchObject({
          code,
          details: [{ field, issue: `wallet is ${status}` }],
        });
        expect(await balance(alice, from)).toBe('50.00');
        expect(await balance(bob, to)).toBe('0.00');
      },
    );

    it('a frozen ledger account behind an active wallet: ACCOUNT_FROZEN without internal ids', async () => {
      const from = await newWallet(alice, 'AED', '50.00');
      const to = await newWallet(bob);
      const accountId = await ledgerAccountOf(to);
      await prisma.account.update({
        where: { id: accountId },
        data: { status: 'frozen' },
      });
      const res = await transfer(alice, {
        fromWalletId: from,
        toWalletId: to,
        amount: '1.00',
        currency: 'AED',
      }).expect(422);
      expect(res.body.error).toMatchObject({
        code: 'ACCOUNT_FROZEN',
        details: [{ field: 'toWalletId', issue: 'wallet is frozen' }],
      });
      expect(JSON.stringify(res.body)).not.toContain(accountId);
      expect(await balance(alice, from)).toBe('50.00');
    });

    it('a failed attempt is not stored: the same key succeeds once the wallet is unfrozen', async () => {
      const from = await newWallet(alice, 'AED', '50.00');
      const to = await newWallet(bob);
      const body = {
        fromWalletId: from,
        toWalletId: to,
        amount: '1.00',
        currency: 'AED',
      };
      const key = randomUUID();
      await setWalletStatus(from, 'frozen');
      await transfer(alice, body, key).expect(422);
      await setWalletStatus(from, 'active');
      const retry = await transfer(alice, body, key).expect(201);
      expect(retry.headers['idempotent-replayed']).toBeUndefined();
    });
  });

  describe('daily limit per source wallet (UTC day)', () => {
    let limit: Money;
    const aed = (amount: string) => Money.of(amount, 'AED');

    beforeAll(() => {
      limit = aed(
        app
          .get(ConfigService<EnvironmentVariables, true>)
          .get('TRANSFER_DAILY_LIMIT_AED', { infer: true }),
      );
    });

    it('allows up to the limit, then 422 DAILY_LIMIT_EXCEEDED; another wallet has its own limit', async () => {
      const from = await newWallet(alice, 'AED', limit.add(limit).toString());
      const other = await newWallet(alice, 'AED', '10.00');
      const to = await newWallet(bob);
      const send = (fromWalletId: string, amount: string) =>
        transfer(alice, {
          fromWalletId,
          toWalletId: to,
          amount,
          currency: 'AED',
        });
      const first = limit.subtract(aed('1.00'));
      await send(from, first.toString()).expect(201);
      const over = await send(from, '2.00').expect(422);
      expect(over.body.error).toMatchObject({
        code: 'DAILY_LIMIT_EXCEEDED',
        details: [
          {
            field: 'amount',
            issue: `Daily limit is ${limit.toString()} AED, ${first.toString()} sent today, 1.00 left`,
          },
        ],
      });
      await send(from, '1.00').expect(201);
      expect((await send(from, '0.01').expect(422)).body.error.code).toBe(
        'DAILY_LIMIT_EXCEEDED',
      );
      await send(other, '10.00').expect(201);
      expect(await balance(alice, from)).toBe(limit.toString());
      expect(await balance(bob, to)).toBe(limit.add(aed('10.00')).toString());
    });

    it('10 parallel transfers of a fifth of the limit: exactly 5 succeed', async () => {
      const fifth = limit.multiply('0.2', 'DOWN');
      const from = await newWallet(
        alice,
        'AED',
        fifth.multiply('10', 'DOWN').toString(),
      );
      const to = await newWallet(bob);
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          transfer(alice, {
            fromWalletId: from,
            toWalletId: to,
            amount: fifth.toString(),
            currency: 'AED',
          }),
        ),
      );
      const codes = responses.map((r) =>
        r.status === 201 ? 201 : `${r.status} ${r.body.error.code as string}`,
      );
      expect(codes.filter((c) => c === 201)).toHaveLength(5);
      expect(
        codes.filter((c) => c === '422 DAILY_LIMIT_EXCEEDED'),
      ).toHaveLength(5);
      expect(await balance(bob, to)).toBe(
        fifth.multiply('5', 'DOWN').toString(),
      );
    });
  });
});
