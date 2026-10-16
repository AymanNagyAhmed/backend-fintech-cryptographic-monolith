export interface BrokenAt {
  partition: string;
  seq: string;
}

export interface VerifyReport {
  ok: boolean;
  partitionsChecked: number;
  eventsChecked: number;
  /** First leaf whose hash does not match prev||canonical(payload). */
  brokenAt: BrokenAt | null;
  /** Missing seq values within a partition (holes). */
  gaps: BrokenAt[];
  /** Duplicate (partition_key, seq) — should be impossible with UNIQUE; reported if found. */
  duplicates: BrokenAt[];
}
