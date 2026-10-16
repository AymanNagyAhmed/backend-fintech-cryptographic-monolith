import { createHash } from 'node:crypto';

/** RFC 6962 / 9162 leaf prefix. */
const LEAF_PREFIX = Buffer.from([0x00]);
/** RFC 6962 / 9162 node prefix. */
const NODE_PREFIX = Buffer.from([0x01]);

export type MerkleHash = Buffer;

function sha256(...parts: Buffer[]): MerkleHash {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

/** MTH({d}) = SHA-256(0x00 || d). */
export function hashLeaf(data: Buffer | Uint8Array): MerkleHash {
  return sha256(LEAF_PREFIX, Buffer.from(data));
}

/** MTH for an interior node: SHA-256(0x01 || left || right). */
export function hashNode(left: MerkleHash, right: MerkleHash): MerkleHash {
  return sha256(NODE_PREFIX, left, right);
}

/**
 * Largest power of 2 strictly less than `n` (RFC 6962 §2.1).
 * For n=1 returns 0 (caller must not split).
 */
export function largestPowerOfTwoLessThan(n: number): number {
  if (n < 2) return 0;
  let p = 1;
  while (p * 2 < n) p *= 2;
  return p;
}

/**
 * RFC 6962 Merkle tree hash over `leaves` (already leaf-hashed or raw leaf data).
 * Pass `leafHashed: true` when inputs are already `hashLeaf` digests (audit event hashes).
 */
export function merkleRoot(
  leaves: readonly (Buffer | Uint8Array)[],
  leafHashed = false,
): MerkleHash {
  if (leaves.length === 0)
    throw new Error('merkleRoot: empty tree has no root');
  const hashed = leafHashed
    ? leaves.map((l) => Buffer.from(l))
    : leaves.map((l) => hashLeaf(l));
  return rootOf(hashed);
}

function rootOf(nodes: readonly MerkleHash[]): MerkleHash {
  if (nodes.length === 1) return nodes[0]!;
  const k = largestPowerOfTwoLessThan(nodes.length);
  return hashNode(rootOf(nodes.slice(0, k)), rootOf(nodes.slice(k)));
}

/**
 * Inclusion proof path for leaf at `index` (0-based) in a tree of `leafHashed` digests.
 * Path entries are sibling hashes from leaf toward root (RFC 6962 §2.1.1).
 */
export function inclusionProof(
  leaves: readonly MerkleHash[],
  index: number,
): MerkleHash[] {
  if (index < 0 || index >= leaves.length)
    throw new Error('inclusionProof: index out of range');
  const path: MerkleHash[] = [];
  walkInclusion(leaves, index, path);
  return path;
}

function walkInclusion(
  nodes: readonly MerkleHash[],
  index: number,
  path: MerkleHash[],
): MerkleHash {
  if (nodes.length === 1) return nodes[0]!;
  const k = largestPowerOfTwoLessThan(nodes.length);
  if (index < k) {
    const left = walkInclusion(nodes.slice(0, k), index, path);
    const right = rootOf(nodes.slice(k) as MerkleHash[]);
    path.push(right);
    return hashNode(left, right);
  }
  const left = rootOf(nodes.slice(0, k) as MerkleHash[]);
  const right = walkInclusion(nodes.slice(k), index - k, path);
  path.push(left);
  return hashNode(left, right);
}

/**
 * Verify an inclusion proof: recompute root from leaf hash + leaf-to-root path
 * (RFC 6962 §2.1.1). Path order matches {@link inclusionProof}.
 */
export function verifyInclusion(
  leafHash: MerkleHash,
  index: number,
  treeSize: number,
  path: readonly MerkleHash[],
  expectedRoot: MerkleHash,
): boolean {
  if (index < 0 || index >= treeSize || treeSize < 1) return false;
  const got = reconstructRoot(Buffer.from(leafHash), index, treeSize, path, 0);
  return got !== null && got.root.equals(expectedRoot) && got.used === path.length;
}

function reconstructRoot(
  fn: MerkleHash,
  index: number,
  n: number,
  path: readonly MerkleHash[],
  used: number,
): { root: MerkleHash; used: number } | null {
  if (n === 1) return { root: fn, used };
  const k = largestPowerOfTwoLessThan(n);
  if (index < k) {
    const left = reconstructRoot(fn, index, k, path, used);
    if (left === null || left.used >= path.length) return null;
    return {
      root: hashNode(left.root, path[left.used]!),
      used: left.used + 1,
    };
  }
  const right = reconstructRoot(fn, index - k, n - k, path, used);
  if (right === null || right.used >= path.length) return null;
  return {
    root: hashNode(path[right.used]!, right.root),
    used: right.used + 1,
  };
}

/**
 * Consistency proof between old tree size and new leaf-hashed list (RFC 6962 §2.1.2).
 * `oldSize` is the previous tree size; `leaves` are all leaf hashes of the new tree.
 */
export function consistencyProof(
  leaves: readonly MerkleHash[],
  oldSize: number,
): MerkleHash[] {
  const newSize = leaves.length;
  if (oldSize < 0 || oldSize > newSize)
    throw new Error('consistencyProof: oldSize out of range');
  if (oldSize === 0 || oldSize === newSize) return [];
  return subProof(leaves, oldSize, newSize, true);
}

function subProof(
  leaves: readonly MerkleHash[],
  m: number,
  n: number,
  b: boolean,
): MerkleHash[] {
  if (m === n) return b ? [] : [rootOf(leaves.slice(0, n) as MerkleHash[])];
  const k = largestPowerOfTwoLessThan(n);
  if (m <= k) {
    const proof = subProof(leaves.slice(0, k), m, k, b);
    proof.push(rootOf(leaves.slice(k) as MerkleHash[]));
    return proof;
  }
  const proof = subProof(leaves.slice(k), m - k, n - k, false);
  proof.push(rootOf(leaves.slice(0, k) as MerkleHash[]));
  return proof;
}

/** Hex helpers used by checkpointer / API DTOs. */
export function merkleHashToHex(h: MerkleHash): string {
  return h.toString('hex');
}

export function merkleHashFromHex(hex: string): MerkleHash {
  if (!/^[0-9a-f]{64}$/i.test(hex))
    throw new TypeError('merkle hash must be 64 hex chars');
  return Buffer.from(hex, 'hex');
}

/**
 * Leaf input for audit checkpoints: 32-byte hash of the chain leaf (hex → bytes).
 * Already a commitment; we still apply the RFC 6962 0x00 leaf prefix when building the tree.
 */
export function auditLeafDigest(chainHashHex: string): MerkleHash {
  return hashLeaf(merkleHashFromHex(chainHashHex));
}
