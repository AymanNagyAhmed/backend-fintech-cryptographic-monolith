import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { validate } from '../src/config/env.validation.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { LedgerModule } from '../src/modules/ledger/ledger.module.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';

// Needs the Compose PostgreSQL (`make up`) with the CreateIdempotencyKeysAndTransfers migration.
// Committed transfers go through LedgerService.post, so balances stay equal to the entries;
// rejected ones roll back (raw pg checks run with SET CONSTRAINTS ALL IMMEDIATE).
describe('Transfers schema (database)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let app: pg.Client;
  let migrator: pg.Client;
  const ref = () => `e2e:${randomUUID()}`;

  const rolledBack = async (client: pg.Client, fn: () => Promise<unknown>) => {
    await client.query('BEGIN');
    try {
      await fn();
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    } finally {
      await client.query('ROLLBACK');
    }
  };
  const clearing = (currency = 'AED') =>
    ledger.ensureSystemAccount({
      code: `e2e:${randomUUID()}`,
      currency,
      allowNegative: true,
    });
  const fundedWallet = async (amount = '100.00', currency = 'AED') => {
    const [account, source] = await Promise.all([
      ledger.openWalletAccount(currency),
      clearing(currency),
    ]);
    await ledger.post({
      ref: ref(),
      entries: [
        { accountId: source.id, amount: `-${amount}` },
        { accountId: account.id, amount },
      ],
    });
    return account;
  };
  const transferRow = (
    posting: string,
    from: string,
    to: string,
    amount: string,
    currency = 'AED',
  ): Prisma.TransferUncheckedCreateInput => ({
    ref: posting,
    fromAccountId: from,
    toAccountId: to,
    fromWalletId: randomUUID(),
    toWalletId: randomUUID(),
    amount,
    currency,
    initiatorUserId: randomUUID(),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        DatabaseModule,
        LedgerModule,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    ledger = moduleRef.get(LedgerService);
    app = new pg.Client({ connectionString: process.env.DATABASE_URL });
    migrator = new pg.Client({
      connectionString: process.env.MIGRATOR_DATABASE_URL,
    });
    await Promise.all([app.connect(), migrator.connect()]);
  });

  afterAll(async () => {
    await Promise.all([app.end(), migrator.end(), prisma.$disconnect()]);
  });

  it('records a transfer in the transaction of its posting', async () => {
    const [from, to] = await Promise.all([
      fundedWallet(),
      ledger.openWalletAccount('AED'),
    ]);
    const posting = ref();
    const transfer = await prisma.withTx(async (tx) => {
      await ledger.post(
        {
          ref: posting,
          entries: [
            { accountId: from.id, amount: '-10.00' },
            { accountId: to.id, amount: '10.00' },
          ],
        },
        tx,
      );
      return tx.transfer.create({
        data: transferRow(posting, from.id, to.id, '10.00'),
      });
    });
    expect(transfer.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(transfer.amount.toFixed(2)).toBe('10.00');
    expect((await ledger.findById(to.id))!.balance.toFixed(2)).toBe('10.00');
  });

  it.each([
    ['an amount the posting does not move', '20.00', false],
    ['a posting that also touches a third account', '10.00', true],
  ])('rejects at commit %s', async (_, amount, viaThird) => {
    const [from, to, third] = await Promise.all([
      fundedWallet(),
      ledger.openWalletAccount('AED'),
      clearing(),
    ]);
    const posting = ref();
    const entries = viaThird
      ? [
          { accountId: from.id, amount: '-10.00' },
          { accountId: to.id, amount: '5.00' },
          { accountId: third.id, amount: '5.00' },
        ]
      : [
          { accountId: from.id, amount: '-10.00' },
          { accountId: to.id, amount: '10.00' },
        ];
    await expect(
      prisma.withTx(async (tx) => {
        await ledger.post({ ref: posting, entries }, tx);
        await tx.transfer.create({
          data: transferRow(posting, from.id, to.id, amount),
        });
      }),
    ).rejects.toThrow(/does not move/);
    expect((await ledger.findById(from.id))!.balance.toFixed(2)).toBe('100.00');
    expect(
      await prisma.posting.findUnique({ where: { ref: posting } }),
    ).toBeNull();
  });

  it('a transfer needs an existing posting', async () => {
    const [from, to] = await Promise.all([
      ledger.openWalletAccount('AED'),
      ledger.openWalletAccount('AED'),
    ]);
    await expect(
      prisma.transfer.create({ data: transferRow(ref(), from.id, to.id, '1') }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  describe('row checks', () => {
    const insert = async (
      row: Prisma.TransferUncheckedCreateInput,
      client = app,
    ) => {
      await client.query(`INSERT INTO ledger.postings (ref) VALUES ($1)`, [
        row.ref,
      ]);
      return client.query(
        `INSERT INTO ledger.transfers (ref, from_account_id, to_account_id, from_wallet_id,
           to_wallet_id, amount, currency, initiator_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          row.ref,
          row.fromAccountId,
          row.toAccountId,
          row.fromWalletId,
          row.toWalletId,
          row.amount,
          row.currency,
          row.initiatorUserId,
        ],
      );
    };
    let aed: [string, string];

    beforeAll(async () => {
      const accounts = await Promise.all([
        ledger.openWalletAccount('AED'),
        ledger.openWalletAccount('AED'),
      ]);
      aed = [accounts[0].id, accounts[1].id];
    });

    it.each([
      ['a zero amount', { amount: '0' }, /transfers_amount_positive_chk/],
      ['a negative amount', { amount: '-1' }, /transfers_amount_positive_chk/],
      // the BEFORE INSERT accounts trigger fires before the CHECK and finds one account
      [
        'the same account twice',
        'sameAccount',
        /transfers_distinct_accounts_chk|both accounts must be wallet accounts/,
      ],
      ['the same wallet twice', 'sameWallet', /transfers_distinct_wallets_chk/],
    ] as const)('the database rejects %s', async (_, change, constraint) => {
      const row = transferRow(ref(), aed[0], aed[1], '1');
      if (change === 'sameAccount') row.toAccountId = row.fromAccountId;
      else if (change === 'sameWallet') row.toWalletId = row.fromWalletId;
      else Object.assign(row, change);
      await expect(rolledBack(app, () => insert(row))).rejects.toThrow(
        constraint,
      );
    });

    it('rejects accounts in another currency', async () => {
      const usd = await ledger.openWalletAccount('USD');
      await expect(
        rolledBack(app, () => insert(transferRow(ref(), aed[0], usd.id, '1'))),
      ).rejects.toThrow(/both accounts must be wallet accounts in AED/);
    });

    it('rejects a system account as one side', async () => {
      const system = await clearing();
      await expect(
        rolledBack(app, () =>
          insert(transferRow(ref(), system.id, aed[1], '1')),
        ),
      ).rejects.toThrow(/both accounts must be wallet accounts/);
    });
  });

  it.each([
    ['UPDATE', `UPDATE ledger.transfers SET amount = 1`],
    ['DELETE', `DELETE FROM ledger.transfers`],
    ['TRUNCATE', `TRUNCATE ledger.transfers`],
  ])('app_writer cannot %s transfers', async (_, sql) => {
    await expect(rolledBack(app, () => app.query(sql))).rejects.toThrow(
      /permission denied/,
    );
  });

  it.each([
    ['UPDATE', `UPDATE ledger.transfers SET amount = amount`],
    ['DELETE', `DELETE FROM ledger.transfers`],
    ['TRUNCATE', `TRUNCATE ledger.transfers`],
  ])('even the owner role (migrator) cannot %s transfers', async (op, sql) => {
    await expect(
      rolledBack(migrator, () => migrator.query(sql)),
    ).rejects.toThrow(
      new RegExp(`transfers is append-only: ${op} is not allowed`),
    );
  });
});
