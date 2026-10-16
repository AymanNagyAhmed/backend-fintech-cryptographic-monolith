import { z } from 'zod';
import { schemaOf, type AuditEvent } from './registry.js';

const PeekSchema = z
  .object({
    type: z.string(),
    schemaVersion: z.number().int().positive(),
  })
  .passthrough();

export class AuditSchemaException extends Error {
  constructor(
    message: string,
    readonly details?: { field: string; issue: string }[],
  ) {
    super(message);
    this.name = 'AuditSchemaException';
  }
}

/**
 * Validates an audit event against the allow-listed schema for its `type` and
 * `schemaVersion`. Unknown types, versions and fields are rejected (2.12).
 */
export function parseAuditEvent(input: unknown): AuditEvent {
  const peeked = PeekSchema.safeParse(input);
  if (!peeked.success) {
    throw new AuditSchemaException(
      'Audit event must include type and schemaVersion',
      peeked.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        issue: i.message,
      })),
    );
  }

  const schema = schemaOf(peeked.data.type, peeked.data.schemaVersion);
  if (!schema) {
    throw new AuditSchemaException(
      `Unknown audit event schema ${peeked.data.type}.v${peeked.data.schemaVersion}`,
      [
        {
          field: 'type',
          issue: 'not in the allow-list (or schemaVersion unsupported)',
        },
      ],
    );
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AuditSchemaException(
      'Audit event failed schema validation',
      parsed.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        issue: i.message,
      })),
    );
  }
  return parsed.data;
}
