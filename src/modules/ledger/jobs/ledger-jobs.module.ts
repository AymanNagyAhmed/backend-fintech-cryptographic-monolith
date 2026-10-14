import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger.module.js';
import {
  RECONCILIATION_JOB_OPTIONS,
  RECONCILIATION_QUEUE,
} from './reconciliation.constants.js';
import { ReconciliationProcessor } from './reconciliation.processor.js';
import { ReconciliationScheduler } from './reconciliation.scheduler.js';

// Separate from LedgerModule, so modules and tests that only post to the ledger need no
// Redis. Needs QueueModule (BullMQ connection) in the importing app.
@Module({
  imports: [
    LedgerModule,
    BullModule.registerQueue({
      name: RECONCILIATION_QUEUE,
      defaultJobOptions: RECONCILIATION_JOB_OPTIONS,
    }),
  ],
  providers: [ReconciliationProcessor, ReconciliationScheduler],
})
export class LedgerJobsModule {}
