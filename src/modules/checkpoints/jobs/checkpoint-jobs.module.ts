import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CheckpointsModule } from '../checkpoints.module.js';
import { SthReceiptsService } from '../sth-receipts.service.js';
import {
  CHECKPOINTER_JOB_OPTIONS,
  CHECKPOINTER_QUEUE,
} from './checkpointer.constants.js';
import { CheckpointerProcessor } from './checkpointer.processor.js';
import { CheckpointerScheduler } from './checkpointer.scheduler.js';
import {
  STH_RECEIPTS_JOB_OPTIONS,
  STH_RECEIPTS_QUEUE,
} from './sth-receipts.constants.js';
import { SthReceiptsProcessor } from './sth-receipts.processor.js';
import { SthReceiptsScheduler } from './sth-receipts.scheduler.js';

@Module({
  imports: [
    CheckpointsModule,
    BullModule.registerQueue({
      name: CHECKPOINTER_QUEUE,
      defaultJobOptions: CHECKPOINTER_JOB_OPTIONS,
    }),
    BullModule.registerQueue({
      name: STH_RECEIPTS_QUEUE,
      defaultJobOptions: STH_RECEIPTS_JOB_OPTIONS,
    }),
  ],
  providers: [
    CheckpointerProcessor,
    CheckpointerScheduler,
    SthReceiptsService,
    SthReceiptsProcessor,
    SthReceiptsScheduler,
  ],
})
export class CheckpointJobsModule {}
