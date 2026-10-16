import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  PII_SCAN_JOB,
  PII_SCAN_JOB_OPTIONS,
  PII_SCAN_QUEUE,
  PII_SCAN_SCHEDULER_ID,
} from './pii-scan.constants.js';

@Injectable()
export class PiiScanScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(PiiScanScheduler.name);

  constructor(@InjectQueue(PII_SCAN_QUEUE) private readonly queue: Queue) {}

  onApplicationBootstrap(): void {
    void this.schedule().catch((err: unknown) =>
      this.logger.error({ err }, 'Could not schedule PII scan'),
    );
  }

  async schedule(): Promise<void> {
    // 02:00 UTC daily
    await this.queue.upsertJobScheduler(
      PII_SCAN_SCHEDULER_ID,
      { pattern: '0 0 2 * * *', tz: 'UTC' },
      { name: PII_SCAN_JOB, opts: PII_SCAN_JOB_OPTIONS },
    );
    this.logger.log('PII scanner scheduled daily at 02:00 UTC');
  }
}
