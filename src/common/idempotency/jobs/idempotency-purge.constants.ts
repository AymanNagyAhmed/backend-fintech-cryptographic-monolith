import type { JobsOptions } from 'bullmq';

export const IDEMPOTENCY_PURGE_QUEUE = 'idempotency-purge';
export const IDEMPOTENCY_PURGE_JOB = 'purge';
/** One scheduler for all app instances: upserting it again only updates the pattern. */
export const IDEMPOTENCY_PURGE_SCHEDULER_ID = 'idempotency-purge-nightly';

// Retries cover a database outage; a run that stops at the batch cap is not a failure.
export const IDEMPOTENCY_PURGE_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 30 },
  removeOnFail: { count: 90 },
};
