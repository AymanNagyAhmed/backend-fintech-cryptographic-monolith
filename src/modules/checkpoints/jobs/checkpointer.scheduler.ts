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
  CHECKPOINTER_JOB,
  CHECKPOINTER_JOB_OPTIONS,
  CHECKPOINTER_QUEUE,
  CHECKPOINTER_SCHEDULER_ID,
} from './checkpointer.constants.js';

/** Registers the Merkle checkpointer poll from CHECKPOINT_INTERVAL_SEC (UTC). */
@Injectable()
export class CheckpointerScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(CheckpointerScheduler.name);

  constructor(
    @InjectQueue(CHECKPOINTER_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onApplicationBootstrap(): void {
    void this.schedule().catch((err: unknown) =>
      this.logger.error({ err }, 'Could not schedule audit checkpointer'),
    );
  }

  async schedule(): Promise<void> {
    const sec = this.config.get('CHECKPOINT_INTERVAL_SEC', { infer: true });
    // Interval (ms): cron second-fields cannot express >= 60s cleanly
    await this.queue.upsertJobScheduler(
      CHECKPOINTER_SCHEDULER_ID,
      { every: sec * 1000 },
      { name: CHECKPOINTER_JOB, opts: CHECKPOINTER_JOB_OPTIONS },
    );
    this.logger.log({ everyMs: sec * 1000 }, 'Audit checkpointer scheduled');
  }
}
