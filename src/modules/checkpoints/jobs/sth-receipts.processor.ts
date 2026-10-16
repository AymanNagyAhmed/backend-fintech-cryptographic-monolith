import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { SthReceiptsService } from '../sth-receipts.service.js';
import { STH_RECEIPTS_QUEUE } from './sth-receipts.constants.js';

@Processor(STH_RECEIPTS_QUEUE, { concurrency: 1 })
export class SthReceiptsProcessor extends WorkerHost {
  constructor(private readonly receipts: SthReceiptsService) {
    super();
  }

  process(_job: Job) {
    return this.receipts.pushLatest();
  }
}
