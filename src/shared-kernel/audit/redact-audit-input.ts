/**
 * Redaction before an audit event is validated and hashed (2.8, 2.12).
 * Secrets are dropped; PII field names are dropped (identity lives in
 * `actor.subjectRef` / optional encrypted fields added later in A-B11).
 */

/** Key names that must never enter the chained payload. */
const SECRET_KEY =
  /^(authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|refresh[_-]?token|access[_-]?token|client[_-]?secret|card[_-]?number|cvv|cvc|pin)$/i;

/** Direct identifiers; use `actor.subjectRef` instead of putting these in the event. */
const PII_KEY =
  /^(email|e-mail|phone|mobile|full[_-]?name|first[_-]?name|last[_-]?name|passport|national[_-]?id|ssn|date[_-]?of[_-]?birth|dob|address)$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Deep-copies `input`, removing secret and PII keys at every level. Arrays are
 * walked; non-plain objects (Date, Buffer, class instances) are left as-is so
 * the schema layer can reject them.
 */
export function redactAuditInput(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redactAuditInput);
  if (!isPlainObject(input)) return input;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY.test(key) || PII_KEY.test(key)) continue;
    out[key] = redactAuditInput(value);
  }
  return out;
}
