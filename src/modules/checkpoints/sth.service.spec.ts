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
    expect(dto.clockQuality).toBe('ok');
  });

  it('throws when none exist', async () => {
    const prisma = {
      treeHead: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(new SthService(prisma as never).latest()).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
