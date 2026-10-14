import type { JobsOptions } from 'bullmq';

export const RECONCILIATION_QUEUE = 'ledger-reconciliation';
export const RECONCILIATION_JOB = 'reconcile';
/** One scheduler for all app instances: upserting it again only updates the pattern. */
export const RECONCILIATION_SCHEDULER_ID = 'ledger-reconciliation-nightly';

// Retries cover a database outage; mismatches are a result, not a failure, so they never retry.
// Kept jobs hold the report as return value (count-capped, so Redis does not grow).
export const RECONCILIATION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 30 },
  removeOnFail: { count: 90 },
};
