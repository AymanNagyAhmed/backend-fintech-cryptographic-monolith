import { Redis } from 'ioredis';
import pg from 'pg';
import {
  dockerAvailable,
  migrate,
  startOpenBao,
  startPostgres,
  startRedis,
} from './support/containers.js';
import type { ContainerPostgres } from './support/containers.js';

// A-B15.2: disposable Postgres, Redis and OpenBao through Testcontainers, independent of
// `make up`. Skipped when Docker is not reachable. S3 needs LOCALSTACK_AUTH_TOKEN (not started).
describe.skipIf(!dockerAvailable())('Testcontainers smoke', () => {
  let db: ContainerPostgres;
  const stoppers: (() => Promise<unknown>)[] = [];

  beforeAll(async () => {
    db = await startPostgres();
    stoppers.push(() => db.container.stop());
    migrate(db.migratorUrl);
  }, 180_000);

  afterAll(async () => {
    await Promise.all(stoppers.map((stop) => stop()));
  }, 60_000);

  it('applies the migrations as migrator and runs the app as app_writer', async () => {
    const app = new pg.Client({ connectionString: db.appUrl });
    await app.connect();
    try {
      const who = await app.query('SELECT current_user AS u');
      expect(who.rows[0].u).toBe('app_writer');
      const t = await app.query(
        `SELECT to_regclass('audit.audit_events') IS NOT NULL AS ok`,
      );
      expect(t.rows[0].ok).toBe(true);
      await expect(
        app.query('CREATE TABLE auth.should_fail (id int)'),
      ).rejects.toThrow(/permission denied/);
      await expect(
        app.query(`UPDATE audit.audit_events SET hash = hash`),
      ).rejects.toThrow(/permission denied|append-only|not allowed/i);
    } finally {
      await app.end();
    }
  });

  it('starts Redis with a password and AOF-capable image', async () => {
    const redis = await startRedis();
    stoppers.push(() => redis.container.stop());
    const anonymous = new Redis(
      `redis://${redis.container.getHost()}:${redis.container.getMappedPort(6379)}`,
      { lazyConnect: true, maxRetriesPerRequest: 0 },
    );
    await anonymous.connect().catch(() => undefined);
    await expect(anonymous.ping()).rejects.toThrow(/NOAUTH|Authentication/i);
    anonymous.disconnect();
    const client = new Redis(redis.url);
    try {
      expect(await client.ping()).toBe('PONG');
    } finally {
      client.disconnect();
    }
  }, 120_000);

  it('starts OpenBao in dev mode', async () => {
    const bao = await startOpenBao();
    stoppers.push(() => bao.container.stop());
    const res = await fetch(`${bao.addr}/v1/sys/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      initialized: boolean;
      sealed: boolean;
    };
    expect(body).toMatchObject({ initialized: true, sealed: false });
  }, 120_000);
});
