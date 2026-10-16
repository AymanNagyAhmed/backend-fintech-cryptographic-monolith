import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { OutboxModule } from '../../outbox/outbox.module.js';
import { AuditModule } from '../audit.module.js';
import { CHAINER_JOB_OPTIONS, CHAINER_QUEUE } from './chainer.constants.js';
import { ChainerProcessor } from './chainer.processor.js';
import { ChainerScheduler } from './chainer.scheduler.js';

// Separate from AuditModule so schema / unit tests need no Redis. Needs QueueModule.
@Module({
  imports: [
    AuditModule,
    OutboxModule, // ChainerProcessor reads the outbox lag
    BullModule.registerQueue({
      name: CHAINER_QUEUE,
      defaultJobOptions: CHAINER_JOB_OPTIONS,
    }),
  ],
  providers: [ChainerProcessor, ChainerScheduler],
})
export class AuditJobsModule {}
