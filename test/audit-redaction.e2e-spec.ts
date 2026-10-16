import { randomUUID } from 'node:crypto';
import { prepareAuditEvent } from '../src/shared-kernel/audit/prepare-audit-event.js';

/**
 * Done-when for A-B9 (2.12): fake secrets never reach the validated audit
 * record; unknown fields are rejected. Full persistence lands in later A-B9
 * steps; this e2e covers the source-side redaction + schema gate.
 */
describe('Audit redaction (e2e)', () => {
  it('drops Authorization and apiKey before the allow-listed event is accepted', () => {
    const event = prepareAuditEvent({
      type: 'payment.webhook.accepted',
      schemaVersion: 1,
      occurredAt: '2026-10-16T18:00:00.000Z',
      actor: { subjectRef: randomUUID(), clientId: 'stripe-ingest' },
      provider: 'stripe',
      providerEventId: 'evt_test_1',
      authorization: 'Bearer FAKE123',
      apiKey: 'sk_test_leak',
    });
    expect(event).toEqual({
      type: 'payment.webhook.accepted',
      schemaVersion: 1,
      occurredAt: '2026-10-16T18:00:00.000Z',
      actor: { subjectRef: event.actor.subjectRef, clientId: 'stripe-ingest' },
      provider: 'stripe',
      providerEventId: 'evt_test_1',
    });
  });

  it('rejects a new field that is not on the schema allow-list', () => {
    expect(() =>
      prepareAuditEvent({
        type: 'wallet.created',
        schemaVersion: 1,
        occurredAt: '2026-10-16T18:00:00.000Z',
        actor: { subjectRef: randomUUID() },
        walletId: randomUUID(),
        currency: 'AED',
        ledgerAccountId: randomUUID(),
        debugDump: { headers: { authorization: 'Bearer FAKE' } },
      }),
    ).toThrow(/schema validation|unrecognized/i);
  });
});
