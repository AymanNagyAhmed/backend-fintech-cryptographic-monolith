import { sthCanonicalBytes, sthContentHash, type SthPayload } from './sth-payload.js';

describe('sth-payload', () => {
  const payload: SthPayload = {
    treeSize: 2,
    rootHash: 'ab'.repeat(32),
    timestamp: '2026-10-16T20:00:00.000Z',
    previousSthHash: null,
  };

  it('canonicalizes with sorted keys', () => {
    const json = sthCanonicalBytes(payload).toString('utf8');
    expect(json).toBe(
      '{"previousSthHash":null,"rootHash":"' +
        'ab'.repeat(32) +
        '","timestamp":"2026-10-16T20:00:00.000Z","treeSize":2}',
    );
  });

  it('content hash is stable 64 hex', () => {
    expect(sthContentHash(payload)).toMatch(/^[0-9a-f]{64}$/);
    expect(sthContentHash(payload)).toBe(sthContentHash(payload));
  });
});
