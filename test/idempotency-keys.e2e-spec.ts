import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { validate } from '../src/config/env.validation.js';

// Needs the Compose PostgreSQL (`make up`) with the CreateIdempotencyKeysAndTransfers migration.
// app_writer cannot DELETE, so committed keys stay (random scope per test, purged after 30 days
// by A-B6.6); everything else runs in a rolled-back transaction.
describe('Idempotency keys schema (database)', () => {
  let app: pg.Client;
  const scope = () => `e2e:${randomUUID()}`;
  const hash = (body: string) =>
    createHash('sha256').update(body).digest('hex');

  const rolledBack = async (client: pg.Client, fn: () => Promise<unknown>) => {
    await client.query('BEGIN');
    try {
      await fn();
    } finally {
      await client.query('ROLLBACK');
    }
  };
  const claim = (client: pg.Client, s: string, key: string, h = hash(key)) =>
    client.query<{ id: string }>(
      `INSERT INTO ledger.idempotency_keys (scope, key, request_hash) VALUES ($1, $2, $3)
       ON CONFLICT (scope, key) DO NOTHING RETURNING id`,
      [s, key, h],
    );
  const connect = async () => {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    return client;
  };

  beforeAll(async () => {
    // Loads and validates .env (DATABASE_URL), like the specs that boot a Nest module
    await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ validate })],
    }).compile();
    app = await connect();
  });

  afterAll(async () => {
    await app.end();
  });

  it('claims a (scope, key) once; the same key in another scope is a new claim', async () => {
    const s = scope();
    const key = randomUUID();
    const first = await claim(app, s, key);
    expect(first.rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect((await claim(app, s, key)).rows).toHaveLength(0);
    expect((await claim(app, scope(), key)).rows).toHaveLength(1);
  });

  it('10 concurrent claims of one key: exactly one wins, the others wait and get nothing', async () => {
    const s = scope();
    const key = randomUUID();
    const clients = await Promise.all(Array.from({ length: 10 }, connect));
    try {
      const results = await Promise.all(
        clients.map(async (client) => {
          await client.query('BEGIN');
          const { rows } = await claim(client, s, key);
          if (rows.length) {
            await new Promise((r) => setTimeout(r, 100)); // the losers block on the unique index
            await client.query(
              `UPDATE ledger.idempotency_keys SET status_code = 201, response = $2
               WHERE id = $1`,
              [rows[0].id, { ok: true }],
            );
          }
          await client.query('COMMIT');
          return rows.length;
        }),
      );
      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
      const { rows } = await app.query(
        `SELECT status_code, response FROM ledger.idempotency_keys
         WHERE scope = $1 AND key = $2`,
        [s, key],
      );
      expect(rows).toEqual([{ status_code: 201, response: { ok: true } }]);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it('a rolled-back claim frees the key for the next retry', async () => {
    const s = scope();
    const key = randomUUID();
    await rolledBack(app, async () => {
      expect((await claim(app, s, key)).rows).toHaveLength(1);
    });
    expect((await claim(app, s, key)).rows).toHaveLength(1);
  });

  describe('update guard', () => {
    let id: string;

    beforeEach(async () => {
      const { rows } = await claim(app, scope(), randomUUID());
      id = rows[0].id;
    });

    it('stores the response once, then rejects any change', async () => {
      await app.query(
        `UPDATE ledger.idempotency_keys SET status_code = 201, response = '{"a":1}' WHERE id = $1`,
        [id],
      );
      await expect(
        app.query(
          `UPDATE ledger.idempotency_keys SET response = '{"a":2}' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/the response is written once/);
      await expect(
        app.query(
          `UPDATE ledger.idempotency_keys SET status_code = NULL, response = NULL WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/the response is written once/);
    });

    it.each([
      ['scope', `scope = 'other'`],
      ['key', `key = 'other'`],
      ['request_hash', `request_hash = repeat('0', 64)`],
      ['created_at', `created_at = now() - interval '1 day'`],
    ])('keeps %s fixed', async (_, set) => {
      await expect(
        rolledBack(app, () =>
          app.query(`UPDATE ledger.idempotency_keys SET ${set} WHERE id = $1`, [
            id,
          ]),
        ),
      ).rejects.toThrow(/scope, key and request_hash are fixed/);
    });
  });

  it.each([
    [
      'an uppercase scope',
      `'Transfer'`,
      `'k'`,
      null,
      /idempotency_keys_scope_chk/,
    ],
    ['a scope with spaces', `'a b'`, `'k'`, null, /idempotency_keys_scope_chk/],
    ['an empty key', `'s1'`, `''`, null, /idempotency_keys_key_chk/],
    ['a key with a space', `'s1'`, `'a b'`, null, /idempotency_keys_key_chk/],
    ['a non-ASCII key', `'s1'`, `'clé'`, null, /idempotency_keys_key_chk/],
    [
      'a key of 256 characters',
      `'s1'`,
      `repeat('k', 256)`,
      null,
      /value too long/,
    ],
    [
      'an uppercase hash',
      `'s1'`,
      `'k'`,
      `upper(repeat('a', 64))`,
      /request_hash_chk/,
    ],
    [
      'a short hash',
      `'s1'`,
      `'k'`,
      `repeat('a', 63) || ' '`,
      /request_hash_chk/,
    ],
  ])('the database rejects %s', async (_, s, key, h, constraint) => {
    await expect(
      rolledBack(app, () =>
        app.query(
          `INSERT INTO ledger.idempotency_keys (scope, key, request_hash)
           VALUES (${s}, ${key}, ${h ?? `repeat('a', 64)`})`,
        ),
      ),
    ).rejects.toThrow(constraint);
  });

  it.each([
    ['a status without a response', `201, NULL`],
    ['a response without a status', `NULL, '{}'`],
    ['a status below 200', `199, '{}'`],
    ['a status above 599', `600, '{}'`],
    [
      'a response over 64 KiB',
      `201, jsonb_build_object('a', (SELECT string_agg(md5(i::text), '') FROM generate_series(1, 5000) i))`,
    ],
  ])('the database rejects %s', async (_, values) => {
    await expect(
      rolledBack(app, () =>
        app.query(
          `INSERT INTO ledger.idempotency_keys (scope, key, request_hash, status_code, response)
           VALUES ('s1', 'k', repeat('a', 64), ${values})`,
        ),
      ),
    ).rejects.toThrow(/idempotency_keys_response_chk/);
  });

  it('app_writer cannot DELETE keys (the purge job comes with A-B6.6)', async () => {
    await expect(
      rolledBack(app, () => app.query(`DELETE FROM ledger.idempotency_keys`)),
    ).rejects.toThrow(/permission denied/);
  });
});
