import type { JobsOptions } from 'bullmq';

export const WITNESS_QUEUE = 'audit-witness';
export const WITNESS_JOB = 'check';
export const WITNESS_SCHEDULER_ID = 'audit-witness-poll';

export const WITNESS_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'fixed', delay: 15_000 },
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 50 },
};
