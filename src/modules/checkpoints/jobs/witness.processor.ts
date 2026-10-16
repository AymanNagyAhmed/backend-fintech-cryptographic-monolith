import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { WitnessService } from '../witness.service.js';
import { WITNESS_QUEUE } from './witness.constants.js';

@Processor(WITNESS_QUEUE, { concurrency: 1 })
export class WitnessProcessor extends WorkerHost {
  constructor(private readonly witness: WitnessService) {
    super();
  }

  process(_job: Job) {
    return this.witness.check();
  }
}
