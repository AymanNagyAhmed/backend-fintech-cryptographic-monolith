import { auditPartitionKey } from './audit-partition-key.js';

describe('auditPartitionKey', () => {
  it('returns 0 when there is a single partition', () => {
    expect(auditPartitionKey('any-id', 1)).toBe('0');
  });

  it('is stable for the same id and count', () => {
    expect(auditPartitionKey('transfer-abc', 16)).toBe(
      auditPartitionKey('transfer-abc', 16),
    );
  });

  it('stays within 0..count-1', () => {
    for (const count of [1, 4, 16] as const) {
      for (let i = 0; i < 64; i++) {
        const key = auditPartitionKey(`id-${i}`, count);
        const n = Number(key);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(count);
      }
    }
  });

  it('spreads ids across 16 partitions', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(auditPartitionKey(`spread-${i}`, 16));
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it('rejects a non-positive count', () => {
    expect(() => auditPartitionKey('x', 0)).toThrow(/positive integer/);
  });
});
