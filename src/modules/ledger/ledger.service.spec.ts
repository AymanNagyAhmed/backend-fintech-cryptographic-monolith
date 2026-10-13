import type { PrismaService } from '../../database/prisma.service.js';
import { AccountKind, Prisma } from '../../generated/prisma/client.js';
import { LedgerService } from './ledger.service.js';

describe('LedgerService', () => {
  let account: Record<string, ReturnType<typeof vi.fn>>;
  let service: LedgerService;

  beforeEach(() => {
    account = { create: vi.fn(), upsert: vi.fn(), findUnique: vi.fn() };
    service = new LedgerService({ account } as unknown as PrismaService);
  });

  describe('openWalletAccount', () => {
    it('creates a wallet account in the currency', async () => {
      account.create.mockResolvedValue({ id: 'a1', currency: 'BTC' });
      await service.openWalletAccount('BTC');
      expect(account.create).toHaveBeenCalledWith({
        data: { currency: 'BTC', kind: AccountKind.wallet },
      });
    });

    it('uses the transaction client when one is given', async () => {
      const tx = { account: { create: vi.fn().mockResolvedValue({}) } };
      await service.openWalletAccount(
        'AED',
        tx as unknown as Prisma.TransactionClient,
      );
      expect(tx.account.create).toHaveBeenCalledOnce();
      expect(account.create).not.toHaveBeenCalled();
    });

    it('rejects an unsupported currency before the database', async () => {
      await expect(service.openWalletAccount('GBP')).rejects.toMatchObject({
        code: 'UNSUPPORTED_CURRENCY',
        statusCode: 422,
      });
      expect(account.create).not.toHaveBeenCalled();
    });
  });

  describe('ensureSystemAccount', () => {
    const input = { code: 'external_clearing:AED', currency: 'AED' };

    it('upserts on the code without changing an existing account', async () => {
      account.upsert.mockResolvedValue({
        id: 's1',
        currency: 'AED',
        allowNegative: true,
      });
      await service.ensureSystemAccount({ ...input, allowNegative: true });
      expect(account.upsert).toHaveBeenCalledWith({
        where: { code: input.code },
        create: {
          code: input.code,
          currency: 'AED',
          kind: AccountKind.system,
          allowNegative: true,
        },
        update: {},
      });
    });

    it.each([
      [{ currency: 'USD', allowNegative: false }],
      [{ currency: 'AED', allowNegative: true }],
    ])(
      'fails with SYSTEM_ACCOUNT_MISMATCH when the stored account differs (%o)',
      async (stored) => {
        account.upsert.mockResolvedValue({ id: 's1', ...stored });
        await expect(service.ensureSystemAccount(input)).rejects.toMatchObject({
          code: 'SYSTEM_ACCOUNT_MISMATCH',
          statusCode: 500,
          expose: false,
        });
      },
    );
  });
});
