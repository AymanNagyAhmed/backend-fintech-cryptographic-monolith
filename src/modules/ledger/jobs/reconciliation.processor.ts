import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { ReconciliationReport } from '../interfaces/reconciliation-report.interface.js';
import { ReconciliationService } from '../reconciliation.service.js';
import { RECONCILIATION_QUEUE } from './reconciliation.constants.js';

/** Runs one reconciliation per job; the report is the job's return value. */
@Processor(RECONCILIATION_QUEUE, { concurrency: 1 })
export class ReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconciliationProcessor.name);

  constructor(private readonly reconciliation: ReconciliationService) {
    super();
  }

  async process(job: Job): Promise<ReconciliationReport> {
    const report = await this.reconciliation.run();
    const summary = {
      jobId: job.id,
      checked: report.checked,
      balanceMismatches: report.balanceMismatches.total,
      unbalancedPostings: report.unbalancedPostings.total,
      unbalancedCurrencies: report.currencyTotals
        .filter((t) => !t.balanced)
        .map((t) => t.currency),
    };
    if (report.ok) this.logger.log(summary, 'Ledger reconciliation passed');
    else
      this.logger.error(
        {
          ...summary,
          balanceMismatchItems: report.balanceMismatches.items,
          unbalancedPostingItems: report.unbalancedPostings.items,
        },
        'Ledger reconciliation found mismatches',
      );
    return report;
  }
}
