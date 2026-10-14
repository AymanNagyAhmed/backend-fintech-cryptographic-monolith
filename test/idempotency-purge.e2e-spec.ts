import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { IdempotencyPurgeService } from '../src/common/idempotency/idempotency-purge.service.js';
import { validate } from '../src/config/env.validation.js';
import { DatabaseModule } from '../src/database/database.module.js';

// Needs the Compose PostgreSQL (`make up`) with the PurgeIdempotencyKeys migration.
// Runs as app_writer: it has no DELETE on ledger.idempotency_keys, only EXECUTE on
// ledger.purge_idempotency_keys. Most cases run in a rolled-back transaction.
describe('Idempotency key purge (database)', () => {
  let moduleRef: TestingModule;
  let app: pg.Client;
  const fn = 'ledger.purge_idempotency_keys(interval, integer)';

  const connect = async () => {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    return client;
  };
  const rolledBack = async (fn: () => Promise<unknown>) => {
    await app.query('BEGIN');
    try {
      await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  };
  /** Inserts one completed key per age (in days) and returns their ids. */
  const insertAged = async (client: pg.Client, ...ages: number[]) => {
    const scope = `e2e:${randomUUID()}`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ledger.idempotency_keys (scope, key, request_hash, status_code, response, created_at)
       SELECT $1, 'k' || i, repeat('a', 64), 201, '{}', now() - make_interval(days => age)
       FROM unnest($2::int[]) WITH ORDINALITY AS t(age, i)
       ORDER BY i
       RETURNING id`,
      [scope, ages],
    );
    return rows.map((r) => r.id);
  };
  const remaining = async (ids: string[]) =>
    (
      await app.query<{ id: string }>(
        `SELECT id FROM ledger.idempotency_keys WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [ids],
      )
    ).rows.map((r) => r.id);
  const purge = (olderThan: string | null, limit: number | null) =>
    app.query<{ deleted: number }>(
      `SELECT ledger.purge_idempotency_keys($1::interval, $2::int) AS deleted`,
      [olderThan, limit],
    );

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        DatabaseModule,
      ],
      providers: [IdempotencyPurgeService],
    }).compile();
    app = await connect();
  });

  afterAll(async () => {
    await app.end();
    await moduleRef.close();
  });

  it('deletes keys older than 30 days and keeps younger ones', async () => {
    await rolledBack(async () => {
      const [old31, old400, young29, fresh] = await insertAged(
        app,
        31,
        400,
        29,
        0,
      );
      const { rows } = await purge('30 days', 10000);
      expect(rows[0].deleted).toBeGreaterThanOrEqual(2);
      expect(await remaining([old31, old400, young29, fresh])).toEqual(
        [young29, fresh].sort(),
      );
    });
  });

  it('deletes at most `limit` rows per call', async () => {
    await rolledBack(async () => {
      const ids = await insertAged(app, 40, 41, 42);
      expect((await purge('30 days', 2)).rows[0].deleted).toBe(2);
      expect(await remaining(ids)).toHaveLength(1);
    });
  });

  it.each([
    ['a retention under 30 days', '29 days', 100, /kept at least 30 days/],
    ['a null retention', null, 100, /kept at least 30 days/],
    ['a limit of 0', '30 days', 0, /limit must be between 1 and 10000/],
    ['a limit over 10000', '30 days', 10001, /limit must be between/],
    ['a null limit', '30 days', null, /limit must be between/],
  ])('refuses %s', async (_, olderThan, limit, message) => {
    await expect(rolledBack(() => purge(olderThan, limit))).rejects.toThrow(
      message,
    );
  });

  it('skips a key locked by another session instead of waiting for it', async () => {
    const [locked] = await insertAged(app, 45);
    const holder = await connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        'SELECT 1 FROM ledger.idempotency_keys WHERE id = $1 FOR UPDATE',
        [locked],
      );
      await app.query(`SET statement_timeout = '2s'`);
      await purge('30 days', 10000);
      expect(await remaining([locked])).toEqual([locked]);
      await holder.query('ROLLBACK');
    } finally {
      await app.query('RESET statement_timeout');
      await holder.end();
    }
    await purge('30 days', 10000);
    expect(await remaining([locked])).toEqual([]);
  });

  it('runs as its owner with a fixed search_path; app_writer may EXECUTE, PUBLIC may not', async () => {
    const { rows } = await app.query<{
      definer: boolean;
      config: string[];
      owner: string;
      writer: boolean;
      auditor: boolean;
    }>(
      `SELECT p.prosecdef AS definer, p.proconfig AS config, r.rolname AS owner,
              has_function_privilege('app_writer', $1, 'EXECUTE') AS writer,
              has_function_privilege('auditor_ro', $1, 'EXECUTE') AS auditor
       FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
       WHERE p.oid = $1::regprocedure`,
      [fn],
    );
    expect(rows).toEqual([
      {
        definer: true,
        config: ['search_path=pg_catalog, pg_temp'],
        owner: 'migrator',
        writer: true,
        auditor: false,
      },
    ]);
  });

  it('app_writer still cannot DELETE keys directly', async () => {
    await expect(
      rolledBack(() =>
        app.query(
          `DELETE FROM ledger.idempotency_keys WHERE created_at < now() - interval '30 days'`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('IdempotencyPurgeService purges in batches until a batch comes back short', async () => {
    const ids = await insertAged(app, 31, 32, 33, 34, 35);
    const [young] = await insertAged(app, 1);
    const report = await moduleRef
      .get(IdempotencyPurgeService)
      .purge({ batchSize: 2 });
    expect(report.deleted).toBeGreaterThanOrEqual(5);
    expect(report.batches).toBeGreaterThanOrEqual(3);
    expect(report).toMatchObject({ retentionDays: 30, complete: true });
    expect(await remaining([...ids, young])).toEqual([young]);
  });
});
