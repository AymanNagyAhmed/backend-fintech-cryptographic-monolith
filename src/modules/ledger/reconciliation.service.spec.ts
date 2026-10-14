import type { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  RECONCILIATION_MAX_ITEMS,
  ReconciliationService,
} from './reconciliation.service.js';

type Rows = Record<string, unknown>[];

describe('ReconciliationService', () => {
  /** Rows per TypedSQL query name, in call order */
  const txWith = (rows: Record<string, Rows>) => ({
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRawTyped: vi.fn((q: { sql: string; values: unknown[] }) => {
      const key = Object.keys(rows).find((k) => q.sql.includes(k));
      return Promise.resolve(key ? rows[key] : []);
    }),
  });
  const clean = {
    'COUNT(*) FROM ledger.accounts) AS accounts': [
      { accounts: 3n, postings: 1n, entries: 2n },
    ],
    'WITH b AS': [
      {
        currency: 'AED',
        accounts: 3n,
        balances: '0.00000000',
        entries: '0.00000000',
      },
    ],
  };
  const run = (rows: Record<string, Rows>) => {
    const tx = txWith(rows);
    const service = new ReconciliationService({} as PrismaService);
    return {
      tx,
      report: service.run(tx as unknown as Prisma.TransactionClient),
    };
  };

  it('is ok with no findings and balanced currencies', async () => {
    const { report, tx } = run(clean);
    expect(await report).toMatchObject({
      ok: true,
      checked: { accounts: 3, postings: 1, entries: 2 },
      balanceMismatches: { total: 0, items: [] },
      unbalancedPostings: { total: 0, items: [] },
      currencyTotals: [{ currency: 'AED', accounts: 3, balanced: true }],
    });
    const limits = tx.$queryRawTyped.mock.calls
      .map(([q]) => q.values)
      .filter((v) => v.length > 0);
    expect(limits).toEqual([
      [RECONCILIATION_MAX_ITEMS],
      [RECONCILIATION_MAX_ITEMS],
    ]);
  });

  it('maps mismatches and counts all of them, not only the listed ones', async () => {
    const { report } = run({
      ...clean,
      'a.balance - s.total': [
        {
          id: 'a1',
          currency: 'AED',
          cached: '10.01000000',
          computed: '10.00000000',
          difference: '0.01000000',
          total: 250n,
        },
      ],
      'FROM ledger.postings p': [
        {
          ref: 'r1',
          entries: 1n,
          currencies: 1n,
          sum: '5.00000000',
          total: 1n,
        },
      ],
    });
    const r = await report;
    expect(r.ok).toBe(false);
    expect(r.balanceMismatches).toEqual({
      total: 250,
      items: [
        {
          accountId: 'a1',
          currency: 'AED',
          cached: '10.01000000',
          computed: '10.00000000',
          difference: '0.01000000',
        },
      ],
    });
    expect(r.unbalancedPostings).toEqual({
      total: 1,
      items: [{ ref: 'r1', entries: 1, currencies: 1, sum: '5.00000000' }],
    });
  });

  it('fails when a currency does not sum to zero', async () => {
    const { report } = run({
      ...clean,
      'WITH b AS': [
        {
          currency: 'AED',
          accounts: 2n,
          balances: '0.00000000',
          entries: '0.00000000',
        },
        {
          currency: 'BTC',
          accounts: 2n,
          balances: '0.00000001',
          entries: '0.00000000',
        },
      ],
    });
    const r = await report;
    expect(r.ok).toBe(false);
    expect(r.currencyTotals.map((t) => [t.currency, t.balanced])).toEqual([
      ['AED', true],
      ['BTC', false],
    ]);
  });

  it('without tx reads one read-only REPEATABLE READ snapshot, no retries', async () => {
    const tx = txWith(clean);
    const withTx = vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    const service = new ReconciliationService({
      withTx,
    } as unknown as PrismaService);
    await service.run();
    expect(withTx).toHaveBeenCalledWith(
      expect.any(Function),
      Prisma.TransactionIsolationLevel.RepeatableRead,
      expect.objectContaining({ retries: 0 }),
    );
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.$executeRaw.mock.calls[0][0].join('')).toBe(
      'SET TRANSACTION READ ONLY',
    );
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRawTyped.mock.invocationCallOrder[0],
    );
  });
});
