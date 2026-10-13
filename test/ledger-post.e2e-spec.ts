import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { validate } from '../src/config/env.validation.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { LedgerModule } from '../src/modules/ledger/ledger.module.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';

// Needs the Compose PostgreSQL (`make up`) with the ledger migrations applied.
// Every committed row comes from LedgerService.post, so cached balances stay equal to the
// sum of entries (A-B5 Done-when) even though app_writer cannot delete test data.
describe('LedgerService.post (database)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  const ref = () => `e2e:${randomUUID()}`;
  const clearing = (currency = 'AED') =>
    ledger.ensureSystemAccount({
      code: `e2e:${randomUUID()}`,
      currency,
      allowNegative: true,
    });
  const move = (from: string, to: string, amount: string, r = ref()) =>
    ledger.post({
      ref: r,
      entries: [
        { accountId: from, amount: `-${amount}` },
        { accountId: to, amount },
      ],
    });
  const balance = async (id: string) =>
    (await ledger.findById(id))!.balance.toFixed(2);
  /** A wallet account funded from a clearing account */
  const funded = async (amount: string) => {
    const [source, wallet] = await Promise.all([
      clearing(),
      ledger.openWalletAccount('AED'),
    ]);
    await move(source.id, wallet.id, amount);
    return wallet;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        DatabaseModule,
        LedgerModule,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    ledger = moduleRef.get(LedgerService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('posts a deposit: entries with seq, both balances updated', async () => {
    const [source, wallet] = await Promise.all([
      clearing(),
      ledger.openWalletAccount('AED'),
    ]);
    const r = ref();
    const result = await move(source.id, wallet.id, '1500.00', r);
    expect(result).toMatchObject({ ref: r, currency: 'AED' });
    expect(result.entries).toHaveLength(2);
    expect(typeof result.entries[0].seq).toBe('bigint');
    expect(await balance(wallet.id)).toBe('1500.00');
    expect(await balance(source.id)).toBe('-1500.00');
    const posting = await prisma.posting.findUnique({ where: { ref: r } });
    expect(posting).not.toBeNull();
  });

  it('INSUFFICIENT_FUNDS leaves no posting, entries or balance change', async () => {
    const wallet = await funded('100.00');
    const sink = await ledger.openWalletAccount('AED');
    const r = ref();
    await expect(move(wallet.id, sink.id, '100.01', r)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      details: [
        {
          issue: 'Requested amount 100.01 exceeds available balance of 100.00',
        },
      ],
    });
    expect(await balance(wallet.id)).toBe('100.00');
    await expect(
      prisma.posting.findUnique({ where: { ref: r } }),
    ).resolves.toBeNull();
    await expect(prisma.ledgerEntry.count({ where: { ref: r } })).resolves.toBe(
      0,
    );
  });

  it('a ref posts once (POSTING_EXISTS), also when two posts race', async () => {
    const wallet = await funded('50.00');
    const sink = await ledger.openWalletAccount('AED');
    const r = ref();
    await move(wallet.id, sink.id, '1.00', r);
    await expect(move(wallet.id, sink.id, '1.00', r)).rejects.toMatchObject({
      code: 'POSTING_EXISTS',
      statusCode: 409,
    });

    const raced = ref();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => move(wallet.id, sink.id, '1.00', raced)),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await balance(wallet.id)).toBe('48.00');
  });

  it('rejects other currencies, frozen accounts and too many decimals', async () => {
    const wallet = await funded('10.00');
    const usd = await ledger.openWalletAccount('USD');
    await expect(move(wallet.id, usd.id, '1.00')).rejects.toMatchObject({
      code: 'CURRENCY_MISMATCH',
    });
    await expect(
      move(wallet.id, (await ledger.openWalletAccount('AED')).id, '0.005'),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });

    const frozen = await ledger.openWalletAccount('AED');
    await prisma.account.update({
      where: { id: frozen.id },
      data: { status: 'frozen' },
    });
    await expect(move(wallet.id, frozen.id, '1.00')).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_ACTIVE',
    });
    await expect(move(wallet.id, randomUUID(), '1.00')).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
    });
    expect(await balance(wallet.id)).toBe('10.00');
  });

  it('commits or rolls back with the caller transaction', async () => {
    const wallet = await funded('20.00');
    const sink = await ledger.openWalletAccount('AED');
    const r = ref();
    await expect(
      prisma.$transaction(async (tx) => {
        await ledger.post(
          {
            ref: r,
            entries: [
              { accountId: wallet.id, amount: '-5.00' },
              { accountId: sink.id, amount: '5.00' },
            ],
          },
          tx,
        );
        throw new Error('caller fails after posting');
      }),
    ).rejects.toThrow('caller fails after posting');
    expect(await balance(wallet.id)).toBe('20.00');
    await expect(
      prisma.posting.findUnique({ where: { ref: r } }),
    ).resolves.toBeNull();
  });

  it('2.10: 100 parallel withdrawals of 10 from 500 -> exactly 50 succeed, never negative', async () => {
    const wallet = await funded('500.00');
    const sink = await ledger.openWalletAccount('AED');
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () => move(wallet.id, sink.id, '10.00')),
    );
    const ok = results.filter((x) => x.status === 'fulfilled');
    const failed = results.filter(
      (x): x is PromiseRejectedResult => x.status === 'rejected',
    );
    expect(ok).toHaveLength(50);
    expect(
      new Set(failed.map((f) => (f.reason as { code: string }).code)),
    ).toEqual(new Set(['INSUFFICIENT_FUNDS']));
    expect(await balance(wallet.id)).toBe('0.00');
    expect(await balance(sink.id)).toBe('500.00');
  });

  it('opposite transfers between two accounts at once do not deadlock', async () => {
    const [a, b] = await Promise.all([funded('100.00'), funded('100.00')]);
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) =>
        i % 2 ? move(a.id, b.id, '1.00') : move(b.id, a.id, '1.00'),
      ),
    );
    expect(results.filter((x) => x.status === 'rejected')).toEqual([]);
    expect(await balance(a.id)).toBe('100.00');
    expect(await balance(b.id)).toBe('100.00');
  });

  it('cached balances equal the sum of entries for every account', async () => {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM ledger.accounts a
      LEFT JOIN ledger.ledger_entries e ON e.account_id = a.id
      GROUP BY a.id, a.balance
      HAVING a.balance <> COALESCE(SUM(e.amount), 0)`;
    expect(rows).toEqual([]);
  });

  it('postings are append-only for app_writer', async () => {
    await expect(
      prisma.$executeRaw`DELETE FROM ledger.postings WHERE false`,
    ).rejects.toThrow(/permission denied/);
    await expect(
      prisma.$executeRaw`UPDATE ledger.postings SET ref = ref WHERE false`,
    ).rejects.toThrow(/permission denied/);
  });
});
