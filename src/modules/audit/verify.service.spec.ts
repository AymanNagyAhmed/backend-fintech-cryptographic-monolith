import type { PrismaService } from '../../database/prisma.service.js';
import { GENESIS_PREV_HASH, chainHash } from './chain-hash.js';
import { VerifyService } from './verify.service.js';

describe('VerifyService', () => {
  const payload = { type: 'transfer.completed', amount: '1' };
  const h1 = chainHash(GENESIS_PREV_HASH, payload);
  const h2 = chainHash(h1, payload);

  it('reports ok for a sound chain', async () => {
    const service = new VerifyService({
      auditEvent: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ partitionKey: '1' }])
          .mockResolvedValueOnce([
            {
              seq: 1n,
              payload,
              prevHash: GENESIS_PREV_HASH,
              hash: h1,
            },
            { seq: 2n, payload, prevHash: h1, hash: h2 },
          ]),
      },
    } as unknown as PrismaService);
    await expect(service.verify()).resolves.toMatchObject({
      ok: true,
      partitionsChecked: 1,
      eventsChecked: 2,
      brokenAt: null,
      gaps: [],
    });
  });

  it('reports brokenAt when a leaf hash is wrong', async () => {
    const service = new VerifyService({
      auditEvent: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ partitionKey: '1' }])
          .mockResolvedValueOnce([
            {
              seq: 1n,
              payload,
              prevHash: GENESIS_PREV_HASH,
              hash: 'a'.repeat(64),
            },
          ]),
      },
    } as unknown as PrismaService);
    await expect(service.verify()).resolves.toMatchObject({
      ok: false,
      brokenAt: { partition: '1', seq: '1' },
    });
  });

  it('reports gaps when seq skips', async () => {
    const service = new VerifyService({
      auditEvent: {
        findMany: vi.fn().mockResolvedValueOnce([
          {
            seq: 1n,
            payload,
            prevHash: GENESIS_PREV_HASH,
            hash: h1,
          },
          { seq: 3n, payload, prevHash: h1, hash: chainHash(h1, payload) },
        ]),
      },
    } as unknown as PrismaService);
    await expect(service.verify('1')).resolves.toMatchObject({
      ok: false,
      gaps: [{ partition: '1', seq: '2' }],
    });
  });
});
