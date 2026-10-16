import type { JobsOptions } from 'bullmq';

export const STH_RECEIPTS_QUEUE = 'audit-sth-receipts';
export const STH_RECEIPTS_JOB = 'push';
export const STH_RECEIPTS_SCHEDULER_ID = 'audit-sth-receipts-hourly';

export const STH_RECEIPTS_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { count: 48 },
  removeOnFail: { count: 48 },
};
