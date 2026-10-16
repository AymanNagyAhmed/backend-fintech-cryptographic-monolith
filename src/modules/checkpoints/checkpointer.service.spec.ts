import { CheckpointerService } from './checkpointer.service.js';
import { auditLeafDigest, merkleHashToHex, merkleRoot } from './merkle.js';

describe('CheckpointerService', () => {
  it('returns empty when there are no audit events', async () => {
    const prisma = {
      auditEvent: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new CheckpointerService(prisma as never);
    await expect(service.build()).resolves.toEqual({
      treeSize: 0,
      rootHash: '',
      fromEventId: null,
      toEventId: null,
      empty: true,
    });
  });

  it('builds a root over ordered leaf hashes', async () => {
    const rows = [
      { id: 'e1', hash: 'aa'.repeat(32) },
      { id: 'e2', hash: 'bb'.repeat(32) },
    ];
    const prisma = {
      auditEvent: { findMany: vi.fn().mockResolvedValue(rows) },
    };
    const service = new CheckpointerService(prisma as never);
    const result = await service.build();
    const expected = merkleRoot(
      rows.map((r) => auditLeafDigest(r.hash)),
      true,
    );
    expect(result).toEqual({
      treeSize: 2,
      rootHash: merkleHashToHex(expected),
      fromEventId: 'e1',
      toEventId: 'e2',
      empty: false,
    });
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, hash: true },
    });
  });
});
