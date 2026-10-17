import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { MetricsService } from '../../../common/metrics/metrics.service.js';
import { WitnessService } from '../witness.service.js';
import { WITNESS_QUEUE } from './witness.constants.js';

@Processor(WITNESS_QUEUE, { concurrency: 1 })
export class WitnessProcessor extends WorkerHost {
  constructor(
    private readonly witness: WitnessService,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(_job: Job) {
    const report = await this.witness.check();
    if (!report.ok || report.rollback) this.metrics.recordWitnessAlert();
    return report;
  }
}
