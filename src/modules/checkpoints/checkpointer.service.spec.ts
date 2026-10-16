import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import type { SignerService } from '../crypto/signer.service.js';
import { CheckpointerService } from './checkpointer.service.js';
import { auditLeafDigest, merkleHashToHex, merkleRoot } from './merkle.js';
import type { TsaService } from './tsa.service.js';
import type { WormService } from './worm.service.js';

describe('CheckpointerService', () => {
  const config = {
    get: () => 'audit-signing',
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const tsa = {
    stampTreeHead: vi.fn().mockResolvedValue(undefined),
  } as unknown as TsaService;
  const worm = {
    putBatch: vi.fn().mockResolvedValue({ key: 'k', skipped: false }),
  } as unknown as WormService;

  it('returns empty when there are no audit events', async () => {
    const prisma = {
      auditEvent: { findMany: vi.fn().mockResolvedValue([]) },
      treeHead: { findFirst: vi.fn() },
    };
    const signer = { sign: vi.fn() } as unknown as SignerService;
    const service = new CheckpointerService(
      prisma as never,
      signer,
      tsa,
      worm,
      config,
    );
    await expect(service.build()).resolves.toEqual({
      treeSize: 0,
      rootHash: '',
      fromEventId: null,
      toEventId: null,
      empty: true,
    });
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('skips signing when an STH already covers this tree size', async () => {
    const rows = [
      { id: 'e1', hash: 'aa'.repeat(32) },
      { id: 'e2', hash: 'bb'.repeat(32) },
    ];
    const prisma = {
      auditEvent: { findMany: vi.fn().mockResolvedValue(rows) },
      treeHead: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'sth1',
          treeSize: 2,
          rootHash: 'cc'.repeat(32),
        }),
        create: vi.fn(),
      },
    };
    const signer = { sign: vi.fn() } as unknown as SignerService;
    const service = new CheckpointerService(
      prisma as never,
      signer,
      tsa,
      worm,
      config,
    );
    const result = await service.build();
    expect(result.skipped).toBe(true);
    expect(result.sthId).toBe('sth1');
    expect(signer.sign).not.toHaveBeenCalled();
    expect(prisma.treeHead.create).not.toHaveBeenCalled();
  });

  it('signs and stores a new STH when the tree grew', async () => {
    const rows = [
      { id: 'e1', hash: 'aa'.repeat(32) },
      { id: 'e2', hash: 'bb'.repeat(32) },
    ];
    const expectedRoot = merkleHashToHex(
      merkleRoot(
        rows.map((r) => auditLeafDigest(r.hash)),
        true,
      ),
    );
    const prisma = {
      auditEvent: { findMany: vi.fn().mockResolvedValue(rows) },
      treeHead: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'sth-new' }),
      },
    };
    const signer = {
      sign: vi.fn().mockResolvedValue({
        alg: 'ed25519',
        keyId: 'audit-signing:v1',
        sig: 'dGVzdA==',
      }),
    } as unknown as SignerService;
    const service = new CheckpointerService(
      prisma as never,
      signer,
      tsa,
      worm,
      config,
    );
    const result = await service.build();
    expect(result).toMatchObject({
      treeSize: 2,
      rootHash: expectedRoot,
      sthId: 'sth-new',
      empty: false,
    });
    expect(signer.sign).toHaveBeenCalledOnce();
    expect(tsa.stampTreeHead).toHaveBeenCalledWith(
      'sth-new',
      expect.objectContaining({ treeSize: 2, rootHash: expectedRoot }),
    );
    expect(worm.putBatch).toHaveBeenCalledWith(2);
    expect(prisma.treeHead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        treeSize: 2,
        rootHash: expectedRoot,
        alg: 'ed25519',
        keyId: 'audit-signing:v1',
        previousSthHash: null,
      }),
    });
  });
});
