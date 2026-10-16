import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { validate } from '../src/config/env.validation.js';

// Needs Compose PostgreSQL. Proves single-writer fencing per partition (A-B9.6 / 2.4).
describe('Partition advisory lock (database)', () => {
  let a: pg.Client;
  let b: pg.Client;
  const key = () => `lock-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate })],
    }).compile();
    await moduleRef.close();
    a = new pg.Client({ connectionString: process.env.DATABASE_URL });
    b = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await Promise.all([a.connect(), b.connect()]);
  });

  afterAll(async () => {
    await Promise.all([a.end(), b.end()]);
  });

  it('pg_try_advisory_xact_lock: second session cannot take the same partition', async () => {
    const partition = key();
    await a.query('BEGIN');
    try {
      const { rows: first } = await a.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
        [partition],
      );
      expect(first[0].locked).toBe(true);

      await b.query('BEGIN');
      try {
        const { rows: second } = await b.query<{ locked: boolean }>(
          `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
          [partition],
        );
        expect(second[0].locked).toBe(false);
      } finally {
        await b.query('ROLLBACK');
      }

      // Different partition is free
      await b.query('BEGIN');
      try {
        const { rows: other } = await b.query<{ locked: boolean }>(
          `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
          [`${partition}-other`],
        );
        expect(other[0].locked).toBe(true);
      } finally {
        await b.query('ROLLBACK');
      }
    } finally {
      await a.query('ROLLBACK');
    }
  });
});
