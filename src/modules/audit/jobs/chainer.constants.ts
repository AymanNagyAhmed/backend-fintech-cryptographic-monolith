import type { JobsOptions } from 'bullmq';

export const CHAINER_QUEUE = 'audit-chainer';
export const CHAINER_JOB = 'chain';
export const CHAINER_SCHEDULER_ID = 'audit-chainer-poll';

export const CHAINER_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
};
