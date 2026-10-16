import { Money } from '../../common/money/money.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { merkleHashToHex } from '../checkpoints/merkle.js';
import type { WalletsService } from '../wallets/wallets.service.js';
import {
  buildMerkleSumTree,
  sumInclusionProof,
  verifySumInclusion,
} from './merkle-sum.js';
import { ReservesService } from './reserves.service.js';

const NOW = new Date('2026-10-16T21:30:00Z');
const U1 = '0199c1a0-0000-7000-8000-000000000001';
const U2 = '0199c1a0-0000-7000-8000-000000000002';
const U3 = '0199c1a0-0000-7000-8000-000000000003';

const aed = (s: string) => Money.of(s, 'AED');

describe('ReservesService.buildDailySnapshot', () => {
  let snapshot: Record<string, ReturnType<typeof vi.fn>>;
  let leaf: Record<string, ReturnType<typeof vi.fn>>;
  let withTx: ReturnType<typeof vi.fn>;
  let wallets: { sumBalancesByOwner: ReturnType<typeof vi.fn> };
  let service: ReservesService;

  beforeEach(() => {
    snapshot = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'snap1',
        ...data,
        publishedAt: new Date('2026-10-16T21:30:01Z'),
      })),
    };
    leaf = { createMany: vi.fn().mockResolvedValue({ count: 0 }) };
    const tx = { reservesSnapshot: snapshot, reservesLeaf: leaf };
    withTx = vi.fn((fn: (t: typeof tx) => unknown) => fn(tx));
    wallets = {
      sumBalancesByOwner: vi.fn().mockResolvedValue(
        new Map([
          [U3, aed('3.00')],
          [U1, aed('10.50')],
          [U2, aed('0.00')],
        ]),
      ),
    };
    service = new ReservesService(
      { reservesSnapshot: snapshot, withTx } as unknown as PrismaService,
      wallets as unknown as WalletsService,
    );
  });

  it('commits positive balances ordered by user id and stores snapshot and leaves', async () => {
    const view = await service.buildDailySnapshot('AED', NOW);

    expect(wallets.sumBalancesByOwner).toHaveBeenCalledWith('AED');
    expect(view).toMatchObject({
      id: 'snap1',
      currency: 'AED',
      snapshotDate: '2026-10-16',
      treeSize: 2,
      totalLiabilities: '13.50',
      publishedAt: '2026-10-16T21:30:01.000Z',
    });
    expect(view.rootHash).toMatch(/^[0-9a-f]{64}$/);

    expect(snapshot.create).toHaveBeenCalledWith({
      data: {
        currency: 'AED',
        snapshotDate: new Date('2026-10-16T00:00:00.000Z'),
        treeSize: 2,
        rootHash: view.rootHash,
        totalLiabilities: '13.50',
      },
    });
    const rows = leaf.createMany.mock.calls[0]![0].data as {
      snapshotId: string;
      leafIndex: number;
      userId: string;
      balance: string;
      salt: string;
      leafHash: string;
    }[];
    expect(rows.map((r) => [r.leafIndex, r.userId, r.balance])).toEqual([
      [0, U1, '10.50'],
      [1, U3, '3.00'],
    ]);
    expect(rows.every((r) => r.snapshotId === 'snap1')).toBe(true);
    expect(rows.every((r) => /^[0-9a-f]{32}$/.test(r.salt))).toBe(true);
    expect(rows[0]!.salt).not.toBe(rows[1]!.salt);
  });

  it('stores leaves a client can verify against the published root and total', async () => {
    const view = await service.buildDailySnapshot('AED', NOW);
    const rows = leaf.createMany.mock.calls[0]![0].data as {
      userId: string;
      balance: string;
      salt: string;
    }[];
    const leaves = rows.map((r) => ({
      userId: r.userId,
      balance: r.balance,
      salt: r.salt,
    }));
    const tree = buildMerkleSumTree('AED', leaves);
    expect(merkleHashToHex(tree.root.hash)).toBe(view.rootHash);
    const claim = {
      currency: 'AED' as const,
      leaf: leaves[1]!,
      index: 1,
      treeSize: view.treeSize,
      path: sumInclusionProof(tree, 1),
    };
    expect(
      verifySumInclusion(claim, view.rootHash, view.totalLiabilities),
    ).toBe(true);
  });

  it('inserts leaves in chunks', async () => {
    const many = new Map(
      Array.from({ length: 2500 }, (_, i) => [
        `0199c1a0-0000-7000-8000-${String(i).padStart(12, '0')}`,
        aed('1.00'),
      ]),
    );
    wallets.sumBalancesByOwner.mockResolvedValue(many);
    const view = await service.buildDailySnapshot('AED', NOW);
    expect(view.treeSize).toBe(2500);
    expect(view.totalLiabilities).toBe('2500.00');
    expect(leaf.createMany).toHaveBeenCalledTimes(3);
    const indexes = leaf.createMany.mock.calls.flatMap((c) =>
      (c[0].data as { leafIndex: number }[]).map((r) => r.leafIndex),
    );
    expect(indexes).toEqual(Array.from({ length: 2500 }, (_, i) => i));
  });

  it('rejects an unsupported currency before reading anything', async () => {
    await expect(service.buildDailySnapshot('GBP', NOW)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CURRENCY',
    });
    expect(snapshot.findUnique).not.toHaveBeenCalled();
    expect(wallets.sumBalancesByOwner).not.toHaveBeenCalled();
  });

  it('answers RESERVES_SNAPSHOT_EXISTS (409) when today is already published', async () => {
    snapshot.findUnique.mockResolvedValue({ id: 'old' });
    await expect(service.buildDailySnapshot('AED', NOW)).rejects.toMatchObject({
      code: 'RESERVES_SNAPSHOT_EXISTS',
      statusCode: 409,
    });
    expect(snapshot.findUnique).toHaveBeenCalledWith({
      where: {
        currency_snapshotDate: {
          currency: 'AED',
          snapshotDate: new Date('2026-10-16T00:00:00.000Z'),
        },
      },
      select: { id: true },
    });
    expect(wallets.sumBalancesByOwner).not.toHaveBeenCalled();
  });

  it('maps a concurrent insert (unique violation) to RESERVES_SNAPSHOT_EXISTS', async () => {
    withTx.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(service.buildDailySnapshot('AED', NOW)).rejects.toMatchObject({
      code: 'RESERVES_SNAPSHOT_EXISTS',
      statusCode: 409,
    });
  });

  it('rethrows other database errors', async () => {
    const error = new Error('connection lost');
    withTx.mockRejectedValue(error);
    await expect(service.buildDailySnapshot('AED', NOW)).rejects.toBe(error);
  });

  it('answers RESERVES_NO_LIABILITIES (422) when no client holds a balance', async () => {
    wallets.sumBalancesByOwner.mockResolvedValue(new Map([[U1, aed('0.00')]]));
    await expect(service.buildDailySnapshot('AED', NOW)).rejects.toMatchObject({
      code: 'RESERVES_NO_LIABILITIES',
      statusCode: 422,
    });
    expect(withTx).not.toHaveBeenCalled();
  });
});

describe('ReservesService.proofForUser', () => {
  it('returns leaf salt and path for the caller', async () => {
    const leaves = [
      { userId: U1, balance: '10.00', salt: 'aa'.repeat(16) },
      { userId: U2, balance: '20.00', salt: 'bb'.repeat(16) },
    ];
    const tree = buildMerkleSumTree('AED', leaves);
    const snapshot = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'snap1',
        currency: 'AED',
        snapshotDate: new Date('2026-10-16T00:00:00Z'),
        treeSize: 2,
        rootHash: merkleHashToHex(tree.root.hash),
        totalLiabilities: new Prisma.Decimal(tree.root.sum),
      }),
    };
    const leaf = {
      findMany: vi.fn().mockResolvedValue(
        leaves.map((l, i) => ({
          snapshotId: 'snap1',
          leafIndex: i,
          userId: l.userId,
          balance: new Prisma.Decimal(l.balance),
          salt: l.salt,
          leafHash: merkleHashToHex(tree.leaves[i]!.hash),
        })),
      ),
    };
    const service = new ReservesService(
      {
        reservesSnapshot: snapshot,
        reservesLeaf: leaf,
      } as unknown as PrismaService,
      { sumBalancesByOwner: vi.fn() } as unknown as WalletsService,
    );
    const proof = await service.proofForUser(U1, 'AED');
    expect(proof.leafIndex).toBe(0);
    expect(proof.salt).toBe(leaves[0]!.salt);
    expect(
      verifySumInclusion(
        {
          currency: 'AED',
          leaf: leaves[0]!,
          index: proof.leafIndex,
          treeSize: proof.treeSize,
          path: sumInclusionProof(tree, 0),
        },
        proof.rootHash,
        proof.totalLiabilities,
      ),
    ).toBe(true);
  });
});

describe('ReservesService.compareToReserves', () => {
  it('passes when reserves >= liabilities', async () => {
    const service = new ReservesService(
      {
        reservesSnapshot: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'snap1',
            totalLiabilities: new Prisma.Decimal('100.00'),
          }),
        },
      } as unknown as PrismaService,
      { sumBalancesByOwner: vi.fn() } as unknown as WalletsService,
    );
    await expect(
      service.compareToReserves('AED', '100.00'),
    ).resolves.toMatchObject({ ok: true, liabilities: '100.00' });
  });

  it('rejects under-collateralization', async () => {
    const service = new ReservesService(
      {
        reservesSnapshot: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'snap1',
            totalLiabilities: new Prisma.Decimal('100.00'),
          }),
        },
      } as unknown as PrismaService,
      { sumBalancesByOwner: vi.fn() } as unknown as WalletsService,
    );
    await expect(
      service.compareToReserves('AED', '99.99'),
    ).rejects.toMatchObject({ code: 'RESERVES_UNDER_COLLATERALIZED' });
  });
});
