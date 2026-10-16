import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  STH_RECEIPTS_JOB,
  STH_RECEIPTS_JOB_OPTIONS,
  STH_RECEIPTS_QUEUE,
  STH_RECEIPTS_SCHEDULER_ID,
} from './sth-receipts.constants.js';

/** Hourly external STH receipt push (A-B10.6). */
@Injectable()
export class SthReceiptsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SthReceiptsScheduler.name);

  constructor(
    @InjectQueue(STH_RECEIPTS_QUEUE) private readonly queue: Queue,
  ) {}

  onApplicationBootstrap(): void {
    void this.schedule().catch((err: unknown) =>
      this.logger.error({ err }, 'Could not schedule STH receipts'),
    );
  }

  async schedule(): Promise<void> {
    // Top of every hour UTC
    await this.queue.upsertJobScheduler(
      STH_RECEIPTS_SCHEDULER_ID,
      { pattern: '0 0 * * * *', tz: 'UTC' },
      { name: STH_RECEIPTS_JOB, opts: STH_RECEIPTS_JOB_OPTIONS },
    );
    this.logger.log('STH receipts scheduled hourly');
  }
}
