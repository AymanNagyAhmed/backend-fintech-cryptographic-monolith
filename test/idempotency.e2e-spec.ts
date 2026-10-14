import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { IdempotencyModule } from '../src/common/idempotency/idempotency.module.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { validate } from '../src/config/env.validation.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { LedgerModule } from '../src/modules/ledger/ledger.module.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';

// Needs the Compose PostgreSQL (`make up`) with the A-B6.1 migration. `work` posts a real
// deposit, so "money moved once" is checked in ledger.ledger_entries (2.10, 2.17).
describe('IdempotencyService.runOnce (database)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let idempotency: IdempotencyService;

  const scope = () => `e2e:${randomUUID()}`;
  const request = { amount: '10.00', currency: 'AED' };

  /** A deposit of 10.00 into a new wallet account; counts how often it really runs. */
  const deposit = async () => {
    const [wallet, clearing] = await Promise.all([
      ledger.openWalletAccount('AED'),
      ledger.ensureSystemAccount({
        code: `e2e:${randomUUID()}`,
        currency: 'AED',
        allowNegative: true,
      }),
    ]);
    const ref = `e2e:${randomUUID()}`;
    let runs = 0;
    const work = async (tx: Prisma.TransactionClient) => {
      runs++;
      await ledger.post(
        {
          ref,
          entries: [
            { accountId: clearing.id, amount: '-10.00' },
            { accountId: wallet.id, amount: '10.00' },
          ],
        },
        tx,
      );
      return { ref, amount: '10.00', status: 'COMPLETED' };
    };
    const entries = () => prisma.ledgerEntry.count({ where: { ref } });
    const balance = async () =>
      (await ledger.findById(wallet.id))!.balance.toFixed(2);
    return { work, runs: () => runs, entries, balance, ref };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        DatabaseModule,
        LedgerModule,
        IdempotencyModule,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    ledger = moduleRef.get(LedgerService);
    idempotency = moduleRef.get(IdempotencyService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('same request + same key 10 times: money moves once, identical responses', async () => {
    const d = await deposit();
    const s = scope();
    const key = randomUUID();
    const results = [];
    for (let i = 0; i < 10; i++)
      results.push(
        await idempotency.runOnce(s, key, request, d.work, { statusCode: 201 }),
      );
    expect(d.runs()).toBe(1);
    expect(results.map((r) => r.replayed)).toEqual([
      false,
      ...Array(9).fill(true),
    ]);
    for (const r of results)
      expect({ statusCode: r.statusCode, body: r.body }).toEqual({
        statusCode: 201,
        body: { ref: d.ref, amount: '10.00', status: 'COMPLETED' },
      });
    expect(await d.entries()).toBe(2);
    expect(await d.balance()).toBe('10.00');
  });

  it('20 parallel calls with one key: work runs once, all get the same response', async () => {
    const d = await deposit();
    const s = scope();
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        idempotency.runOnce(s, key, request, d.work, { statusCode: 201 }),
      ),
    );
    expect(d.runs()).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(
      new Set(results.map((r) => JSON.stringify([r.statusCode, r.body]))).size,
    ).toBe(1);
    expect(await d.entries()).toBe(2);
    expect(await d.balance()).toBe('10.00');
  });

  it('the same key with a different request is rejected and moves nothing', async () => {
    const d = await deposit();
    const s = scope();
    const key = randomUUID();
    await idempotency.runOnce(s, key, request, d.work);
    await expect(
      idempotency.runOnce(s, key, { ...request, amount: '99.00' }, d.work),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      statusCode: 422,
    });
    expect(d.runs()).toBe(1);
  });

  it('a crash before COMMIT leaves no key and no money; the retry moves it once', async () => {
    const d = await deposit();
    const s = scope();
    const key = randomUUID();
    await expect(
      idempotency.runOnce(s, key, request, async (tx) => {
        await d.work(tx);
        throw new Error('process died before commit');
      }),
    ).rejects.toThrow(/before commit/);
    expect(await d.entries()).toBe(0);
    expect(
      await prisma.idempotencyKey.findUnique({
        where: { scope_key: { scope: s, key } },
      }),
    ).toBeNull();

    const retry = await idempotency.runOnce(s, key, request, d.work);
    expect(retry.replayed).toBe(false);
    expect(d.runs()).toBe(2);
    expect(await d.entries()).toBe(2);
    expect(await d.balance()).toBe('10.00');
  });

  it('the same key in two scopes runs twice (scopes never share keys)', async () => {
    const [a, b] = await Promise.all([deposit(), deposit()]);
    const key = randomUUID();
    await idempotency.runOnce(scope(), key, request, a.work);
    const second = await idempotency.runOnce(scope(), key, request, b.work);
    expect(second.replayed).toBe(false);
    expect([a.runs(), b.runs()]).toEqual([1, 1]);
  });

  it('stores the status and the JSON result in ledger.idempotency_keys', async () => {
    const d = await deposit();
    const s = scope();
    const key = randomUUID();
    await idempotency.runOnce(s, key, request, d.work, { statusCode: 201 });
    const row = await prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope: s, key } },
    });
    expect(row).toMatchObject({
      statusCode: 201,
      response: { ref: d.ref, amount: '10.00', status: 'COMPLETED' },
    });
    expect(row!.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
