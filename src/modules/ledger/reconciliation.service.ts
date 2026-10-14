import { Injectable } from '@nestjs/common';
import { Decimal } from '../../common/money/decimal.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  findBalanceMismatches,
  findUnbalancedPostings,
  getCurrencyTotals,
  getLedgerCounts,
} from '../../generated/prisma/sql.js';
import type {
  CurrencyTotal,
  ReconciliationReport,
} from './interfaces/reconciliation-report.interface.js';

/** Findings listed per check; the report still counts all of them. */
export const RECONCILIATION_MAX_ITEMS = 100;

// Full scans of the ledger; far above the 10 s default of withTx
const RECONCILIATION_TIMEOUT_MS = 10 * 60_000;

const count = (n: bigint | null) => Number(n ?? 0);

/**
 * Checks the ledger against itself, read-only: every cached balance equals the sum of its
 * entries, every posting is a balanced single-currency double entry, and per currency all
 * balances and all entries sum to 0. The database already refuses unbalanced postings at
 * commit; this also catches a balance changed outside LedgerService.post, a restore from a
 * broken backup, or a migration that touched the rows.
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Without `tx` all checks read one REPEATABLE READ snapshot, so postings committed during
   * the run cannot show up as false mismatches.
   */
  run(tx?: Prisma.TransactionClient): Promise<ReconciliationReport> {
    if (tx) return this.runIn(tx);
    return this.prisma.withTx(
      async (t) => {
        await t.$executeRaw`SET TRANSACTION READ ONLY`;
        return this.runIn(t);
      },
      Prisma.TransactionIsolationLevel.RepeatableRead,
      { timeoutMs: RECONCILIATION_TIMEOUT_MS, retries: 0 },
    );
  }

  private async runIn(
    tx: Prisma.TransactionClient,
  ): Promise<ReconciliationReport> {
    const startedAt = new Date().toISOString();
    const [counts] = await tx.$queryRawTyped(getLedgerCounts());
    const mismatches = await tx.$queryRawTyped(
      findBalanceMismatches(RECONCILIATION_MAX_ITEMS),
    );
    const unbalanced = await tx.$queryRawTyped(
      findUnbalancedPostings(RECONCILIATION_MAX_ITEMS),
    );
    const totals = await tx.$queryRawTyped(getCurrencyTotals());

    const currencyTotals: CurrencyTotal[] = totals.map((t) => ({
      currency: t.currency,
      accounts: count(t.accounts),
      balances: t.balances ?? '0',
      entries: t.entries ?? '0',
      balanced:
        new Decimal(t.balances ?? 0).isZero() &&
        new Decimal(t.entries ?? 0).isZero(),
    }));
    const report: Omit<ReconciliationReport, 'ok'> = {
      startedAt,
      finishedAt: new Date().toISOString(),
      checked: {
        accounts: count(counts.accounts),
        postings: count(counts.postings),
        entries: count(counts.entries),
      },
      balanceMismatches: {
        total: count(mismatches[0]?.total ?? null),
        items: mismatches.map((m) => ({
          accountId: m.id,
          currency: m.currency,
          cached: m.cached ?? '0',
          computed: m.computed ?? '0',
          difference: m.difference ?? '0',
        })),
      },
      unbalancedPostings: {
        total: count(unbalanced[0]?.total ?? null),
        items: unbalanced.map((p) => ({
          ref: p.ref,
          entries: count(p.entries),
          currencies: count(p.currencies),
          sum: p.sum ?? '0',
        })),
      },
      currencyTotals,
    };
    return {
      ok:
        report.balanceMismatches.total === 0 &&
        report.unbalancedPostings.total === 0 &&
        currencyTotals.every((t) => t.balanced),
      ...report,
    };
  }
}
