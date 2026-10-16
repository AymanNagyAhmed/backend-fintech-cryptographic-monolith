import { WitnessService } from './witness.service.js';
import { auditLeafDigest, merkleHashToHex, merkleRoot } from '../../common/crypto/merkle.js';
import { sthContentHash } from './sth-payload.js';

describe('WitnessService', () => {
  it('detects leaf truncation against published treeSize', async () => {
    const leaves = [
      { hash: 'aa'.repeat(32) },
      { hash: 'bb'.repeat(32) },
    ];
    const digests = leaves.map((l) => auditLeafDigest(l.hash));
    const root1 = merkleHashToHex(merkleRoot(digests.slice(0, 1), true));
    const root2 = merkleHashToHex(merkleRoot(digests, true));
    const t1 = new Date('2026-10-16T20:00:00Z');
    const t2 = new Date('2026-10-16T20:01:00Z');
    const prevHash = sthContentHash({
      treeSize: 1,
      rootHash: root1,
      timestamp: t1.toISOString(),
      previousSthHash: null,
    });
    const prisma = {
      treeHead: {
        findMany: vi.fn().mockResolvedValue([
          {
            treeSize: 1,
            rootHash: root1,
            timestamp: t1,
            previousSthHash: null,
          },
          {
            treeSize: 100,
            rootHash: root2,
            timestamp: t2,
            previousSthHash: prevHash,
          },
        ]),
      },
      // Only 2 leaves exist — simulates deleting the last 98 rows (2.3)
      auditEvent: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue(leaves),
      },
    };
    const report = await new WitnessService(prisma as never).check();
    expect(report.ok).toBe(false);
    expect(report.forkAt?.reason).toMatch(/only 2 leaves/);
  });
});
