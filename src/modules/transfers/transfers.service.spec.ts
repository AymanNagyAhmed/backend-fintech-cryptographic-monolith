import type { ConfigService } from '@nestjs/config';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AccountNotActiveException } from '../ledger/exceptions/account-not-active.exception.js';
import type { LedgerService } from '../ledger/ledger.service.js';
import type { OutboxService } from '../outbox/outbox.service.js';
import type { WalletsService } from '../wallets/wallets.service.js';
import type { CreateTransferDto } from './dto/create-transfer.dto.js';
import { TransfersService } from './transfers.service.js';

vi.mock('../../common/request-context.js', () => ({
  getRequestId: vi.fn(() => 'req_transfer_test'),
}));

describe('TransfersService.create', () => {
  const userId = 'u1';
  const dto = {
    fromWalletId: 'w-from',
    toWalletId: 'w-to',
    amount: '10.5',
    currency: 'AED',
  } satisfies CreateTransferDto;
  const wallet = (id: string, currency = 'AED', status = 'active') => ({
    id,
    currency,
    status,
    ledgerAccountId: `acc-${id}`,
  });
  const limits: Record<string, string> = {
    TRANSFER_DAILY_LIMIT_AED: '100.00',
    TRANSFER_DAILY_LIMIT_USD: '15000.00',
    TRANSFER_DAILY_LIMIT_EUR: '15000.00',
    TRANSFER_DAILY_LIMIT_BTC: '1.00000000',
  };
  const tx = { transfer: { create: vi.fn() }, $queryRawTyped: vi.fn() };
  let runOnce: ReturnType<typeof vi.fn>;
  let post: ReturnType<typeof vi.fn>;
  let findOwned: ReturnType<typeof vi.fn>;
  let findById: ReturnType<typeof vi.fn>;
  let enqueue: ReturnType<typeof vi.fn>;
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
    enqueue = vi.fn().mockResolvedValue('out-1');
    tx.transfer.create.mockImplementation(({ data }: { data: object }) => ({
      id: 't1',
      createdAt: new Date('2026-10-14T18:30:00Z'),
      ...data,
      amount: new Prisma.Decimal('10.5'),
    }));
    tx.$queryRawTyped.mockResolvedValue([{ total: '0.00000000' }]);
    service = new TransfersService(
      { runOnce } as unknown as IdempotencyService,
      { post } as unknown as LedgerService,
      { findOwned, findById } as unknown as WalletsService,
      { enqueue } as unknown as OutboxService,
      { get: (key: string) => limits[key] } as unknown as ConfigService<
        EnvironmentVariables,
        true
      >,
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
    expect(enqueue).toHaveBeenCalledWith(tx, 'ledger', {
      type: 'transfer.completed',
      schemaVersion: 1,
      occurredAt: '2026-10-14T18:30:00.000Z',
      actor: { subjectRef: userId },
      requestId: 'req_transfer_test',
      transferId: 't1',
      sourceWalletId: 'w-from',
      destinationWalletId: 'w-to',
      currency: 'AED',
      amount: '10.50',
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

  it('does not enqueue when the transfer row is never written', async () => {
    post.mockRejectedValue(
      Object.assign(new Error('funds'), { code: 'INSUFFICIENT_FUNDS' }),
    );
    await expect(service.create(userId, 'k', dto)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(enqueue).not.toHaveBeenCalled();
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

  it.each([
    ['source', 'fromWalletId', 'frozen', 'ACCOUNT_FROZEN'],
    ['source', 'fromWalletId', 'closed', 'ACCOUNT_CLOSED'],
    ['target', 'toWalletId', 'frozen', 'ACCOUNT_FROZEN'],
    ['target', 'toWalletId', 'closed', 'ACCOUNT_CLOSED'],
  ] as const)(
    'answers 422 for a %s wallet that is %s',
    async (_, field, status, code) => {
      (field === 'fromWalletId' ? findOwned : findById).mockResolvedValue(
        wallet(field, 'AED', status),
      );
      await expect(service.create(userId, 'k', dto)).rejects.toMatchObject({
        code,
        statusCode: 422,
        details: [{ field, issue: `wallet is ${status}` }],
      });
      expect(post).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['acc-w-from', 'frozen', 'fromWalletId', 'ACCOUNT_FROZEN'],
    ['acc-w-to', 'closed', 'toWalletId', 'ACCOUNT_CLOSED'],
  ] as const)(
    'maps ACCOUNT_NOT_ACTIVE of ledger account %s (%s) to the wallet field',
    async (accountId, status, field, code) => {
      post.mockRejectedValue(new AccountNotActiveException(accountId, status));
      const error = await service.create(userId, 'k', dto).catch((e) => e);
      expect(error).toMatchObject({ code, details: [{ field }] });
      expect(JSON.stringify(error.details)).not.toContain('acc-');
      expect(tx.transfer.create).not.toHaveBeenCalled();
    },
  );

  describe('daily limit (AED 100.00 here)', () => {
    const sent = (total: string | null) =>
      tx.$queryRawTyped.mockResolvedValue([{ total }]);

    it('sums the source account after the posting holds its lock', async () => {
      await service.create(userId, 'k', dto);
      expect(tx.$queryRawTyped.mock.calls[0][0].values).toEqual(['acc-w-from']);
      expect(post.mock.invocationCallOrder[0]).toBeLessThan(
        tx.$queryRawTyped.mock.invocationCallOrder[0],
      );
    });

    it.each([
      ['nothing sent yet', '0.00000000'],
      ['an empty sum', null],
      ['exactly the limit after this one', '89.50000000'],
    ])('allows the transfer with %s', async (_, total) => {
      sent(total);
      await expect(service.create(userId, 'k', dto)).resolves.toMatchObject({
        statusCode: 201,
      });
    });

    it('answers 422 DAILY_LIMIT_EXCEEDED one cent over and writes no transfer row', async () => {
      sent('89.51000000');
      await expect(service.create(userId, 'k', dto)).rejects.toMatchObject({
        code: 'DAILY_LIMIT_EXCEEDED',
        statusCode: 422,
        details: [
          {
            field: 'amount',
            issue: 'Daily limit is 100.00 AED, 89.51 sent today, 10.49 left',
          },
        ],
      });
      expect(tx.transfer.create).not.toHaveBeenCalled();
    });

    it('never reports a negative amount left after the limit was lowered', async () => {
      sent('150.00000000');
      await expect(service.create(userId, 'k', dto)).rejects.toMatchObject({
        details: [
          {
            issue: 'Daily limit is 100.00 AED, 150.00 sent today, 0.00 left',
          },
        ],
      });
    });
  });
});
