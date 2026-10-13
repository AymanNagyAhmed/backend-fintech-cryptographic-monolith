import type { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { WalletsService } from './wallets.service.js';

const input = {
  ownerUserId: '0199c1a0-0000-7000-8000-000000000001',
  currency: 'AED',
  ledgerAccountId: '0199c1a0-0000-7000-8000-000000000002',
};

const uniqueViolation = (index: string) =>
  new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
    meta: {
      driverAdapterError: {
        cause: { kind: 'UniqueConstraintViolation', constraint: { index } },
      },
    },
  });

describe('WalletsService', () => {
  let wallet: Record<string, ReturnType<typeof vi.fn>>;
  let service: WalletsService;

  beforeEach(() => {
    wallet = {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    };
    service = new WalletsService({ wallet } as unknown as PrismaService);
  });

  describe('create', () => {
    it('stores owner, currency and ledger account', async () => {
      wallet.create.mockResolvedValue({ id: 'w1', ...input });
      await expect(service.create(input)).resolves.toMatchObject({ id: 'w1' });
      expect(wallet.create).toHaveBeenCalledWith({ data: input });
    });

    it('uses the transaction client when one is given', async () => {
      const tx = {
        wallet: { create: vi.fn().mockResolvedValue({ id: 'w1' }) },
      };
      await service.create(input, tx as unknown as Prisma.TransactionClient);
      expect(tx.wallet.create).toHaveBeenCalledOnce();
      expect(wallet.create).not.toHaveBeenCalled();
    });

    it.each(['aed', 'GBP', 'BTC '])(
      'rejects %j with UNSUPPORTED_CURRENCY (422) before the database',
      async (currency) => {
        await expect(
          service.create({ ...input, currency }),
        ).rejects.toMatchObject({
          code: 'UNSUPPORTED_CURRENCY',
          statusCode: 422,
          details: [{ field: 'currency' }],
        });
        expect(wallet.create).not.toHaveBeenCalled();
      },
    );

    it('rethrows a unique violation (a reused ledger account is a bug)', async () => {
      const error = uniqueViolation('wallets_ledger_account_id_key');
      wallet.create.mockRejectedValue(error);
      await expect(service.create(input)).rejects.toBe(error);
    });
  });

  it('findOwned filters by owner', async () => {
    wallet.findFirst.mockResolvedValue(null);
    await expect(service.findOwned('w1', 'u2')).resolves.toBeNull();
    expect(wallet.findFirst).toHaveBeenCalledWith({
      where: { id: 'w1', ownerUserId: 'u2' },
    });
  });

  it('listByOwner orders by id', async () => {
    wallet.findMany.mockResolvedValue([]);
    await service.listByOwner('u1');
    expect(wallet.findMany).toHaveBeenCalledWith({
      where: { ownerUserId: 'u1' },
      orderBy: { id: 'asc' },
    });
  });
});
