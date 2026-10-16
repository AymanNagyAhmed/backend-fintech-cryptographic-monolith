import { createHash } from 'node:crypto';
import {
  auditLeafDigest,
  consistencyProof,
  hashLeaf,
  hashNode,
  inclusionProof,
  largestPowerOfTwoLessThan,
  merkleHashToHex,
  merkleRoot,
  verifyInclusion,
} from './merkle.js';

const leaf = (s: string) => Buffer.from(s, 'utf8');

describe('RFC 6962 merkle', () => {
  it('hashes a single leaf with 0x00 prefix', () => {
    const data = leaf('a');
    const expected = createHash('sha256')
      .update(Buffer.from([0x00]))
      .update(data)
      .digest();
    expect(hashLeaf(data).equals(expected)).toBe(true);
    expect(merkleRoot([data]).equals(expected)).toBe(true);
  });

  it('hashes two leaves under 0x01', () => {
    const a = hashLeaf(leaf('a'));
    const b = hashLeaf(leaf('b'));
    const expected = hashNode(a, b);
    expect(merkleRoot([leaf('a'), leaf('b')]).equals(expected)).toBe(true);
  });

  it('largestPowerOfTwoLessThan matches RFC 6962', () => {
    expect(largestPowerOfTwoLessThan(1)).toBe(0);
    expect(largestPowerOfTwoLessThan(2)).toBe(1);
    expect(largestPowerOfTwoLessThan(3)).toBe(2);
    expect(largestPowerOfTwoLessThan(4)).toBe(2);
    expect(largestPowerOfTwoLessThan(5)).toBe(4);
    expect(largestPowerOfTwoLessThan(7)).toBe(4);
  });

  it('builds unbalanced trees (3 leaves)', () => {
    const a = hashLeaf(leaf('a'));
    const b = hashLeaf(leaf('b'));
    const c = hashLeaf(leaf('c'));
    // MTH([a,b,c]) = H(H(a,b) || H(c)) with k=2
    const expected = hashNode(hashNode(a, b), c);
    expect(merkleRoot([leaf('a'), leaf('b'), leaf('c')]).equals(expected)).toBe(
      true,
    );
  });

  it('inclusion proof verifies for every index in a 7-leaf tree', () => {
    const raw = Array.from({ length: 7 }, (_, i) => leaf(`L${i}`));
    const hashed = raw.map((r) => hashLeaf(r));
    const root = merkleRoot(raw);
    for (let i = 0; i < hashed.length; i++) {
      const path = inclusionProof(hashed, i);
      expect(
        verifyInclusion(hashed[i]!, i, hashed.length, path, root),
      ).toBe(true);
    }
  });

  it('rejects a tampered inclusion proof', () => {
    const raw = [leaf('a'), leaf('b'), leaf('c')];
    const hashed = raw.map((r) => hashLeaf(r));
    const root = merkleRoot(raw);
    const path = inclusionProof(hashed, 1);
    path[0] = createHash('sha256').update('tamper').digest();
    expect(verifyInclusion(hashed[1]!, 1, 3, path, root)).toBe(false);
  });

  it('consistency proof from size 3 to 7 is non-empty', () => {
    const hashed = Array.from({ length: 7 }, (_, i) => hashLeaf(leaf(`L${i}`)));
    const proof = consistencyProof(hashed, 3);
    expect(proof.length).toBeGreaterThan(0);
    expect(consistencyProof(hashed, 0)).toEqual([]);
    expect(consistencyProof(hashed, 7)).toEqual([]);
  });

  it('auditLeafDigest applies leaf prefix over chain hash bytes', () => {
    const hex = 'ab'.repeat(32);
    const digest = auditLeafDigest(hex);
    expect(merkleHashToHex(digest)).toHaveLength(64);
    expect(digest.equals(hashLeaf(Buffer.from(hex, 'hex')))).toBe(true);
  });

  it('refuses an empty tree', () => {
    expect(() => merkleRoot([])).toThrow(/empty/);
  });
});
