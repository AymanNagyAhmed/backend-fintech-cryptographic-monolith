import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { validate } from '../src/config/env.validation.js';
import { DatabaseModule } from '../src/database/database.module.js';
import {
  GENESIS_PREV_HASH,
  chainHash,
} from '../src/modules/audit/chain-hash.js';
import { VerifyService } from '../src/modules/audit/verify.service.js';

// Needs Compose PostgreSQL. Migrator disables triggers to plant a broken leaf (2.1 Done-when).
describe('VerifyService (database)', () => {
  let verify: VerifyService;
  let migrator: pg.Client;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        DatabaseModule,
      ],
      providers: [VerifyService],
    }).compile();
    verify = moduleRef.get(VerifyService);
    migrator = new pg.Client({
      connectionString: process.env.MIGRATOR_DATABASE_URL,
    });
    await migrator.connect();
  });

  afterAll(async () => {
    await migrator.end();
  });

  it('reports brokenAt at the tampered seq when a leaf payload is changed as migrator', async () => {
    const partition = `vfy-${randomUUID().slice(0, 8)}`;
    const payload = {
      type: 'transfer.completed',
      schemaVersion: 1,
      amount: '1.00',
    };
    const hash = chainHash(GENESIS_PREV_HASH, payload);
    await migrator.query(
      `INSERT INTO audit.audit_events
         (partition_key, seq, payload, prev_hash, hash, source_context, source_id, occurred_at)
       VALUES ($1, 1, $2::jsonb, $3, $4, 'ledger', $5::uuid, now())`,
      [
        partition,
        JSON.stringify(payload),
        GENESIS_PREV_HASH,
        hash,
        randomUUID(),
      ],
    );

    await migrator.query(`ALTER TABLE audit.audit_events DISABLE TRIGGER USER`);
    try {
      await migrator.query(
        `UPDATE audit.audit_events
         SET payload = jsonb_set(payload, '{amount}', '"9999"')
         WHERE partition_key = $1 AND seq = 1`,
        [partition],
      );
    } finally {
      await migrator.query(
        `ALTER TABLE audit.audit_events ENABLE TRIGGER USER`,
      );
    }

    const report = await verify.verify(partition);
    expect(report.ok).toBe(false);
    expect(report.brokenAt).toEqual({ partition, seq: '1' });
  });
});
