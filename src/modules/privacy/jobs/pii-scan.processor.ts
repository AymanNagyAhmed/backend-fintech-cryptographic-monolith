import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PiiScannerService } from '../pii-scanner.service.js';
import { PII_SCAN_QUEUE } from './pii-scan.constants.js';

@Processor(PII_SCAN_QUEUE, { concurrency: 1 })
export class PiiScanProcessor extends WorkerHost {
  constructor(private readonly scanner: PiiScannerService) {
    super();
  }

  process(_job: Job) {
    return this.scanner.scan();
  }
}
