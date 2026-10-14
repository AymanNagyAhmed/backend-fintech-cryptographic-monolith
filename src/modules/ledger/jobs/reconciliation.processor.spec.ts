import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { ReconciliationReport } from '../interfaces/reconciliation-report.interface.js';
import type { ReconciliationService } from '../reconciliation.service.js';
import { ReconciliationProcessor } from './reconciliation.processor.js';

const report = (ok: boolean): ReconciliationReport => ({
  ok,
  startedAt: '2026-10-14T01:00:00.000Z',
  finishedAt: '2026-10-14T01:00:01.000Z',
  checked: { accounts: 2, postings: 1, entries: 2 },
  balanceMismatches: ok
    ? { total: 0, items: [] }
    : {
        total: 1,
        items: [
          {
            accountId: 'a1',
            currency: 'AED',
            cached: '1.00000000',
            computed: '0.00000000',
            difference: '1.00000000',
          },
        ],
      },
  unbalancedPostings: { total: 0, items: [] },
  currencyTotals: [
    {
      currency: 'AED',
      accounts: 2,
      balances: ok ? '0.00000000' : '1.00000000',
      entries: '0.00000000',
      balanced: ok,
    },
  ],
});

describe('ReconciliationProcessor', () => {
  const job = { id: '42' } as Job;
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  const processor = (r: ReconciliationReport | Error) =>
    new ReconciliationProcessor({
      run:
        r instanceof Error
          ? vi.fn().mockRejectedValue(r)
          : vi.fn().mockResolvedValue(r),
    } as unknown as ReconciliationService);

  it('returns the report and logs a summary when it passes', async () => {
    const r = report(true);
    await expect(processor(r).process(job)).resolves.toBe(r);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: '42', balanceMismatches: 0 }),
      'Ledger reconciliation passed',
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('logs the findings as an error but completes the job (no retry)', async () => {
    const r = report(false);
    await expect(processor(r).process(job)).resolves.toBe(r);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        balanceMismatches: 1,
        unbalancedCurrencies: ['AED'],
        balanceMismatchItems: r.balanceMismatches.items,
      }),
      'Ledger reconciliation found mismatches',
    );
  });

  it('fails the job when the database is unreachable, so BullMQ retries it', async () => {
    await expect(
      processor(new Error('connection refused')).process(job),
    ).rejects.toThrow('connection refused');
  });
});
