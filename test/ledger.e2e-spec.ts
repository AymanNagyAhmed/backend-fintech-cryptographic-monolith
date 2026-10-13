import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { CURRENCIES } from '../src/common/money/currency.js';
import { validate } from '../src/config/env.validation.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { LedgerModule } from '../src/modules/ledger/ledger.module.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';

// Needs the Compose PostgreSQL (`make up`) with the CreateLedger migration applied.
// app_writer cannot DELETE, so committed rows stay: every committed posting also updates the
// cached balances (sum check of A-B5 stays at 0 rows); everything else runs in a rolled-back
// transaction on a raw pg client (deferred checks forced with SET CONSTRAINTS ALL IMMEDIATE).
describe('Ledger schema (database)', () => {
  let prisma: PrismaService;
  let ledger: LedgerService;
  let app: pg.Client;
  let migrator: pg.Client;
  const code = () => `e2e:${randomUUID()}`;
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
  const insertEntry = async (
    client: pg.Client,
    accountId: string,
    amount: string,
    currency: string,
    entryRef: string,
  ) => {
    await client.query(
      `INSERT INTO ledger.postings (ref) VALUES ($1) ON CONFLICT DO NOTHING`,
      [entryRef],
    );
    return client.query(
      `INSERT INTO ledger.ledger_entries (account_id, amount, currency, ref)
       VALUES ($1, $2, $3, $4)`,
      [accountId, amount, currency, entryRef],
    );
  };
  const clearing = (currency = 'AED') =>
    ledger.ensureSystemAccount({ code: code(), currency, allowNegative: true });

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

  describe('accounts', () => {
    it('opens an active wallet account with balance 0', async () => {
      const account = await ledger.openWalletAccount('BTC');
      expect(account.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
      expect(account).toMatchObject({
        currency: 'BTC',
        kind: 'wallet',
        code: null,
        allowNegative: false,
        status: 'active',
      });
      expect(account.balance.toFixed(8)).toBe('0.00000000');
    });

    it('ensureSystemAccount is idempotent, also for concurrent first calls', async () => {
      const input = { code: code(), currency: 'USD', allowNegative: true };
      const ids = await Promise.all(
        Array.from({ length: 5 }, () => ledger.ensureSystemAccount(input)),
      );
      expect(new Set(ids.map((a) => a.id)).size).toBe(1);
      await expect(
        ledger.ensureSystemAccount({ ...input, currency: 'EUR' }),
      ).rejects.toMatchObject({ code: 'SYSTEM_ACCOUNT_MISMATCH' });
    });

    it('the currency CHECK lists exactly CURRENCY_SCALE', async () => {
      const { rows } = await app.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conname = 'accounts_currency_chk'`,
      );
      const listed = [...rows[0].def.matchAll(/'([A-Z]+)'/g)].map((m) => m[1]);
      expect(listed.sort()).toEqual([...CURRENCIES].sort());
    });

    it('a wallet account cannot go below zero', async () => {
      const { id } = await ledger.openWalletAccount('AED');
      await expect(
        rolledBack(app, () =>
          app.query(
            `UPDATE ledger.accounts SET balance = -0.01 WHERE id = $1`,
            [id],
          ),
        ),
      ).rejects.toThrow(/accounts_balance_non_negative_chk/);
    });

    it.each([
      [
        'a wallet account with allow_negative',
        `('AED', 'wallet', NULL, true)`,
        /accounts_negative_only_system_chk/,
      ],
      [
        'a wallet account with a code',
        `('AED', 'wallet', 'clearing', false)`,
        /accounts_code_chk/,
      ],
      [
        'a system account without a code',
        `('AED', 'system', NULL, false)`,
        /accounts_code_chk/,
      ],
      [
        'a badly formatted code',
        `('AED', 'system', 'Has Spaces', false)`,
        /accounts_code_chk/,
      ],
      [
        'an unsupported currency',
        `('GBP', 'wallet', NULL, false)`,
        /accounts_currency_chk/,
      ],
    ])('the database rejects %s', async (_, values, constraint) => {
      await expect(
        rolledBack(app, () =>
          app.query(
            `INSERT INTO ledger.accounts (currency, kind, code, allow_negative, updated_at)
             VALUES ${values.replace(/\)$/, ', now())')}`,
          ),
        ),
      ).rejects.toThrow(constraint);
    });

    it.each([
      ['currency', `currency = 'USD'`],
      ['kind', `kind = 'system', code = 'x-${randomUUID()}'`],
      ['allow_negative', `allow_negative = true`],
      ['created_at', `created_at = now() - interval '1 day'`],
    ])('the trigger keeps %s fixed', async (_, set) => {
      const { id } = await ledger.openWalletAccount('AED');
      await expect(
        rolledBack(app, () =>
          app.query(`UPDATE ledger.accounts SET ${set} WHERE id = $1`, [id]),
        ),
      ).rejects.toThrow(/accounts: currency, kind, code and allow_negative/);
    });

    it('a closed account does not change any more', async () => {
      const { id } = await ledger.openWalletAccount('AED');
      await expect(
        rolledBack(app, async () => {
          await app.query(
            `UPDATE ledger.accounts SET status = 'closed' WHERE id = $1`,
            [id],
          );
          await app.query(
            `UPDATE ledger.accounts SET balance = 1 WHERE id = $1`,
            [id],
          );
        }),
      ).rejects.toThrow(/a closed account is final/);
    });
  });

  describe('ledger_entries', () => {
    it('commits a balanced posting (with the matching balance updates)', async () => {
      const [from, to] = await Promise.all([clearing(), clearing()]);
      const posting = ref();
      await app.query('BEGIN');
      try {
        await insertEntry(app, from.id, '-12.50', 'AED', posting);
        await insertEntry(app, to.id, '12.50', 'AED', posting);
        await app.query(
          `UPDATE ledger.accounts SET balance = balance + d.amount
           FROM (VALUES ($1::uuid, -12.50), ($2::uuid, 12.50)) AS d(id, amount)
           WHERE accounts.id = d.id`,
          [from.id, to.id],
        );
        await app.query('COMMIT');
      } catch (e) {
        await app.query('ROLLBACK');
        throw e;
      }
      const { rows } = await app.query<{ n: string; total: string }>(
        `SELECT count(*) AS n, sum(amount) AS total FROM ledger.ledger_entries WHERE ref = $1`,
        [posting],
      );
      expect(rows[0]).toEqual({ n: '2', total: '0.00000000' });
      expect((await ledger.findById(to.id))!.balance.toFixed(2)).toBe('12.50');
    });

    it('rejects an unbalanced posting at commit, not at insert', async () => {
      const [from, to] = await Promise.all([clearing(), clearing()]);
      const posting = ref();
      await app.query('BEGIN');
      await insertEntry(app, from.id, '-10', 'AED', posting);
      await insertEntry(app, to.id, '9.99', 'AED', posting); // deferred: no error yet
      await expect(app.query('COMMIT')).rejects.toThrow(
        /posting .* is unbalanced/,
      );
      const { rows } = await app.query(
        `SELECT 1 FROM ledger.ledger_entries WHERE ref = $1`,
        [posting],
      );
      expect(rows).toHaveLength(0);
    });

    it('rejects a posting that mixes currencies, even if it sums to 0', async () => {
      const [aed, usd] = await Promise.all([clearing('AED'), clearing('USD')]);
      const posting = ref();
      await expect(
        rolledBack(app, async () => {
          await insertEntry(app, aed.id, '-5', 'AED', posting);
          await insertEntry(app, usd.id, '5', 'USD', posting);
        }),
      ).rejects.toThrow(/unbalanced \(sum 0.00000000, 2 currencies\)/);
    });

    it('rejects an entry whose currency differs from its account', async () => {
      const account = await clearing('AED');
      await expect(
        rolledBack(app, () => insertEntry(app, account.id, '1', 'USD', ref())),
      ).rejects.toThrow(/does not match account currency AED/);
    });

    it.each([
      ['a zero amount', '0', 'ok-ref', /ledger_entries_amount_non_zero_chk/],
      // postings_ref_chk fires first (the posting row is inserted before its entries)
      [
        'a ref with spaces',
        '1',
        'has space',
        /(postings|ledger_entries)_ref_chk/,
      ],
    ])('the database rejects %s', async (_, amount, entryRef, constraint) => {
      const account = await clearing();
      await expect(
        rolledBack(app, () =>
          insertEntry(app, account.id, amount, 'AED', entryRef),
        ),
      ).rejects.toThrow(constraint);
    });

    it.each([
      ['UPDATE', `UPDATE ledger.ledger_entries SET amount = 0`],
      ['DELETE', `DELETE FROM ledger.ledger_entries`],
      ['TRUNCATE', `TRUNCATE ledger.ledger_entries`],
    ])('app_writer cannot %s ledger rows', async (_, sql) => {
      await expect(rolledBack(app, () => app.query(sql))).rejects.toThrow(
        /permission denied/,
      );
    });

    it.each([
      ['UPDATE', `UPDATE ledger.ledger_entries SET amount = amount`],
      ['DELETE', `DELETE FROM ledger.ledger_entries`],
      ['TRUNCATE', `TRUNCATE ledger.ledger_entries`],
    ])(
      'even the owner role (migrator) cannot %s ledger rows',
      async (op, sql) => {
        await expect(
          rolledBack(migrator, () => migrator.query(sql)),
        ).rejects.toThrow(new RegExp(`append-only: ${op} is not allowed`));
      },
    );
  });
});
