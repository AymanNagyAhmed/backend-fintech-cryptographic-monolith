export interface IdempotencyPurgeReport {
  /** Keys older than this many days were deleted */
  retentionDays: number;
  deleted: number;
  batches: number;
  /** false when the run stopped at the batch cap; the next run continues */
  complete: boolean;
  startedAt: string;
  finishedAt: string;
}
