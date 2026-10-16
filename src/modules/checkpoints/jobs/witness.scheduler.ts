import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  WITNESS_JOB,
  WITNESS_JOB_OPTIONS,
  WITNESS_QUEUE,
  WITNESS_SCHEDULER_ID,
} from './witness.constants.js';

/** Periodic STH consistency witness (A-B10.8). */
@Injectable()
export class WitnessScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(WitnessScheduler.name);

  constructor(@InjectQueue(WITNESS_QUEUE) private readonly queue: Queue) {}

  onApplicationBootstrap(): void {
    void this.schedule().catch((err: unknown) =>
      this.logger.error({ err }, 'Could not schedule audit witness'),
    );
  }

  async schedule(): Promise<void> {
    // Every 5 minutes UTC
    await this.queue.upsertJobScheduler(
      WITNESS_SCHEDULER_ID,
      { pattern: '0 */5 * * * *', tz: 'UTC' },
      { name: WITNESS_JOB, opts: WITNESS_JOB_OPTIONS },
    );
    this.logger.log('Audit witness scheduled every 5 minutes');
  }
}
