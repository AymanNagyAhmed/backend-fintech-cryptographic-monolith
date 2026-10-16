import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { validate } from '../src/config/env.validation.js';

// Needs Compose PostgreSQL (`make up`) with CreateContextOutbox. Rolled-back cases only.
describe('Context outbox tables (database)', () => {
  let app: pg.Client;
  let migrator: pg.Client;
  const schemas = ['auth', 'wallet', 'ledger', 'payments'] as const;

  const rolledBack = async (client: pg.Client, fn: () => Promise<unknown>) => {
    await client.query('BEGIN');
    try {
      await fn();
    } finally {
      await client.query('ROLLBACK');
    }
  };

  const payload = () =>
    JSON.stringify({
      type: 'transfer.completed',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      actor: { subjectRef: randomUUID() },
      transferId: randomUUID(),
      sourceWalletId: randomUUID(),
      destinationWalletId: randomUUID(),
      currency: 'AED',
      amount: '1.00',
    });

  const insert = (client: pg.Client, schema: string) =>
    client.query<{ id: string }>(
      `INSERT INTO ${schema}.outbox (payload) VALUES ($1::jsonb) RETURNING id`,
      [payload()],
    );

  beforeAll(async () => {
    // Loads and validates .env (DATABASE_URL, MIGRATOR_DATABASE_URL)
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate })],
    }).compile();
    await moduleRef.close();
    app = new pg.Client({ connectionString: process.env.DATABASE_URL });
    migrator = new pg.Client({
      connectionString: process.env.MIGRATOR_DATABASE_URL,
    });
    await Promise.all([app.connect(), migrator.connect()]);
  });

  afterAll(async () => {
    await Promise.all([app.end(), migrator.end()]);
  });

  it.each(schemas)(
    '%s.outbox: app_writer can insert and claim once',
    async (schema) => {
      await rolledBack(app, async () => {
        const { rows } = await insert(app, schema);
        const id = rows[0].id;
        await app.query(
          `UPDATE ${schema}.outbox SET processed_at = now() WHERE id = $1`,
          [id],
        );
        await expect(
          app.query(
            `UPDATE ${schema}.outbox SET processed_at = now() WHERE id = $1`,
            [id],
          ),
        ).rejects.toThrow(/processed_at/);
      });
    },
  );

  it.each(schemas)(
    '%s.outbox: app_writer cannot change payload',
    async (schema) => {
      await rolledBack(app, async () => {
        const { rows } = await insert(app, schema);
        await expect(
          app.query(
            `UPDATE ${schema}.outbox SET payload = '{"x":1}'::jsonb WHERE id = $1`,
            [rows[0].id],
          ),
        ).rejects.toThrow(/processed_at/);
      });
    },
  );

  it.each(schemas)('%s.outbox: app_writer cannot delete', async (schema) => {
    await rolledBack(app, async () => {
      const { rows } = await insert(app, schema);
      await expect(
        app.query(`DELETE FROM ${schema}.outbox WHERE id = $1`, [rows[0].id]),
      ).rejects.toThrow(/append-only|permission denied/);
    });
  });

  it.each(schemas)(
    '%s.outbox: migrator truncate/delete is blocked by trigger',
    async (schema) => {
      await rolledBack(migrator, async () => {
        const { rows } = await insert(migrator, schema);
        await expect(
          migrator.query(`DELETE FROM ${schema}.outbox WHERE id = $1`, [
            rows[0].id,
          ]),
        ).rejects.toThrow(/append-only/);
      });
    },
  );
});
