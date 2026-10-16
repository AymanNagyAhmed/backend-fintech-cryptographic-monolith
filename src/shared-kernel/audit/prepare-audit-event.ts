import { parseAuditEvent } from './parse-audit-event.js';
import type { AuditEvent } from './registry.js';
import { redactAuditInput } from './redact-audit-input.js';

/**
 * Redact secrets/PII, then validate against the allow-listed schema (2.12).
 * Call this at the source before writing to an outbox / hash chain.
 */
export function prepareAuditEvent(input: unknown): AuditEvent {
  return parseAuditEvent(redactAuditInput(input));
}
