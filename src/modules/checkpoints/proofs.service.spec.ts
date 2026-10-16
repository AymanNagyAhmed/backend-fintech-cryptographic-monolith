import { NotFoundException } from '@nestjs/common';
import { ProofsService } from './proofs.service.js';
import { auditLeafDigest, merkleHashToHex, merkleRoot } from '../../common/crypto/merkle.js';

describe('ProofsService.inclusionProofForEvent', () => {
  it('throws when the event is missing', async () => {
    const prisma = {
      auditEvent: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new ProofsService(prisma as never);
    await expect(service.inclusionProofForEvent('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns a verified proof against the latest STH', async () => {
    const leaves = [
      { id: 'e1', hash: 'aa'.repeat(32) },
      { id: 'e2', hash: 'bb'.repeat(32) },
      { id: 'e3', hash: 'cc'.repeat(32) },
    ];
    const digests = leaves.map((l) => auditLeafDigest(l.hash));
    const rootHash = merkleHashToHex(merkleRoot(digests, true));
    const prisma = {
      auditEvent: {
        findFirst: vi.fn().mockResolvedValue(leaves[1]),
        findMany: vi.fn().mockResolvedValue(leaves),
      },
      treeHead: {
        findFirst: vi.fn().mockResolvedValue({
          treeSize: 3,
          rootHash,
        }),
      },
    };
    const service = new ProofsService(prisma as never);
    const proof = await service.inclusionProofForEvent('e2');
    expect(proof.leafIndex).toBe(1);
    expect(proof.treeSize).toBe(3);
    expect(proof.verified).toBe(true);
    expect(proof.path.length).toBeGreaterThan(0);
  });

  it('returns a verified consistency proof between two STHs', async () => {
    const leaves = Array.from({ length: 7 }, (_, i) => ({
      hash: Buffer.alloc(32, i + 1).toString('hex'),
    }));
    const digests = leaves.map((l) => auditLeafDigest(l.hash));
    const fromRoot = merkleHashToHex(merkleRoot(digests.slice(0, 3), true));
    const toRoot = merkleHashToHex(merkleRoot(digests, true));
    const prisma = {
      treeHead: {
        findUnique: vi.fn(async ({ where }: { where: { treeSize: number } }) =>
          where.treeSize === 3
            ? { treeSize: 3, rootHash: fromRoot }
            : where.treeSize === 7
              ? { treeSize: 7, rootHash: toRoot }
              : null,
        ),
      },
      auditEvent: { findMany: vi.fn().mockResolvedValue(leaves) },
    };
    const service = new ProofsService(prisma as never);
    const proof = await service.consistencyProofBetween(3, 7);
    expect(proof.verified).toBe(true);
    expect(proof.path.length).toBeGreaterThan(0);
  });
});
