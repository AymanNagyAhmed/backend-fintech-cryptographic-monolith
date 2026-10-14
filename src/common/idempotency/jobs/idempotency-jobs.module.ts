import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IdempotencyPurgeService } from '../idempotency-purge.service.js';
import {
  IDEMPOTENCY_PURGE_JOB_OPTIONS,
  IDEMPOTENCY_PURGE_QUEUE,
} from './idempotency-purge.constants.js';
import { IdempotencyPurgeProcessor } from './idempotency-purge.processor.js';
import { IdempotencyPurgeScheduler } from './idempotency-purge.scheduler.js';

// Separate from IdempotencyModule, so modules and tests that only claim keys need no Redis.
// Needs QueueModule (BullMQ connection) and the global DatabaseModule in the importing app.
@Module({
  imports: [
    BullModule.registerQueue({
      name: IDEMPOTENCY_PURGE_QUEUE,
      defaultJobOptions: IDEMPOTENCY_PURGE_JOB_OPTIONS,
    }),
  ],
  providers: [
    IdempotencyPurgeService,
    IdempotencyPurgeProcessor,
    IdempotencyPurgeScheduler,
  ],
})
export class IdempotencyJobsModule {}
