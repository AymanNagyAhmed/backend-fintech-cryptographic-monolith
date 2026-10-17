import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { MetricsService } from '../../../common/metrics/metrics.service.js';
import { OutboxLagService } from '../../outbox/outbox-lag.service.js';
import {
  ChainerService,
  type ChainerRunResult,
} from '../chainer.service.js';
import { CHAINER_QUEUE } from './chainer.constants.js';

@Processor(CHAINER_QUEUE, { concurrency: 1 })
export class ChainerProcessor extends WorkerHost {
  constructor(
    private readonly chainer: ChainerService,
    private readonly outboxLag: OutboxLagService,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(_job: Job): Promise<ChainerRunResult> {
    const result = await this.chainer.run();
    this.metrics.recordChainer(result);
    // Alert only; never blocks HTTP (2.5 / A-B9.7)
    await this.outboxLag.checkAndAlert();
    return result;
  }
}
