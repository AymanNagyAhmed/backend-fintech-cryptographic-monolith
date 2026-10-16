import type { JobsOptions } from 'bullmq';

export const CHECKPOINTER_QUEUE = 'audit-checkpointer';
export const CHECKPOINTER_JOB = 'checkpoint';
export const CHECKPOINTER_SCHEDULER_ID = 'audit-checkpointer-poll';

export const CHECKPOINTER_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 50 },
};
