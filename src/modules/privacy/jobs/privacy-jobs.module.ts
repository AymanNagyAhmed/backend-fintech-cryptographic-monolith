import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy.module.js';
import {
  PII_SCAN_JOB_OPTIONS,
  PII_SCAN_QUEUE,
} from './pii-scan.constants.js';
import { PiiScanProcessor } from './pii-scan.processor.js';
import { PiiScanScheduler } from './pii-scan.scheduler.js';

@Module({
  imports: [
    PrivacyModule,
    BullModule.registerQueue({
      name: PII_SCAN_QUEUE,
      defaultJobOptions: PII_SCAN_JOB_OPTIONS,
    }),
  ],
  providers: [PiiScanProcessor, PiiScanScheduler],
})
export class PrivacyJobsModule {}
