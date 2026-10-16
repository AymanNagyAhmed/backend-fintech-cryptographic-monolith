import type { JobsOptions } from 'bullmq';

export const PII_SCAN_QUEUE = 'privacy-pii-scan';
export const PII_SCAN_JOB = 'scan';
export const PII_SCAN_SCHEDULER_ID = 'privacy-pii-scan-nightly';

export const PII_SCAN_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'fixed', delay: 30_000 },
  removeOnComplete: { count: 14 },
  removeOnFail: { count: 14 },
};
