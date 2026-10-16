import { createHash } from 'node:crypto';

/**
 * Maps a stable id onto `0 .. partitionCount-1` for hash-chain partitioning (A-B9.10).
 * Same id always lands on the same key for a given count.
 */
export function auditPartitionKey(
  stableId: string,
  partitionCount: number,
): string {
  if (!Number.isInteger(partitionCount) || partitionCount < 1) {
    throw new Error('partitionCount must be a positive integer');
  }
  if (partitionCount === 1) return '0';
  const digest = createHash('sha256').update(stableId, 'utf8').digest();
  const n = digest.readUInt32BE(0) % partitionCount;
  return String(n);
}
