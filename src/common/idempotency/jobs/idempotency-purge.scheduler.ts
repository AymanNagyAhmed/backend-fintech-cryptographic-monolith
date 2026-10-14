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
  IDEMPOTENCY_PURGE_JOB,
  IDEMPOTENCY_PURGE_JOB_OPTIONS,
  IDEMPOTENCY_PURGE_QUEUE,
  IDEMPOTENCY_PURGE_SCHEDULER_ID,
} from './idempotency-purge.constants.js';

/** Registers the nightly job scheduler (IDEMPOTENCY_PURGE_CRON, UTC) in Redis at startup. */
@Injectable()
export class IdempotencyPurgeScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(IdempotencyPurgeScheduler.name);

  constructor(
    @InjectQueue(IDEMPOTENCY_PURGE_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** Not awaited: with Redis down the app still starts and the upsert runs once it is back. */
  onApplicationBootstrap(): void {
    void this.schedule().catch((err: unknown) =>
      this.logger.error({ err }, 'Could not schedule idempotency key purge'),
    );
  }

  async schedule(): Promise<void> {
    const pattern = this.config.get('IDEMPOTENCY_PURGE_CRON', { infer: true });
    await this.queue.upsertJobScheduler(
      IDEMPOTENCY_PURGE_SCHEDULER_ID,
      { pattern, tz: 'UTC' },
      { name: IDEMPOTENCY_PURGE_JOB, opts: IDEMPOTENCY_PURGE_JOB_OPTIONS },
    );
    this.logger.log({ pattern }, 'Idempotency key purge scheduled');
  }
}
