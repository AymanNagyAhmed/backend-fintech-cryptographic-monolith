import {
  consistencyProof,
  hashLeaf,
  hashNode,
  inclusionProof,
  merkleHashFromHex,
  merkleHashToHex,
  merkleRoot,
  verifyInclusion,
  type MerkleHash,
} from './merkle.js';

/**
 * Reference vectors of the Certificate Transparency Merkle tree (RFC 6962,
 * Google certificate-transparency `merkle_tree_test.cc`): the first N of these
 * leaves hash to the root at index N-1.
 */
const LEAVES = [
  '',
  '00',
  '10',
  '2021',
  '3031',
  '40414243',
  '5051525354555657',
  '606162636465666768696a6b6c6d6e6f',
].map((h) => Buffer.from(h, 'hex'));

const ROOTS = [
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
];

/**
 * Independent verifier for consistency proofs (RFC 9162 section 2.1.4.2), so a
 * bug in the generator cannot hide behind a matching bug in the checker.
 */
function verifyConsistency(
  first: number,
  second: number,
  firstRoot: MerkleHash,
  secondRoot: MerkleHash,
  proof: readonly MerkleHash[],
): boolean {
  if (first < 1 || first > second) return false;
  if (first === second)
    return proof.length === 0 && firstRoot.equals(secondRoot);
  const nodes = [...proof];
  if ((first & (first - 1)) === 0) nodes.unshift(firstRoot);
  if (nodes.length === 0) return false;
  let fn = first - 1;
  let sn = second - 1;
  while ((fn & 1) === 1) {
    fn >>= 1;
    sn >>= 1;
  }
  let fr = nodes[0]!;
  let sr = nodes[0]!;
  for (const c of nodes.slice(1)) {
    if (sn === 0) return false;
    if ((fn & 1) === 1 || fn === sn) {
      fr = hashNode(c, fr);
      sr = hashNode(c, sr);
      while ((fn & 1) === 0 && fn !== 0) {
        fn >>= 1;
        sn >>= 1;
      }
    } else {
      sr = hashNode(sr, c);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && fr.equals(firstRoot) && sr.equals(secondRoot);
}

describe('RFC 6962 reference vectors', () => {
  it('hashes the empty leaf as SHA-256(0x00)', () => {
    expect(merkleHashToHex(hashLeaf(Buffer.alloc(0)))).toBe(ROOTS[0]);
  });

  it.each(ROOTS.map((root, i) => [i + 1, root] as const))(
    'root of the first %i leaves',
    (size, root) => {
      expect(merkleHashToHex(merkleRoot(LEAVES.slice(0, size)))).toBe(root);
    },
  );

  it('inclusion proofs verify for every leaf of every tree size up to 8', () => {
    for (let size = 1; size <= LEAVES.length; size++) {
      const hashed = LEAVES.slice(0, size).map((l) => hashLeaf(l));
      const root = merkleHashFromHex(ROOTS[size - 1]!);
      for (let i = 0; i < size; i++) {
        const path = inclusionProof(hashed, i);
        expect(verifyInclusion(hashed[i]!, i, size, path, root)).toBe(true);
        // a leaf must not verify at another position
        if (size > 1) {
          expect(
            verifyInclusion(hashed[i]!, (i + 1) % size, size, path, root),
          ).toBe(false);
        }
      }
    }
  });

  it('inclusion proof lengths match the reference (leaf 0 of 8 has 3 nodes, of 1 has 0)', () => {
    const hashed = LEAVES.map((l) => hashLeaf(l));
    expect(inclusionProof(hashed.slice(0, 1), 0)).toHaveLength(0);
    expect(inclusionProof(hashed, 0)).toHaveLength(3);
    expect(inclusionProof(hashed.slice(0, 5), 4)).toHaveLength(1);
  });

  it('consistency proofs verify for every pair of sizes up to 16', () => {
    const leaves = Array.from({ length: 16 }, (_, i) => Buffer.from([i, 0xa5]));
    const hashed = leaves.map((l) => hashLeaf(l));
    for (let second = 1; second <= 16; second++) {
      const secondRoot = merkleRoot(leaves.slice(0, second));
      for (let first = 1; first <= second; first++) {
        const firstRoot = merkleRoot(leaves.slice(0, first));
        const proof = consistencyProof(hashed.slice(0, second), first);
        expect(
          verifyConsistency(first, second, firstRoot, secondRoot, proof),
        ).toBe(true);
      }
    }
  });

  it('consistency proof lengths match the reference (1->8: 3, 6->8: 3, 2->5: 2)', () => {
    const hashed = LEAVES.map((l) => hashLeaf(l));
    expect(consistencyProof(hashed, 1)).toHaveLength(3);
    expect(consistencyProof(hashed, 6)).toHaveLength(3);
    expect(consistencyProof(hashed.slice(0, 5), 2)).toHaveLength(2);
  });

  it('a consistency proof fails against a rewritten history', () => {
    const hashed = LEAVES.map((l) => hashLeaf(l));
    const forged = [...hashed];
    forged[1] = hashLeaf(Buffer.from('rewritten'));
    const proof = consistencyProof(hashed, 3);
    const forgedRoot = merkleRoot(
      LEAVES.slice(0, 3).map((l, i) =>
        i === 1 ? Buffer.from('rewritten') : l,
      ),
    );
    expect(
      verifyConsistency(3, 8, forgedRoot, merkleHashFromHex(ROOTS[7]!), proof),
    ).toBe(false);
  });

  it('rejects malformed hex roots', () => {
    expect(() => merkleHashFromHex('abc')).toThrow();
  });
});
