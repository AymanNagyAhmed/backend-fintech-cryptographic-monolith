import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  CheckpointerService,
  type CheckpointBuildResult,
} from '../checkpointer.service.js';
import { CHECKPOINTER_QUEUE } from './checkpointer.constants.js';

@Processor(CHECKPOINTER_QUEUE, { concurrency: 1 })
export class CheckpointerProcessor extends WorkerHost {
  constructor(private readonly checkpointer: CheckpointerService) {
    super();
  }

  process(_job: Job): Promise<CheckpointBuildResult> {
    return this.checkpointer.build();
  }
}
