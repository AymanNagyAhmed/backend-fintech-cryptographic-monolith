import { createHash } from 'node:crypto';
import { hashLeaf, merkleHashToHex } from '../checkpoints/merkle.js';
import {
  buildMerkleSumTree,
  leafPreimage,
  reconstructSumRoot,
  sumInclusionProof,
  sumLeaf,
  sumNode,
  verifySumInclusion,
  type MerkleSumLeaf,
  type SumInclusionClaim,
} from './merkle-sum.js';

const salt = (n: number) => n.toString(16).padStart(32, '0');
const user = (n: number) =>
  `0199c1a0-0000-7000-8000-${n.toString().padStart(12, '0')}`;

const makeLeaves = (balances: string[]): MerkleSumLeaf[] =>
  balances.map((balance, i) => ({
    userId: user(i + 1),
    balance,
    salt: salt(i + 1),
  }));

const claimFor = (
  leaves: MerkleSumLeaf[],
  index: number,
  currency: 'AED' | 'BTC' = 'AED',
): SumInclusionClaim & { rootHex: string; total: string } => {
  const tree = buildMerkleSumTree(currency, leaves);
  return {
    currency,
    leaf: leaves[index]!,
    index,
    treeSize: tree.size,
    path: sumInclusionProof(tree, index),
    rootHex: merkleHashToHex(tree.root.hash),
    total: tree.root.sum,
  };
};

describe('merkle-sum', () => {
  describe('leaf', () => {
    it('hashes userId|currency|balance|salt under the 0x00 prefix', () => {
      const leaf = makeLeaves(['12.50'])[0]!;
      const expected = createHash('sha256')
        .update(Buffer.from([0x00]))
        .update(`${leaf.userId}|AED|12.50|${leaf.salt}`)
        .digest();
      const node = sumLeaf('AED', leaf);
      expect(node.hash.equals(expected)).toBe(true);
      expect(
        node.hash.equals(
          hashLeaf(leafPreimage(leaf.userId, 'AED', '12.50', leaf.salt)),
        ),
      ).toBe(true);
      expect(node.sum).toBe('12.50');
    });

    it('normalises the balance to the currency scale', () => {
      const [leaf] = makeLeaves(['12.5']);
      expect(sumLeaf('AED', leaf!).sum).toBe('12.50');
    });

    it('changes with any input', () => {
      const leaf = makeLeaves(['12.50'])[0]!;
      const base = sumLeaf('AED', leaf).hash;
      for (const other of [
        { ...leaf, userId: user(99) },
        { ...leaf, balance: '12.51' },
        { ...leaf, salt: salt(99) },
      ]) {
        expect(sumLeaf('AED', other).hash.equals(base)).toBe(false);
      }
      expect(sumLeaf('USD', leaf).hash.equals(base)).toBe(false);
    });

    it('rejects negative and over-precise balances', () => {
      const [leaf] = makeLeaves(['1.00']);
      expect(() => sumLeaf('AED', { ...leaf!, balance: '-1.00' })).toThrow(
        RangeError,
      );
      expect(() => sumLeaf('AED', { ...leaf!, balance: '1.001' })).toThrow();
    });
  });

  describe('sumNode', () => {
    it('hashes children and their sums under the 0x01 prefix and adds the sums', () => {
      const [a, b] = makeLeaves(['1.00', '2.50']).map((l) => sumLeaf('AED', l));
      const expected = createHash('sha256')
        .update(Buffer.from([0x01]))
        .update(a!.hash)
        .update(b!.hash)
        .update('1.00|2.50')
        .digest();
      const node = sumNode('AED', a!, b!);
      expect(node.hash.equals(expected)).toBe(true);
      expect(node.sum).toBe('3.50');
    });

    it('is not symmetric', () => {
      const [a, b] = makeLeaves(['1.00', '2.50']).map((l) => sumLeaf('AED', l));
      expect(
        sumNode('AED', a!, b!).hash.equals(sumNode('AED', b!, a!).hash),
      ).toBe(false);
    });

    it('commits to the sums, not only to the child hashes', () => {
      const [a, b] = makeLeaves(['1.00', '2.50']).map((l) => sumLeaf('AED', l));
      const lied = { hash: a!.hash, sum: '9.00' };
      expect(
        sumNode('AED', lied, b!).hash.equals(sumNode('AED', a!, b!).hash),
      ).toBe(false);
    });
  });

  describe('buildMerkleSumTree', () => {
    it('rejects an empty tree', () => {
      expect(() => buildMerkleSumTree('AED', [])).toThrow(RangeError);
    });

    it('makes a single leaf the root', () => {
      const leaves = makeLeaves(['7.00']);
      const tree = buildMerkleSumTree('AED', leaves);
      expect(tree.size).toBe(1);
      expect(tree.root.sum).toBe('7.00');
      expect(tree.root.hash.equals(sumLeaf('AED', leaves[0]!).hash)).toBe(true);
    });

    it('sums all leaves at the currency scale', () => {
      const tree = buildMerkleSumTree(
        'AED',
        makeLeaves(['10.00', '0.05', '2.45', '100.00', '0.01']),
      );
      expect(tree.root.sum).toBe('112.51');
    });

    it('uses the BTC scale of 8 decimals', () => {
      const tree = buildMerkleSumTree(
        'BTC',
        makeLeaves(['0.00000001', '1.5', '0.00000002']),
      );
      expect(tree.root.sum).toBe('1.50000003');
    });

    it('has the RFC 6962 shape: 3 leaves = node(node(l0, l1), l2)', () => {
      const leaves = makeLeaves(['1.00', '2.00', '3.00']);
      const [n0, n1, n2] = leaves.map((l) => sumLeaf('AED', l));
      const expected = sumNode('AED', sumNode('AED', n0!, n1!), n2!);
      const tree = buildMerkleSumTree('AED', leaves);
      expect(tree.root.hash.equals(expected.hash)).toBe(true);
      expect(tree.root.sum).toBe('6.00');
    });

    it('is deterministic and order sensitive', () => {
      const leaves = makeLeaves(['1.00', '2.00', '3.00']);
      const a = buildMerkleSumTree('AED', leaves);
      const b = buildMerkleSumTree('AED', [...leaves]);
      const c = buildMerkleSumTree('AED', [...leaves].reverse());
      expect(a.root.hash.equals(b.root.hash)).toBe(true);
      expect(a.root.hash.equals(c.root.hash)).toBe(false);
    });
  });

  describe('inclusion proofs', () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 13])(
      'verify for every leaf of a %i-leaf tree',
      (n) => {
        const leaves = makeLeaves(
          Array.from({ length: n }, (_, i) => `${i + 1}.25`),
        );
        for (let i = 0; i < n; i++) {
          const c = claimFor(leaves, i);
          expect(verifySumInclusion(c, c.rootHex, c.total)).toBe(true);
        }
      },
    );

    it('has an empty path in a one-leaf tree and log2-ish length otherwise', () => {
      expect(claimFor(makeLeaves(['1.00']), 0).path).toHaveLength(0);
      expect(
        claimFor(makeLeaves(Array(8).fill('1.00') as string[]), 3).path,
      ).toHaveLength(3);
    });

    it('rejects an index outside the tree when proving', () => {
      const tree = buildMerkleSumTree('AED', makeLeaves(['1.00', '2.00']));
      expect(() => sumInclusionProof(tree, 2)).toThrow(RangeError);
      expect(() => sumInclusionProof(tree, -1)).toThrow(RangeError);
    });

    it('rejects a changed balance, user or salt', () => {
      const leaves = makeLeaves(['1.00', '2.00', '3.00', '4.00', '5.00']);
      const c = claimFor(leaves, 2);
      for (const leaf of [
        { ...c.leaf, balance: '3.01' },
        { ...c.leaf, userId: user(42) },
        { ...c.leaf, salt: salt(42) },
      ]) {
        expect(verifySumInclusion({ ...c, leaf }, c.rootHex, c.total)).toBe(
          false,
        );
      }
    });

    it('rejects a wrong index, tree size, root or total', () => {
      const leaves = makeLeaves(['1.00', '2.00', '3.00', '4.00', '5.00']);
      const c = claimFor(leaves, 2);
      expect(verifySumInclusion({ ...c, index: 3 }, c.rootHex, c.total)).toBe(
        false,
      );
      // The tree size only fixes the shape; a size with a different path length cannot match
      expect(
        verifySumInclusion({ ...c, treeSize: 9 }, c.rootHex, c.total),
      ).toBe(false);
      expect(verifySumInclusion(c, '0'.repeat(64), c.total)).toBe(false);
      expect(verifySumInclusion(c, c.rootHex, '14.99')).toBe(false);
      expect(verifySumInclusion(c, c.rootHex, 'abc')).toBe(false);
    });

    it('rejects a tampered sibling hash or sum', () => {
      const leaves = makeLeaves(['1.00', '2.00', '3.00', '4.00']);
      const c = claimFor(leaves, 0);
      const hash = Buffer.from(c.path[0]!.hash);
      hash[0] = hash[0]! ^ 0xff;
      expect(
        verifySumInclusion(
          { ...c, path: [{ ...c.path[0]!, hash }, ...c.path.slice(1)] },
          c.rootHex,
          c.total,
        ),
      ).toBe(false);
      expect(
        verifySumInclusion(
          { ...c, path: [{ ...c.path[0]!, sum: '0.00' }, ...c.path.slice(1)] },
          c.rootHex,
          c.total,
        ),
      ).toBe(false);
    });

    it('rejects a path that is too short or too long', () => {
      const leaves = makeLeaves(['1.00', '2.00', '3.00', '4.00']);
      const c = claimFor(leaves, 1);
      expect(
        verifySumInclusion(
          { ...c, path: c.path.slice(0, 1) },
          c.rootHex,
          c.total,
        ),
      ).toBe(false);
      expect(
        verifySumInclusion(
          { ...c, path: [...c.path, c.path[0]!] },
          c.rootHex,
          c.total,
        ),
      ).toBe(false);
    });

    it('rejects a negative sibling sum even when the arithmetic is consistent', () => {
      // A dishonest operator adds a -50.00 branch to shrink the total shown to everyone else
      const mine = makeLeaves(['10.00'])[0]!;
      const myNode = sumLeaf('AED', mine);
      const hidden = { hash: Buffer.alloc(32, 7), sum: '-50.00' };
      const root = sumNode('AED', myNode, hidden);
      const claim: SumInclusionClaim = {
        currency: 'AED',
        leaf: mine,
        index: 0,
        treeSize: 2,
        path: [hidden],
      };
      expect(root.sum).toBe('-40.00');
      expect(reconstructSumRoot(claim)).toBeNull();
      expect(
        verifySumInclusion(claim, merkleHashToHex(root.hash), root.sum),
      ).toBe(false);
    });

    it('rejects malformed input without throwing', () => {
      const c = claimFor(makeLeaves(['1.00', '2.00']), 0);
      expect(
        verifySumInclusion(
          { ...c, path: [{ hash: Buffer.alloc(32), sum: '1.0' }] },
          c.rootHex,
          c.total,
        ),
      ).toBe(false);
      expect(
        verifySumInclusion(
          { ...c, path: [{ hash: Buffer.alloc(5), sum: '2.00' }] },
          c.rootHex,
          c.total,
        ),
      ).toBe(false);
      expect(
        verifySumInclusion({ ...c, treeSize: 0 }, c.rootHex, c.total),
      ).toBe(false);
      expect(verifySumInclusion({ ...c, index: 1.5 }, c.rootHex, c.total)).toBe(
        false,
      );
      expect(
        verifySumInclusion(
          { ...c, leaf: { ...c.leaf, balance: 'x' } },
          c.rootHex,
          c.total,
        ),
      ).toBe(false);
    });

    it('does not verify a proof for another currency', () => {
      const leaves = makeLeaves(['1.00', '2.00']);
      const c = claimFor(leaves, 0);
      expect(
        verifySumInclusion({ ...c, currency: 'USD' }, c.rootHex, c.total),
      ).toBe(false);
    });
  });
});
