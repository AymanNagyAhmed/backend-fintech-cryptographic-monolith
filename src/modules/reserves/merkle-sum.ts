import { createHash } from 'node:crypto';
import type { Currency } from '../../common/money/currency.js';
import { Money } from '../../common/money/money.js';
import {
  hashLeaf,
  largestPowerOfTwoLessThan,
  merkleHashToHex,
  type MerkleHash,
} from '../../common/crypto/merkle.js';

/** Same interior-node prefix as RFC 6962 (common/crypto/merkle.ts); leaves use hashLeaf's 0x00. */
const NODE_PREFIX = Buffer.from([0x01]);

/** Tree node: commitment hash plus the sum of all balances below it, a decimal string. */
export interface SumNode {
  hash: MerkleHash;
  /** Currency-scale decimal string, e.g. "1500.00". */
  sum: string;
}

export interface MerkleSumLeaf {
  userId: string;
  /** Currency-scale decimal string, never negative. */
  balance: string;
  /** Random per-leaf value (hex) that hides the leaf from everyone except its owner. */
  salt: string;
}

export interface MerkleSumTree {
  currency: Currency;
  size: number;
  root: SumNode;
  /** Leaf nodes in input order; their `sum` is the leaf balance. */
  leaves: readonly SumNode[];
}

/** Proof step: the sibling subtree, listed from the leaf toward the root. */
export type SumProofStep = SumNode;

/** Leaf commitment input: `userId|currency|balance|salt`. */
export function leafPreimage(
  userId: string,
  currency: Currency,
  balance: string,
  salt: string,
): Buffer {
  return Buffer.from(`${userId}|${currency}|${balance}|${salt}`, 'utf8');
}

/** Leaf node: hash = SHA-256(0x00 || preimage), sum = the balance itself. */
export function sumLeaf(currency: Currency, leaf: MerkleSumLeaf): SumNode {
  const balance = Money.of(leaf.balance, currency);
  if (balance.isNegative())
    throw new RangeError('merkle-sum: balance must not be negative');
  const sum = balance.toString();
  return {
    hash: hashLeaf(leafPreimage(leaf.userId, currency, sum, leaf.salt)),
    sum,
  };
}

/**
 * Interior node: hash = SHA-256(0x01 || left.hash || right.hash || "leftSum|rightSum"),
 * sum = leftSum + rightSum. Committing to the child sums means a verifier who recomputes the
 * root also gets the total liabilities, and nobody can move value between branches.
 */
export function sumNode(
  currency: Currency,
  left: SumNode,
  right: SumNode,
): SumNode {
  const sum = Money.of(left.sum, currency).add(Money.of(right.sum, currency));
  const hash = createHash('sha256')
    .update(NODE_PREFIX)
    .update(left.hash)
    .update(right.hash)
    .update(Buffer.from(`${left.sum}|${right.sum}`, 'utf8'))
    .digest();
  return { hash, sum: sum.toString() };
}

function rootOf(currency: Currency, nodes: readonly SumNode[]): SumNode {
  if (nodes.length === 1) return nodes[0]!;
  const k = largestPowerOfTwoLessThan(nodes.length);
  return sumNode(
    currency,
    rootOf(currency, nodes.slice(0, k)),
    rootOf(currency, nodes.slice(k)),
  );
}

/**
 * Builds the tree over `leaves` in the given order (callers sort for a stable root). Shape
 * follows RFC 6962 (split at the largest power of two below n), so a single leaf is the root.
 */
export function buildMerkleSumTree(
  currency: Currency,
  leaves: readonly MerkleSumLeaf[],
): MerkleSumTree {
  if (leaves.length === 0)
    throw new RangeError('merkle-sum: empty tree has no root');
  const nodes = leaves.map((l) => sumLeaf(currency, l));
  return {
    currency,
    size: nodes.length,
    root: rootOf(currency, nodes),
    leaves: nodes,
  };
}

/** Sibling subtrees from the leaf at `index` up to the root. */
export function sumInclusionProof(
  tree: MerkleSumTree,
  index: number,
): SumProofStep[] {
  if (!Number.isInteger(index) || index < 0 || index >= tree.size)
    throw new RangeError('merkle-sum: index out of range');
  const path: SumProofStep[] = [];
  walk(tree.currency, tree.leaves, index, path);
  return path;
}

function walk(
  currency: Currency,
  nodes: readonly SumNode[],
  index: number,
  path: SumProofStep[],
): SumNode {
  if (nodes.length === 1) return nodes[0]!;
  const k = largestPowerOfTwoLessThan(nodes.length);
  if (index < k) {
    const left = walk(currency, nodes.slice(0, k), index, path);
    const right = rootOf(currency, nodes.slice(k));
    path.push(right);
    return sumNode(currency, left, right);
  }
  const left = rootOf(currency, nodes.slice(0, k));
  const right = walk(currency, nodes.slice(k), index - k, path);
  path.push(left);
  return sumNode(currency, left, right);
}

export interface SumInclusionClaim {
  currency: Currency;
  leaf: MerkleSumLeaf;
  index: number;
  treeSize: number;
  path: readonly SumProofStep[];
}

/**
 * Recomputes root hash and total from a leaf and its path (leaf to root, same order as
 * {@link sumInclusionProof}). Returns null when the path has the wrong length for
 * (index, treeSize) or any sum is negative or malformed: a negative sibling would let a
 * dishonest operator hide liabilities, so the verifier must reject it.
 */
export function reconstructSumRoot(claim: SumInclusionClaim): SumNode | null {
  const { currency, leaf, index, treeSize, path } = claim;
  if (!Number.isInteger(index) || !Number.isInteger(treeSize)) return null;
  if (treeSize < 1 || index < 0 || index >= treeSize) return null;
  try {
    for (const step of path) {
      if (step.hash.length !== 32) return null;
      const sum = Money.of(step.sum, currency);
      if (sum.isNegative() || sum.toString() !== step.sum) return null;
    }
    const got = climb(currency, sumLeaf(currency, leaf), index, treeSize, path);
    return got !== null && got.used === path.length ? got.node : null;
  } catch {
    // Malformed amounts or currency: not a valid proof
    return null;
  }
}

function climb(
  currency: Currency,
  node: SumNode,
  index: number,
  n: number,
  path: readonly SumProofStep[],
): { node: SumNode; used: number } | null {
  if (n === 1) return { node, used: 0 };
  const k = largestPowerOfTwoLessThan(n);
  const inLeft = index < k;
  const below = inLeft
    ? climb(currency, node, index, k, path)
    : climb(currency, node, index - k, n - k, path);
  if (below === null || below.used >= path.length) return null;
  const sibling = path[below.used]!;
  return {
    node: inLeft
      ? sumNode(currency, below.node, sibling)
      : sumNode(currency, sibling, below.node),
    used: below.used + 1,
  };
}

/** True when the proof leads to the published root hash (hex) and total liabilities. */
export function verifySumInclusion(
  claim: SumInclusionClaim,
  expectedRootHex: string,
  expectedTotal: string,
): boolean {
  const got = reconstructSumRoot(claim);
  if (got === null) return false;
  let total: string;
  try {
    total = Money.of(expectedTotal, claim.currency).toString();
  } catch {
    return false;
  }
  return merkleHashToHex(got.hash) === expectedRootHex && got.sum === total;
}
