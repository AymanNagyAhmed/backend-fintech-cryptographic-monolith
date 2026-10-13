import type { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import type { LedgerService } from '../ledger/ledger.service.js';
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

const row = (
  id: string,
  ledgerAccountId: string,
  label: string | null = null,
) => ({
  id,
  ownerUserId: 'u1',
  currency: 'AED',
  ledgerAccountId,
  label,
  status: 'active',
  createdAt: new Date('2026-10-13T18:00:00Z'),
  updatedAt: new Date('2026-10-13T18:30:00Z'),
});

const MAX_PER_USER = 3;

describe('WalletsService', () => {
  let wallet: Record<string, ReturnType<typeof vi.fn>>;
  let ledger: Record<string, ReturnType<typeof vi.fn>>;
  let withTx: ReturnType<typeof vi.fn>;
  let lockRaw: ReturnType<typeof vi.fn>;
  let tx: Record<string, unknown>;
  let service: WalletsService;

  beforeEach(() => {
    wallet = {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    };
    ledger = {
      openWalletAccount: vi.fn(),
      getBalances: vi.fn(
        async (ids: string[]) => new Map(ids.map((id) => [id, '0.00'])),
      ),
    };
    lockRaw = vi.fn().mockResolvedValue(1);
    tx = { wallet, $executeRaw: lockRaw };
    withTx = vi.fn((fn: (t: typeof tx) => unknown) => fn(tx));
    const config = { get: vi.fn().mockReturnValue(MAX_PER_USER) };
    service = new WalletsService(
      { wallet, withTx } as unknown as PrismaService,
      ledger as unknown as LedgerService,
      config as unknown as ConfigService<EnvironmentVariables, true>,
    );
  });

  describe('open', () => {
    it('opens the ledger account and the wallet in one transaction', async () => {
      ledger.openWalletAccount.mockResolvedValue({ id: 'acc1' });
      wallet.create.mockResolvedValue(row('w1', 'acc1', 'Savings'));
      await expect(
        service.open('u1', { currency: 'AED', label: ' Savings' }),
      ).resolves.toEqual({
        id: 'w1',
        currency: 'AED',
        label: 'Savings',
        status: 'active',
        balance: '0.00',
        createdAt: '2026-10-13T18:00:00.000Z',
        updatedAt: '2026-10-13T18:30:00.000Z',
      });
      expect(withTx).toHaveBeenCalledOnce();
      expect(ledger.openWalletAccount).toHaveBeenCalledWith('AED', tx);
      expect(wallet.create).toHaveBeenCalledWith({
        data: {
          ownerUserId: 'u1',
          currency: 'AED',
          ledgerAccountId: 'acc1',
          label: 'Savings',
        },
      });
    });

    it.each([
      [{ currency: 'GBP' }, 'UNSUPPORTED_CURRENCY'],
      [{ currency: 'AED', label: '\u0007' }, 'INVALID_LABEL'],
    ])('rejects %o with %s before any transaction', async (input, code) => {
      await expect(service.open('u1', input)).rejects.toMatchObject({ code });
      expect(withTx).not.toHaveBeenCalled();
    });

    it('locks per owner, then counts the wallets that are not closed', async () => {
      ledger.openWalletAccount.mockResolvedValue({ id: 'acc1' });
      wallet.create.mockResolvedValue(row('w1', 'acc1'));
      wallet.count.mockResolvedValue(MAX_PER_USER - 1);
      await service.open('u1', { currency: 'AED' });
      expect(lockRaw).toHaveBeenCalledOnce();
      expect(lockRaw.mock.calls[0].slice(1)).toEqual(['u1']);
      expect(lockRaw.mock.invocationCallOrder[0]).toBeLessThan(
        wallet.count.mock.invocationCallOrder[0],
      );
      expect(wallet.count).toHaveBeenCalledWith({
        where: { ownerUserId: 'u1', status: { not: 'closed' } },
      });
    });

    it('answers WALLET_LIMIT_REACHED (422) at the limit and opens no account', async () => {
      wallet.count.mockResolvedValue(MAX_PER_USER);
      await expect(
        service.open('u1', { currency: 'AED' }),
      ).rejects.toMatchObject({
        code: 'WALLET_LIMIT_REACHED',
        statusCode: 422,
        details: [
          {
            field: 'currency',
            issue: `at most ${MAX_PER_USER} open wallets per user`,
          },
        ],
      });
      expect(ledger.openWalletAccount).not.toHaveBeenCalled();
      expect(wallet.create).not.toHaveBeenCalled();
    });

    it('never answers without the balance (missing account is a bug)', async () => {
      ledger.openWalletAccount.mockResolvedValue({ id: 'acc1' });
      wallet.create.mockResolvedValue(row('w1', 'acc1'));
      ledger.getBalances.mockResolvedValue(new Map());
      await expect(service.open('u1', { currency: 'AED' })).rejects.toThrow(
        /Ledger account of wallet w1 not found/,
      );
    });
  });

  describe('getOwned', () => {
    it('returns the wallet with its balance', async () => {
      wallet.findFirst.mockResolvedValue(row('w1', 'acc1'));
      ledger.getBalances.mockResolvedValue(new Map([['acc1', '12.50']]));
      await expect(service.getOwned('w1', 'u1')).resolves.toMatchObject({
        id: 'w1',
        balance: '12.50',
      });
    });

    it('answers WALLET_NOT_FOUND (404) for a wallet the caller does not own', async () => {
      wallet.findFirst.mockResolvedValue(null);
      await expect(service.getOwned('w1', 'u2')).rejects.toMatchObject({
        code: 'WALLET_NOT_FOUND',
        statusCode: 404,
      });
    });
  });

  describe('listPage', () => {
    it('fetches one extra row to know whether a next page exists', async () => {
      wallet.findMany.mockResolvedValue([
        row('w1', 'a1'),
        row('w2', 'a2'),
        row('w3', 'a3'),
      ]);
      const page = await service.listPage('u1', { cursor: 'w0', limit: 2 });
      expect(wallet.findMany).toHaveBeenCalledWith({
        where: { ownerUserId: 'u1', id: { gt: 'w0' } },
        orderBy: { id: 'asc' },
        take: 3,
      });
      expect(page.items.map((w) => w.id)).toEqual(['w1', 'w2']);
      expect(page.nextCursor).toBe('w2');
      expect(ledger.getBalances).toHaveBeenCalledWith(['a1', 'a2']);
    });

    it('has no next cursor on the last page and no cursor filter on the first', async () => {
      wallet.findMany.mockResolvedValue([row('w1', 'a1')]);
      const page = await service.listPage('u1', { limit: 2 });
      expect(wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerUserId: 'u1' } }),
      );
      expect(page.nextCursor).toBeNull();
    });

    it('returns an empty page for an owner without wallets', async () => {
      wallet.findMany.mockResolvedValue([]);
      await expect(service.listPage('u1', { limit: 20 })).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
    });
  });

  it('renameOwned returns the renamed wallet with its balance', async () => {
    wallet.update.mockResolvedValue(row('w1', 'acc1', 'Travel'));
    await expect(
      service.renameOwned('w1', 'u1', 'Travel'),
    ).resolves.toMatchObject({ label: 'Travel', balance: '0.00' });
  });

  describe('create', () => {
    it('stores owner, currency and ledger account without a label', async () => {
      wallet.create.mockResolvedValue({ id: 'w1', ...input });
      await expect(service.create(input)).resolves.toMatchObject({ id: 'w1' });
      expect(wallet.create).toHaveBeenCalledWith({
        data: { ...input, label: null },
      });
    });

    it('stores the normalized label', async () => {
      wallet.create.mockResolvedValue({ id: 'w1' });
      await service.create({ ...input, label: '  Savings ' });
      expect(wallet.create).toHaveBeenCalledWith({
        data: { ...input, label: 'Savings' },
      });
    });

    it('rejects an invalid label with INVALID_LABEL (422) before the database', async () => {
      await expect(
        service.create({ ...input, label: 'a\nb' }),
      ).rejects.toMatchObject({ code: 'INVALID_LABEL', statusCode: 422 });
      expect(wallet.create).not.toHaveBeenCalled();
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

  describe('rename', () => {
    const notFound = () =>
      new Prisma.PrismaClientKnownRequestError('not found', {
        code: 'P2025',
        clientVersion: 'test',
      });

    it('updates only an owned wallet that is not closed', async () => {
      wallet.update.mockResolvedValue({ id: 'w1', label: 'Travel' });
      await expect(
        service.rename('w1', 'u1', ' Travel'),
      ).resolves.toMatchObject({ label: 'Travel' });
      expect(wallet.update).toHaveBeenCalledWith({
        where: { id: 'w1', ownerUserId: 'u1', status: { not: 'closed' } },
        data: { label: 'Travel' },
      });
    });

    it('null clears the label', async () => {
      wallet.update.mockResolvedValue({ id: 'w1', label: null });
      await service.rename('w1', 'u1', null);
      expect(wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { label: null } }),
      );
    });

    it('rejects an invalid label before the database', async () => {
      await expect(service.rename('w1', 'u1', '  ')).rejects.toMatchObject({
        code: 'INVALID_LABEL',
      });
      expect(wallet.update).not.toHaveBeenCalled();
    });

    it("answers WALLET_NOT_FOUND (404) for a missing or another user's wallet", async () => {
      wallet.update.mockRejectedValue(notFound());
      wallet.findFirst.mockResolvedValue(null);
      await expect(service.rename('w1', 'u2', 'x')).rejects.toMatchObject({
        code: 'WALLET_NOT_FOUND',
        statusCode: 404,
      });
      expect(wallet.findFirst).toHaveBeenCalledWith({
        where: { id: 'w1', ownerUserId: 'u2' },
        select: { id: true },
      });
    });

    it('answers WALLET_CLOSED (409) for an owned closed wallet', async () => {
      wallet.update.mockRejectedValue(notFound());
      wallet.findFirst.mockResolvedValue({ id: 'w1' });
      await expect(service.rename('w1', 'u1', 'x')).rejects.toMatchObject({
        code: 'WALLET_CLOSED',
        statusCode: 409,
      });
    });

    it('rethrows other database errors', async () => {
      const error = new Error('connection lost');
      wallet.update.mockRejectedValue(error);
      await expect(service.rename('w1', 'u1', 'x')).rejects.toBe(error);
      expect(wallet.findFirst).not.toHaveBeenCalled();
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
