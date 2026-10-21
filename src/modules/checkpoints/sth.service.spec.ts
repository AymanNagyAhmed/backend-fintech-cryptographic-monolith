import { NotFoundException } from '@nestjs/common';
import { SthService } from './sth.service.js';

describe('SthService', () => {
  it('returns the latest STH', async () => {
    const prisma = {
      treeHead: {
        findFirst: vi.fn().mockResolvedValue({
          id: 's1',
          treeSize: 4,
          rootHash: 'ab'.repeat(32),
          timestamp: new Date('2026-10-16T20:00:00Z'),
          previousSthHash: null,
          alg: 'ed25519',
          keyId: 'audit-signing:v1',
          signature: 'dGVzdA==',
          tsaToken: Buffer.from('tok'),
          clockQuality: 'ok',
        }),
      },
    };
    const dto = await new SthService(prisma as never).latest();
    expect(dto.treeSize).toBe(4);
    expect(dto.hasTsaToken).toBe(true);
    expect(dto.timeAnchored).toBe(true);
    expect(dto.clockQuality).toBe('ok');
  });

  it('keeps timeAnchored false until stampTreeHead stores the token', async () => {
    const row = {
      id: 's1',
      treeSize: 4,
      rootHash: 'ab'.repeat(32),
      timestamp: new Date('2026-10-16T20:00:00Z'),
      previousSthHash: null,
      alg: 'ed25519',
      keyId: 'audit-signing:v1',
      signature: 'dGVzdA==',
      tsaToken: null as Uint8Array | null,
      clockQuality: 'unknown',
    };
    const prisma = {
      treeHead: { findFirst: vi.fn().mockResolvedValue(row) },
    };
    const service = new SthService(prisma as never);
    const before = await service.latest();
    expect(before.timeAnchored).toBe(false);
    expect(before.hasTsaToken).toBe(false);

    row.tsaToken = Buffer.from('tok');
    const after = await service.latest();
    expect(after.id).toBe('s1');
    expect(after.timeAnchored).toBe(true);
    expect(after.hasTsaToken).toBe(true);
  });

  it('latestAnchored skips a newer head that has no token', async () => {
    const anchored = {
      id: 'older',
      treeSize: 2,
      rootHash: 'cd'.repeat(32),
      timestamp: new Date('2026-10-16T19:00:00Z'),
      previousSthHash: null,
      alg: 'ed25519',
      keyId: 'audit-signing:v1',
      signature: 'dGVzdA==',
      tsaToken: Buffer.from('tok'),
      clockQuality: 'ok',
    };
    const prisma = {
      treeHead: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              ...anchored,
              id: 'newer',
              treeSize: 4,
              tsaToken: Buffer.alloc(0),
            },
            anchored,
          ]),
      },
    };
    const dto = await new SthService(prisma as never).latestAnchored();
    expect(dto.id).toBe('older');
    expect(dto.treeSize).toBe(2);
    expect(dto.timeAnchored).toBe(true);
  });

  it('latestAnchored throws when no token is stored', async () => {
    const prisma = {
      treeHead: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { tsaToken: null },
            { tsaToken: Buffer.alloc(0) },
          ]),
      },
    };
    await expect(
      new SthService(prisma as never).latestAnchored(),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when none exist', async () => {
    const prisma = {
      treeHead: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      new SthService(prisma as never).latest(),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
