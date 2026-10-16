import { randomUUID } from 'node:crypto';
import { prepareAuditEvent } from './prepare-audit-event.js';
import { redactAuditInput } from './redact-audit-input.js';

describe('redactAuditInput', () => {
  it('drops secret keys at any depth', () => {
    expect(
      redactAuditInput({
        type: 'transfer.completed',
        authorization: 'Bearer FAKE123',
        nested: { apiKey: 'sk_live_xxx', amount: '1.00' },
      }),
    ).toEqual({
      type: 'transfer.completed',
      nested: { amount: '1.00' },
    });
  });

  it('drops PII keys so only subjectRef carries identity', () => {
    expect(
      redactAuditInput({
        email: 'alice@example.com',
        actor: { subjectRef: 'u1', phone: '+971500000000' },
      }),
    ).toEqual({ actor: { subjectRef: 'u1' } });
  });
});

describe('prepareAuditEvent', () => {
  it('redacts then accepts a schema-valid event that carried a fake secret', () => {
    const event = prepareAuditEvent({
      type: 'auth.user.login',
      schemaVersion: 1,
      occurredAt: '2026-10-16T18:00:00.000Z',
      actor: { subjectRef: randomUUID() },
      userId: randomUUID(),
      mfa: true,
      authorization: 'Bearer FAKE123',
      password: 'hunter2',
    });
    expect(event).toMatchObject({ type: 'auth.user.login', mfa: true });
    expect(event).not.toHaveProperty('authorization');
    expect(event).not.toHaveProperty('password');
  });
});
