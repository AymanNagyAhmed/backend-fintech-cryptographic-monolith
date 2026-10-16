import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CheckpointsModule } from '../checkpoints.module.js';
import {
  CHECKPOINTER_JOB_OPTIONS,
  CHECKPOINTER_QUEUE,
} from './checkpointer.constants.js';
import { CheckpointerProcessor } from './checkpointer.processor.js';
import { CheckpointerScheduler } from './checkpointer.scheduler.js';

@Module({
  imports: [
    CheckpointsModule,
    BullModule.registerQueue({
      name: CHECKPOINTER_QUEUE,
      defaultJobOptions: CHECKPOINTER_JOB_OPTIONS,
    }),
  ],
  providers: [CheckpointerProcessor, CheckpointerScheduler],
})
export class CheckpointJobsModule {}
