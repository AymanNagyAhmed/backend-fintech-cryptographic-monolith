import { AUDIT_EVENT_SCHEMAS } from '../audit/registry.js';
import { EVENT_CONTRACTS } from './event-contracts.js';
import type { TransferCompletedV1 } from './transfer.completed.v1.js';
import { TRANSFER_COMPLETED_V1 } from './transfer.completed.v1.js';

describe('event contracts', () => {
  const keyOf = (c: { type: string; schemaVersion: number }) =>
    `${c.type}.v${c.schemaVersion}`;

  it('cover exactly the audit event schemas, version by version', () => {
    const audit = Object.entries(AUDIT_EVENT_SCHEMAS).flatMap(
      ([type, versions]) => Object.keys(versions).map((v) => `${type}.v${v}`),
    );
    expect(EVENT_CONTRACTS.map(keyOf).sort()).toEqual(audit.sort());
  });

  it('use the registry schema object for each type and version', () => {
    for (const c of EVENT_CONTRACTS) {
      const versions = AUDIT_EVENT_SCHEMAS[
        c.type as keyof typeof AUDIT_EVENT_SCHEMAS
      ] as Record<number, unknown>;
      expect(versions[c.schemaVersion]).toBe(c.schema);
    }
  });

  it('have unique type + version pairs', () => {
    const keys = EVENT_CONTRACTS.map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('validate a payload and infer its type', () => {
    const payload: TransferCompletedV1 = {
      type: 'transfer.completed',
      schemaVersion: 1,
      occurredAt: '2026-10-16T18:00:00.000Z',
      actor: { subjectRef: 'u1' },
      transferId: '11111111-1111-4111-8111-111111111111',
      sourceWalletId: '22222222-2222-4222-8222-222222222222',
      destinationWalletId: '33333333-3333-4333-8333-333333333333',
      currency: 'AED',
      amount: '10.50',
    };
    expect(TRANSFER_COMPLETED_V1.schema.parse(payload)).toEqual(payload);
    expect(
      TRANSFER_COMPLETED_V1.schema.safeParse({ ...payload, extra: 1 }).success,
    ).toBe(false);
  });
});
