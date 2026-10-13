import type { PrismaService } from '../../database/prisma.service.js';
import { AccountKind, Prisma } from '../../generated/prisma/client.js';
import { LedgerService } from './ledger.service.js';

describe('LedgerService', () => {
  let account: Record<string, ReturnType<typeof vi.fn>>;
  let service: LedgerService;

  beforeEach(() => {
    account = {
      create: vi.fn(),
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    };
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
    const input = { code: 'external_clearing:aed', currency: 'AED' };

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

  describe('getBalances', () => {
    it('formats balances at the currency scale, also tiny BTC amounts', async () => {
      account.findMany.mockResolvedValue([
        { id: 'a1', currency: 'AED', balance: new Prisma.Decimal('12.5') },
        { id: 'a2', currency: 'BTC', balance: new Prisma.Decimal('1e-8') },
        { id: 'a3', currency: 'USD', balance: new Prisma.Decimal('0') },
      ]);
      const balances = await service.getBalances(['a1', 'a2', 'a3', 'a1']);
      expect(Object.fromEntries(balances)).toEqual({
        a1: '12.50',
        a2: '0.00000001',
        a3: '0.00',
      });
      expect(account.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['a1', 'a2', 'a3'] } },
        select: { id: true, balance: true, currency: true },
      });
    });

    it('skips the database for no ids', async () => {
      await expect(service.getBalances([])).resolves.toEqual(new Map());
      expect(account.findMany).not.toHaveBeenCalled();
    });
  });
});

describe('LedgerService.post', () => {
  const A = '0199c1a0-0000-7000-8000-00000000000a';
  const B = '0199c1a0-0000-7000-8000-00000000000b';
  const row = (id: string, balance: string, extra = {}) => ({
    id,
    currency: 'AED',
    kind: 'wallet',
    allow_negative: false,
    balance: new Prisma.Decimal(balance),
    status: 'active',
    ...extra,
  });
  const transfer = (amount = '10.00') => ({
    ref: 'transfer:1',
    entries: [
      { accountId: A, amount: `-${amount}` },
      { accountId: B, amount },
    ],
  });

  let tx: {
    posting: { create: ReturnType<typeof vi.fn> };
    $queryRawTyped: ReturnType<typeof vi.fn>;
    ledgerEntry: { createManyAndReturn: ReturnType<typeof vi.fn> };
    account: { update: ReturnType<typeof vi.fn> };
  };
  let withTx: ReturnType<typeof vi.fn>;
  let service: LedgerService;
  const asTx = () => tx as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    tx = {
      posting: { create: vi.fn().mockResolvedValue({}) },
      $queryRawTyped: vi.fn().mockResolvedValue([row(A, '25.00'), row(B, '0')]),
      ledgerEntry: { createManyAndReturn: vi.fn().mockResolvedValue([]) },
      account: { update: vi.fn().mockResolvedValue({}) },
    };
    withTx = vi.fn((fn: (t: unknown) => unknown) => fn(tx));
    service = new LedgerService({ withTx } as unknown as PrismaService);
  });

  it('claims the ref, locks, inserts entries and sets both balances', async () => {
    const result = await service.post(transfer(), asTx());
    expect(tx.posting.create).toHaveBeenCalledWith({
      data: { ref: 'transfer:1' },
    });
    expect(tx.$queryRawTyped).toHaveBeenCalledOnce();
    expect(tx.$queryRawTyped.mock.calls[0][0].values).toEqual([[A, B]]);
    expect(tx.ledgerEntry.createManyAndReturn.mock.calls[0][0].data).toEqual([
      { accountId: A, amount: '-10', currency: 'AED', ref: 'transfer:1' },
      { accountId: B, amount: '10', currency: 'AED', ref: 'transfer:1' },
    ]);
    expect(tx.account.update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: A }, data: { balance: '15' } },
      { where: { id: B }, data: { balance: '10' } },
    ]);
    expect(result.balances.map((b) => b.balance.toFixed(2))).toEqual([
      '15.00',
      '10.00',
    ]);
    expect(withTx).not.toHaveBeenCalled();
  });

  it('opens its own transaction when none is given', async () => {
    await service.post(transfer());
    expect(withTx).toHaveBeenCalledOnce();
    expect(tx.account.update).toHaveBeenCalledTimes(2);
  });

  it('claims the ref before taking any lock', async () => {
    tx.posting.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(service.post(transfer(), asTx())).rejects.toMatchObject({
      code: 'POSTING_EXISTS',
      statusCode: 409,
    });
    expect(tx.$queryRawTyped).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a missing account',
      [row(A, '25')],
      {
        code: 'ACCOUNT_NOT_FOUND',
        details: [{ field: 'accountId', issue: `${B} not found` }],
      },
    ],
    [
      'accounts in two currencies',
      [row(A, '25'), row(B, '0', { currency: 'USD' })],
      { code: 'CURRENCY_MISMATCH' },
    ],
    [
      'a frozen account',
      [row(A, '25'), row(B, '0', { status: 'frozen' })],
      {
        code: 'ACCOUNT_NOT_ACTIVE',
        details: [{ field: 'accountId', issue: `${B} is frozen` }],
      },
    ],
  ])('rejects %s and writes nothing', async (_, locked, error) => {
    tx.$queryRawTyped.mockResolvedValue(locked);
    await expect(service.post(transfer(), asTx())).rejects.toMatchObject(error);
    expect(tx.ledgerEntry.createManyAndReturn).not.toHaveBeenCalled();
    expect(tx.account.update).not.toHaveBeenCalled();
  });

  it('rejects more decimals than the currency allows', async () => {
    await expect(service.post(transfer('0.001'), asTx())).rejects.toMatchObject(
      { code: 'INVALID_AMOUNT' },
    );
    expect(tx.ledgerEntry.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('rejects a debit beyond the balance with INSUFFICIENT_FUNDS (422)', async () => {
    await expect(service.post(transfer('25.01'), asTx())).rejects.toMatchObject(
      {
        code: 'INSUFFICIENT_FUNDS',
        statusCode: 422,
        details: [
          {
            field: 'amount',
            issue: 'Requested amount 25.01 exceeds available balance of 25.00',
          },
        ],
      },
    );
    expect(tx.ledgerEntry.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('lets the balance reach exactly zero', async () => {
    const result = await service.post(transfer('25.00'), asTx());
    expect(result.balances[0].balance.toFixed(2)).toBe('0.00');
  });

  it('lets an allow_negative system account go below zero', async () => {
    tx.$queryRawTyped.mockResolvedValue([
      row(A, '0', { kind: 'system', allow_negative: true }),
      row(B, '0'),
    ]);
    const result = await service.post(transfer('500.00'), asTx());
    expect(result.balances[0].balance.toFixed(2)).toBe('-500.00');
  });
});
