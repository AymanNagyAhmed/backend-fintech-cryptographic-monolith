import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { validate } from '../src/config/env.validation.js';

// Needs Compose PostgreSQL (`make up`) with CreateAuditEvents. Rolled-back cases only.
describe('audit.audit_events (database)', () => {
  let app: pg.Client;
  let migrator: pg.Client;

  const rolledBack = async (client: pg.Client, fn: () => Promise<unknown>) => {
    await client.query('BEGIN');
    try {
      await fn();
    } finally {
      await client.query('ROLLBACK');
    }
  };

  const hex64 = (s: string) => createHash('sha256').update(s).digest('hex');
  const genesis = '0'.repeat(64);

  const insert = (
    client: pg.Client,
    overrides: Partial<{
      partition_key: string;
      seq: number;
      prev_hash: string;
      hash: string;
      source_context: string;
      source_id: string;
    }> = {},
  ) => {
    const partition_key = overrides.partition_key ?? '1';
    const seq = overrides.seq ?? 1;
    const prev_hash = overrides.prev_hash ?? genesis;
    const hash = overrides.hash ?? hex64(`${prev_hash}:${seq}`);
    const source_context = overrides.source_context ?? 'ledger';
    const source_id = overrides.source_id ?? randomUUID();
    return client.query<{ id: string }>(
      `INSERT INTO audit.audit_events
         (partition_key, seq, payload, prev_hash, hash, source_context, source_id, occurred_at)
       VALUES ($1, $2, '{"type":"transfer.completed"}'::jsonb, $3, $4, $5, $6, now())
       RETURNING id`,
      [partition_key, seq, prev_hash, hash, source_context, source_id],
    );
  };

  beforeAll(async () => {
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

  it('app_writer can insert; UNIQUE (partition_key, seq) and source pair hold', async () => {
    await rolledBack(app, async () => {
      await insert(app, { seq: 1, source_id: randomUUID() });
      await insert(app, {
        seq: 2,
        prev_hash: hex64('a'),
        source_id: randomUUID(),
      });
      await expect(
        insert(app, { seq: 1, source_id: randomUUID() }),
      ).rejects.toThrow(/unique|duplicate/i);
    });
  });

  it('app_writer cannot UPDATE or DELETE', async () => {
    await rolledBack(app, async () => {
      const { rows } = await insert(app);
      await expect(
        app.query(
          `UPDATE audit.audit_events SET payload = '{"x":1}'::jsonb WHERE id = $1`,
          [rows[0].id],
        ),
      ).rejects.toThrow(/append-only|permission denied/);
    });
    await rolledBack(app, async () => {
      const { rows } = await insert(app);
      await expect(
        app.query(`DELETE FROM audit.audit_events WHERE id = $1`, [rows[0].id]),
      ).rejects.toThrow(/append-only|permission denied/);
    });
  });

  it('migrator UPDATE is blocked by the append-only trigger', async () => {
    await rolledBack(migrator, async () => {
      const { rows } = await insert(migrator);
      await expect(
        migrator.query(
          `UPDATE audit.audit_events SET hash = $2 WHERE id = $1`,
          [rows[0].id, hex64('tamper')],
        ),
      ).rejects.toThrow(/append-only/);
    });
  });

  it('migrator DELETE is blocked by the append-only trigger', async () => {
    await rolledBack(migrator, async () => {
      const { rows } = await insert(migrator);
      await expect(
        migrator.query(`DELETE FROM audit.audit_events WHERE id = $1`, [
          rows[0].id,
        ]),
      ).rejects.toThrow(/append-only/);
    });
  });
});
