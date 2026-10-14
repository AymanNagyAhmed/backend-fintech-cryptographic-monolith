import type { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { LedgerService } from '../ledger/ledger.service.js';
import type { WalletsService } from '../wallets/wallets.service.js';
import type { CreateTransferDto } from './dto/create-transfer.dto.js';
import { TransfersService } from './transfers.service.js';

describe('TransfersService.create', () => {
  const userId = 'u1';
  const dto = {
    fromWalletId: 'w-from',
    toWalletId: 'w-to',
    amount: '10.5',
    currency: 'AED',
  } satisfies CreateTransferDto;
  const wallet = (id: string, currency = 'AED') => ({
    id,
    currency,
    ledgerAccountId: `acc-${id}`,
  });
  const tx = { transfer: { create: vi.fn() } };
  let runOnce: ReturnType<typeof vi.fn>;
  let post: ReturnType<typeof vi.fn>;
  let findOwned: ReturnType<typeof vi.fn>;
  let findById: ReturnType<typeof vi.fn>;
  let service: TransfersService;

  beforeEach(() => {
    vi.clearAllMocks();
    runOnce = vi.fn(
      async (
        _s: string,
        _k: string,
        _r: unknown,
        work: (t: unknown) => unknown,
      ) => ({
        statusCode: 201,
        body: await work(tx),
        replayed: false,
      }),
    );
    post = vi.fn().mockResolvedValue({});
    findOwned = vi.fn().mockResolvedValue(wallet('w-from'));
    findById = vi.fn().mockResolvedValue(wallet('w-to'));
    tx.transfer.create.mockImplementation(({ data }: { data: object }) => ({
      id: 't1',
      createdAt: new Date('2026-10-14T18:30:00Z'),
      ...data,
      amount: new Prisma.Decimal('10.5'),
    }));
    service = new TransfersService(
      { runOnce } as unknown as IdempotencyService,
      { post } as unknown as LedgerService,
      { findOwned, findById } as unknown as WalletsService,
    );
  });

  it('runs once per caller-scoped key and stores a 201', async () => {
    await service.create(userId, 'key-1', dto);
    expect(runOnce).toHaveBeenCalledWith(
      'transfer:u1',
      'key-1',
      dto,
      expect.any(Function),
      { statusCode: 201 },
    );
  });

  it('posts -amount / +amount between the wallet accounts and records the transfer', async () => {
    const { body } = await service.create(userId, 'key-1', dto);
    expect(findOwned).toHaveBeenCalledWith('w-from', userId, tx);
    expect(findById).toHaveBeenCalledWith('w-to', tx);
    const posting = post.mock.calls[0][0] as { ref: string; entries: object[] };
    expect(posting.ref).toMatch(/^transfer:[0-9a-f-]{36}$/);
    expect(posting.entries).toEqual([
      { accountId: 'acc-w-from', amount: '-10.50' },
      { accountId: 'acc-w-to', amount: '10.50' },
    ]);
    expect(post.mock.calls[0][1]).toBe(tx);
    expect(tx.transfer.create).toHaveBeenCalledWith({
      data: {
        ref: posting.ref,
        fromAccountId: 'acc-w-from',
        toAccountId: 'acc-w-to',
        fromWalletId: 'w-from',
        toWalletId: 'w-to',
        amount: '10.50',
        currency: 'AED',
        initiatorUserId: userId,
      },
    });
    expect(body).toEqual({
      id: 't1',
      fromWalletId: 'w-from',
      toWalletId: 'w-to',
      amount: '10.50',
      currency: 'AED',
      status: 'COMPLETED',
      createdAt: '2026-10-14T18:30:00.000Z',
    });
  });

  it.each([
    [
      'the same wallet twice',
      { toWalletId: 'w-from' },
      'INVALID_TRANSFER',
      422,
    ],
    [
      'an unsupported currency',
      { currency: 'GBP' },
      'UNSUPPORTED_CURRENCY',
      422,
    ],
    [
      'more decimals than the currency allows',
      { amount: '1.001' },
      'INVALID_AMOUNT',
      422,
    ],
  ])(
    'rejects %s before reading wallets',
    async (_, change, code, statusCode) => {
      await expect(
        service.create(userId, 'k', { ...dto, ...change }),
      ).rejects.toMatchObject({ code, statusCode });
      expect(findOwned).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a source wallet the caller does not own', 'fromWalletId'],
    ['a missing target wallet', 'toWalletId'],
  ] as const)('answers 404 WALLET_NOT_FOUND for %s', async (_, field) => {
    (field === 'fromWalletId' ? findOwned : findById).mockResolvedValue(null);
    await expect(service.create(userId, 'k', dto)).rejects.toMatchObject({
      code: 'WALLET_NOT_FOUND',
      statusCode: 404,
      details: [{ field, issue: 'not found' }],
    });
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    ['source', 'fromWalletId'],
    ['target', 'toWalletId'],
  ] as const)(
    'answers 422 CURRENCY_MISMATCH for a %s wallet in another currency',
    async (_, field) => {
      (field === 'fromWalletId' ? findOwned : findById).mockResolvedValue(
        wallet(field, 'USD'),
      );
      await expect(service.create(userId, 'k', dto)).rejects.toMatchObject({
        code: 'CURRENCY_MISMATCH',
        details: [{ field, issue: 'wallet currency is USD' }],
      });
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('lets ledger errors (INSUFFICIENT_FUNDS) through and writes no transfer row', async () => {
    post.mockRejectedValue(
      Object.assign(new Error('funds'), { code: 'INSUFFICIENT_FUNDS' }),
    );
    await expect(service.create(userId, 'k', dto)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(tx.transfer.create).not.toHaveBeenCalled();
  });
});
