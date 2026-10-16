import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  ChainerService,
  type ChainerRunResult,
} from '../chainer.service.js';
import { CHAINER_QUEUE } from './chainer.constants.js';

@Processor(CHAINER_QUEUE, { concurrency: 1 })
export class ChainerProcessor extends WorkerHost {
  constructor(private readonly chainer: ChainerService) {
    super();
  }

  process(_job: Job): Promise<ChainerRunResult> {
    return this.chainer.run();
  }
}
