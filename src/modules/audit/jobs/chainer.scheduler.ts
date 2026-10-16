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
  CHAINER_JOB,
  CHAINER_JOB_OPTIONS,
  CHAINER_QUEUE,
  CHAINER_SCHEDULER_ID,
} from './chainer.constants.js';

/** Registers the outbox-drain poll (CHAINER_CRON, UTC) in Redis at startup. */
@Injectable()
export class ChainerScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChainerScheduler.name);

  constructor(
    @InjectQueue(CHAINER_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onApplicationBootstrap(): void {
    void this.schedule().catch((err: unknown) =>
      this.logger.error({ err }, 'Could not schedule audit chainer'),
    );
  }

  async schedule(): Promise<void> {
    const pattern = this.config.get('CHAINER_CRON', { infer: true });
    await this.queue.upsertJobScheduler(
      CHAINER_SCHEDULER_ID,
      { pattern, tz: 'UTC' },
      { name: CHAINER_JOB, opts: CHAINER_JOB_OPTIONS },
    );
    this.logger.log({ pattern }, 'Audit chainer scheduled');
  }
}
