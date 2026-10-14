import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { purgeIdempotencyKeys } from '../../generated/prisma/sql.js';
import type { IdempotencyPurgeReport } from './interfaces/idempotency-purge-report.interface.js';

/** The database function refuses anything shorter. */
export const IDEMPOTENCY_RETENTION_DAYS = 30;

export interface PurgeOptions {
  /** Rows per call of ledger.purge_idempotency_keys (1-10000) */
  batchSize?: number;
  /** Caps one run; what is left goes in the next run */
  maxBatches?: number;
}

/**
 * Deletes idempotency keys older than IDEMPOTENCY_RETENTION_DAYS through the SECURITY DEFINER
 * function (app_writer has no DELETE). Each batch is its own short transaction, so requests
 * that claim keys are never blocked for long.
 */
@Injectable()
export class IdempotencyPurgeService {
  constructor(private readonly prisma: PrismaService) {}

  async purge({
    batchSize = 1000,
    maxBatches = 1000,
  }: PurgeOptions = {}): Promise<IdempotencyPurgeReport> {
    const startedAt = new Date().toISOString();
    let deleted = 0;
    let batches = 0;
    let complete = false;
    while (batches < maxBatches) {
      const [row] = await this.prisma.$queryRawTyped(
        purgeIdempotencyKeys(IDEMPOTENCY_RETENTION_DAYS, batchSize),
      );
      const n = row?.deleted ?? 0;
      batches++;
      deleted += n;
      if (n < batchSize) {
        complete = true;
        break;
      }
    }
    return {
      retentionDays: IDEMPOTENCY_RETENTION_DAYS,
      deleted,
      batches,
      complete,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}
