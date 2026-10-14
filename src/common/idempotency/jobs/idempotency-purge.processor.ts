import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { IdempotencyPurgeService } from '../idempotency-purge.service.js';
import type { IdempotencyPurgeReport } from '../interfaces/idempotency-purge-report.interface.js';
import { IDEMPOTENCY_PURGE_QUEUE } from './idempotency-purge.constants.js';

/** Runs one purge per job; the report is the job's return value. */
@Processor(IDEMPOTENCY_PURGE_QUEUE, { concurrency: 1 })
export class IdempotencyPurgeProcessor extends WorkerHost {
  private readonly logger = new Logger(IdempotencyPurgeProcessor.name);

  constructor(private readonly purge: IdempotencyPurgeService) {
    super();
  }

  async process(job: Job): Promise<IdempotencyPurgeReport> {
    const report = await this.purge.purge();
    const summary = {
      jobId: job.id,
      deleted: report.deleted,
      batches: report.batches,
    };
    if (report.complete)
      this.logger.log(summary, 'Idempotency key purge finished');
    else
      this.logger.warn(
        summary,
        'Idempotency key purge stopped at the batch cap; the next run continues',
      );
    return report;
  }
}
