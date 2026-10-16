import { randomUUID } from 'node:crypto';
import { AuditSchemaException, parseAuditEvent } from './parse-audit-event.js';

const actor = { subjectRef: randomUUID() };
const occurredAt = '2026-10-16T18:00:00.000Z';

describe('parseAuditEvent', () => {
  it('accepts a well-formed transfer.completed.v1 event', () => {
    const event = parseAuditEvent({
      type: 'transfer.completed',
      schemaVersion: 1,
      occurredAt,
      actor,
      transferId: randomUUID(),
      sourceWalletId: randomUUID(),
      destinationWalletId: randomUUID(),
      currency: 'AED',
      amount: '10.00',
    });
    expect(event).toMatchObject({
      type: 'transfer.completed',
      schemaVersion: 1,
      amount: '10.00',
    });
  });

  it('rejects unknown fields (allow-list only)', () => {
    expect(() =>
      parseAuditEvent({
        type: 'wallet.created',
        schemaVersion: 1,
        occurredAt,
        actor,
        walletId: randomUUID(),
        currency: 'USD',
        ledgerAccountId: randomUUID(),
        authorization: 'Bearer FAKE123',
      }),
    ).toThrow(AuditSchemaException);
  });

  it('rejects an unknown event type', () => {
    expect(() =>
      parseAuditEvent({
        type: 'debug.dump',
        schemaVersion: 1,
        occurredAt,
        actor,
      }),
    ).toThrow(/Unknown audit event schema/);
  });

  it('rejects an unsupported schemaVersion', () => {
    expect(() =>
      parseAuditEvent({
        type: 'auth.user.login',
        schemaVersion: 99,
        occurredAt,
        actor,
        userId: randomUUID(),
        mfa: false,
      }),
    ).toThrow(/Unknown audit event schema/);
  });

  it('rejects free-form nested PII keys on the actor', () => {
    expect(() =>
      parseAuditEvent({
        type: 'auth.user.registered',
        schemaVersion: 1,
        occurredAt,
        actor: { subjectRef: randomUUID(), email: 'alice@example.com' },
        userId: randomUUID(),
      }),
    ).toThrow(AuditSchemaException);
  });

  it('lists every registered type in the allow-list', async () => {
    const { AUDIT_EVENT_SCHEMAS } = await import('./registry.js');
    expect(Object.keys(AUDIT_EVENT_SCHEMAS).sort()).toEqual([
      'audit.access',
      'auth.user.login',
      'auth.user.registered',
      'beneficiary.confirmed',
      'custody.sign',
      'erasure.completed',
      'payment.webhook.accepted',
      'transfer.completed',
      'wallet.created',
    ]);
  });

  it('accepts audit.access.v1', () => {
    expect(
      parseAuditEvent({
        type: 'audit.access',
        schemaVersion: 1,
        occurredAt,
        actor,
        operation: 'verify',
        scope: 'all',
      }),
    ).toMatchObject({ type: 'audit.access', operation: 'verify' });
  });
});

