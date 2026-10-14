import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import {
  RECONCILIATION_JOB,
  RECONCILIATION_JOB_OPTIONS,
  RECONCILIATION_QUEUE,
  RECONCILIATION_SCHEDULER_ID,
} from './reconciliation.constants.js';

/** Registers the nightly job scheduler (RECONCILIATION_CRON, UTC) in Redis at startup. */
@Injectable()
export class ReconciliationScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReconciliationScheduler.name);

  constructor(
    @InjectQueue(RECONCILIATION_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** Not awaited: with Redis down the app still starts and the upsert runs once it is back. */
  onApplicationBootstrap(): void {
    void this.schedule().catch((err: unknown) =>
      this.logger.error({ err }, 'Could not schedule ledger reconciliation'),
    );
  }

  async schedule(): Promise<void> {
    const pattern = this.config.get('RECONCILIATION_CRON', { infer: true });
    await this.queue.upsertJobScheduler(
      RECONCILIATION_SCHEDULER_ID,
      { pattern, tz: 'UTC' },
      { name: RECONCILIATION_JOB, opts: RECONCILIATION_JOB_OPTIONS },
    );
    this.logger.log({ pattern }, 'Ledger reconciliation scheduled');
  }
}
