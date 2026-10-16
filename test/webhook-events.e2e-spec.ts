import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { validate } from '../src/config/env.validation.js';

// Needs the Compose PostgreSQL (`make up`) with the CreateWebhookEvents migration.
// Every case runs in a rolled-back transaction, as app_writer or as migrator.
describe('Webhook events schema (database)', () => {
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

  interface Row {
    event_id: string;
    type: string;
    outcome: string;
    reason_code: string | null;
    reason_message: string | null;
    payload: Record<string, unknown>;
    signed_at: string;
    review_status: string | null;
    reviewed_at: string | null;
    reviewed_by: string | null;
    review_note: string | null;
  }
  /** A rejected deposit pending review. */
  const rowOf = (eventId = `evt_${randomUUID().replace(/-/g, '')}`): Row => ({
    event_id: eventId,
    type: 'payment.succeeded',
    outcome: 'rejected',
    reason_code: 'WALLET_NOT_FOUND',
    reason_message: 'No wallet with this id exists.',
    payload: {
      id: eventId,
      type: 'payment.succeeded',
      created: 1760464800,
      data: { walletId: randomUUID(), amount: '5.00', currency: 'AED' },
    },
    signed_at: new Date().toISOString(),
    review_status: 'pending',
    reviewed_at: null,
    reviewed_by: null,
    review_note: null,
  });
  const insert = (client: pg.Client, row: Row = rowOf()) =>
    client.query<{ id: string }>(
      `INSERT INTO payments.webhook_events (provider, event_id, type, outcome, reason_code,
         reason_message, request_hash, payload, signed_at, review_status, reviewed_at,
         reviewed_by, review_note)
       VALUES ('stripe', $1, $2, $3::payments.webhook_outcome, $4, $5, repeat('a', 64), $6,
         $7, $8::payments.webhook_review_status, $9, $10, $11)
       RETURNING id`,
      [
        row.event_id,
        row.type,
        row.outcome,
        row.reason_code,
        row.reason_message,
        JSON.stringify(row.payload),
        row.signed_at,
        row.review_status,
        row.reviewed_at,
        row.reviewed_by,
        row.review_note,
      ],
    );
  const resolve = (id: string, note: string | null = 'Refunded at stripe') =>
    migrator.query(
      `UPDATE payments.webhook_events
       SET review_status = 'resolved', reviewed_at = now(), reviewed_by = 'ops@example.com',
           review_note = $2
       WHERE id = $1`,
      [id, note],
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

  it('app_writer inserts a rejected event pending review and an ignored event without data', async () => {
    await rolledBack(app, async () => {
      await insert(app);
      const id = `evt_${randomUUID()}`;
      await insert(app, {
        ...rowOf(id),
        type: 'test.ping',
        outcome: 'ignored',
        reason_code: null,
        reason_message: null,
        review_status: null,
        payload: { id, type: 'test.ping' },
      });
    });
  });

  it('one row per provider event', async () => {
    await expect(
      rolledBack(app, async () => {
        await insert(app, rowOf('evt_dup'));
        await insert(app, rowOf('evt_dup'));
      }),
    ).rejects.toThrow(/webhook_events_provider_event_id_key/);
  });

  const withPayload = (payload: Record<string, unknown>) => (base: Row) => ({
    payload: { ...base.payload, ...payload },
  });
  it.each<[string, (base: Row) => Partial<Row>, RegExp]>([
    [
      'a top-level field outside the allow-list',
      withPayload({ customer: 'Alice' }),
      /webhook_events_payload_allow_list_chk/,
    ],
    [
      'a data field outside the allow-list',
      (b) =>
        withPayload({
          data: { ...(b.payload.data as object), email: 'a@b.c' },
        })(b),
      /webhook_events_payload_allow_list_chk/,
    ],
    [
      'data on a type without a data allow-list',
      (b) => ({
        type: 'payment.refunded',
        payload: { ...b.payload, type: 'payment.refunded' },
      }),
      /webhook_events_payload_allow_list_chk/,
    ],
    [
      'a payload of another event',
      withPayload({ id: 'evt_other' }),
      /webhook_events_payload_chk/,
    ],
    [
      'a rejection without a reason',
      () => ({ reason_code: null, reason_message: null }),
      /webhook_events_reason_chk/,
    ],
    [
      'a reason on a credited event',
      () => ({ outcome: 'credited', review_status: null }),
      /webhook_events_reason_chk/,
    ],
    [
      'a rejected event without a review status',
      () => ({ review_status: null }),
      /webhook_events_review_chk/,
    ],
    [
      'a pending review with a reviewer',
      () => ({ reviewed_by: 'ops@example.com' }),
      /webhook_events_review_chk/,
    ],
    [
      'a signature time 2 hours before receipt',
      () => ({ signed_at: new Date(Date.now() - 7_200_000).toISOString() }),
      /webhook_events_signed_at_chk/,
    ],
  ])('rejects %s', async (_, change, constraint) => {
    const base = rowOf();
    await expect(
      rolledBack(app, () => insert(app, { ...base, ...change(base) })),
    ).rejects.toThrow(constraint);
  });

  it.each([
    ['UPDATE', `UPDATE payments.webhook_events SET review_note = 'x'`],
    ['DELETE', `DELETE FROM payments.webhook_events`],
    ['TRUNCATE', `TRUNCATE payments.webhook_events`],
  ])('app_writer cannot %s webhook events', async (_, sql) => {
    await expect(rolledBack(app, () => app.query(sql))).rejects.toThrow(
      /permission denied/,
    );
  });

  describe('review (as migrator)', () => {
    it('resolves a pending review once', async () => {
      await rolledBack(migrator, async () => {
        const { rows } = await insert(migrator);
        await resolve(rows[0].id);
        await expect(resolve(rows[0].id, 'Changed my mind')).rejects.toThrow(
          /only a pending review can be resolved, once/,
        );
      });
    });

    it('needs a review note to resolve', async () => {
      await expect(
        rolledBack(migrator, async () => {
          const { rows } = await insert(migrator);
          await resolve(rows[0].id, '  ');
        }),
      ).rejects.toThrow(/webhook_events_review_chk/);
    });

    it.each([
      ['outcome', `outcome = 'credited'`],
      ['payload', `payload = payload || '{"created": 1}'`],
      ['received_at', `received_at = received_at - interval '1 minute'`],
    ])('cannot change the event %s', async (_, set) => {
      await expect(
        rolledBack(migrator, async () => {
          const { rows } = await insert(migrator);
          await migrator.query(
            `UPDATE payments.webhook_events SET ${set} WHERE id = $1`,
            [rows[0].id],
          );
        }),
      ).rejects.toThrow(/the event is fixed/);
    });

    it.each([
      ['DELETE', `DELETE FROM payments.webhook_events WHERE id = $1`, [true]],
      ['TRUNCATE', `TRUNCATE payments.webhook_events`, [false]],
    ])('cannot %s webhook events', async (_, sql, [withId]) => {
      await expect(
        rolledBack(migrator, async () => {
          const { rows } = await insert(migrator);
          await migrator.query(sql, withId ? [rows[0].id] : []);
        }),
      ).rejects.toThrow(/webhook_events is append-only/);
    });
  });
});
