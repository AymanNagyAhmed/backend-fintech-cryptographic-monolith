import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { QueueEvents, type Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { QueueModule } from '../src/common/queue/queue.module.js';
import {
  validate,
  type EnvironmentVariables,
} from '../src/config/env.validation.js';
import { queueOptions } from '../src/config/queue.config.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import type { ReconciliationReport } from '../src/modules/ledger/interfaces/reconciliation-report.interface.js';
import { LedgerJobsModule } from '../src/modules/ledger/jobs/ledger-jobs.module.js';
import {
  RECONCILIATION_JOB,
  RECONCILIATION_QUEUE,
  RECONCILIATION_SCHEDULER_ID,
} from '../src/modules/ledger/jobs/reconciliation.constants.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';
import { ReconciliationService } from '../src/modules/ledger/reconciliation.service.js';

// Needs the Compose PostgreSQL and Redis (`make up`). Broken rows are written inside a
// transaction that is rolled back, so the dev database stays reconciled.
describe('Ledger reconciliation (database + queue)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let reconciliation: ReconciliationService;

  class Rollback extends Error {}
  /** Runs `fn` in a transaction that never commits and returns its result. */
  const inRolledBackTx = async <T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> => {
    let result: T | undefined;
    await prisma
      .withTx(async (tx) => {
        result = await fn(tx);
        throw new Rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
      });
    return result!;
  };

  const fundedWallet = async (amount: string) => {
    const [source, wallet] = await Promise.all([
      ledger.ensureSystemAccount({
        code: `e2e:${randomUUID()}`,
        currency: 'AED',
        allowNegative: true,
      }),
      ledger.openWalletAccount('AED'),
    ]);
    await ledger.post({
      ref: `e2e:${randomUUID()}`,
      entries: [
        { accountId: source.id, amount: `-${amount}` },
        { accountId: wallet.id, amount },
      ],
    });
    return wallet;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        DatabaseModule,
        QueueModule,
        LedgerJobsModule,
      ],
    }).compile();
    // init() starts the worker and registers the scheduler
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    ledger = moduleRef.get(LedgerService);
    reconciliation = moduleRef.get(ReconciliationService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('reports no mismatches when every balance came from LedgerService.post', async () => {
    await fundedWallet('25.00');
    const report = await reconciliation.run();
    expect(report.ok).toBe(true);
    expect(report.balanceMismatches).toEqual({ total: 0, items: [] });
    expect(report.unbalancedPostings).toEqual({ total: 0, items: [] });
    expect(report.checked.accounts).toBeGreaterThanOrEqual(2);
    const aed = report.currencyTotals.find((t) => t.currency === 'AED');
    expect(aed).toMatchObject({
      balances: '0.00000000',
      entries: '0.00000000',
      balanced: true,
    });
  });

  it('SET TRANSACTION READ ONLY takes effect as the first statement of a Prisma transaction', async () => {
    const [setting] = await prisma.withTx(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return tx.$queryRaw<{ ro: string; iso: string }[]>`
          SELECT current_setting('transaction_read_only') AS ro,
                 current_setting('transaction_isolation') AS iso`;
    }, Prisma.TransactionIsolationLevel.RepeatableRead);
    expect(setting).toEqual({ ro: 'on', iso: 'repeatable read' });
  });

  it('finds a cached balance changed outside LedgerService.post', async () => {
    const wallet = await fundedWallet('10.00');
    const report = await inRolledBackTx(async (tx) => {
      await tx.$executeRaw`
        UPDATE ledger.accounts SET balance = balance + 0.01 WHERE id = ${wallet.id}::uuid`;
      return reconciliation.run(tx);
    });
    expect(report.ok).toBe(false);
    expect(report.balanceMismatches.total).toBe(1);
    expect(report.balanceMismatches.items).toEqual([
      {
        accountId: wallet.id,
        currency: 'AED',
        cached: '10.01000000',
        computed: '10.00000000',
        difference: '0.01000000',
      },
    ]);
    expect(
      report.currencyTotals.find((t) => t.currency === 'AED'),
    ).toMatchObject({ balances: '0.01000000', balanced: false });
    expect((await ledger.findById(wallet.id))!.balance.toFixed(2)).toBe(
      '10.00',
    );
  });

  it('finds a one-sided posting before the commit-time check would reject it', async () => {
    const wallet = await fundedWallet('10.00');
    const ref = `e2e:${randomUUID()}`;
    const report = await inRolledBackTx(async (tx) => {
      await tx.posting.create({ data: { ref } });
      await tx.ledgerEntry.create({
        data: { accountId: wallet.id, amount: '5', currency: 'AED', ref },
      });
      return reconciliation.run(tx);
    });
    expect(report.ok).toBe(false);
    expect(report.unbalancedPostings.items).toContainEqual({
      ref,
      entries: 1,
      currencies: 1,
      sum: '5.00000000',
    });
    // The cached balance did not move, so the account is off by the entry too
    expect(report.balanceMismatches.items).toContainEqual(
      expect.objectContaining({
        accountId: wallet.id,
        difference: '-5.00000000',
      }),
    );
  });

  it('registers the nightly scheduler and processes a job through the worker', async () => {
    const config =
      moduleRef.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    const queue = moduleRef.get<Queue>(getQueueToken(RECONCILIATION_QUEUE));
    await vi.waitFor(
      async () =>
        expect(
          await queue.getJobScheduler(RECONCILIATION_SCHEDULER_ID),
        ).toMatchObject({
          pattern: config.get('RECONCILIATION_CRON', { infer: true }),
          tz: 'UTC',
        }),
      { timeout: 5_000 },
    );

    const events = new QueueEvents(
      RECONCILIATION_QUEUE,
      queueOptions(config.get('REDIS_URL', { infer: true })),
    );
    try {
      await events.waitUntilReady();
      const job = await queue.add(RECONCILIATION_JOB, {});
      const result = (await job.waitUntilFinished(
        events,
        30_000,
      )) as ReconciliationReport;
      expect(result.ok).toBe(true);
      expect(result.checked.postings).toBeGreaterThan(0);
    } finally {
      await events.close();
    }
  });
});
