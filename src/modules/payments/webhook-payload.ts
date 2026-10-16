export const PAYMENT_SUCCEEDED = 'payment.succeeded';

// Same lists as webhook_events_payload_allow_list_chk in the CreateWebhookEvents migration

/** Top-level event fields kept in payments.webhook_events.payload; every other field is dropped. */
export const STORED_EVENT_FIELDS = ['id', 'type', 'created'] as const;

/** `data` fields kept per event type; a type without an entry keeps no `data` at all. */
export const STORED_DATA_FIELDS: Readonly<Record<string, readonly string[]>> = {
  [PAYMENT_SUCCEEDED]: ['walletId', 'amount', 'currency'],
};

/** Longer strings are dropped: the payload column is capped at 4 KB. */
const MAX_STRING_LENGTH = 100;

type Scalar = string | number | boolean;

const isStorable = (value: unknown): value is Scalar =>
  (typeof value === 'string' && value.length <= MAX_STRING_LENGTH) ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  typeof value === 'boolean';

function pick(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, Scalar> {
  const picked: Record<string, Scalar> = {};
  for (const field of fields) {
    const value = source[field];
    if (Object.hasOwn(source, field) && isStorable(value))
      picked[field] = value;
  }
  return picked;
}

/**
 * Allow-list redaction of a signed event body (already checked by PaymentsService.parseEvent):
 * only listed fields with scalar values survive, so nested objects, unknown fields and
 * anything a provider adds later are never stored.
 */
export function redactWebhookPayload(
  body: Record<string, unknown>,
  type: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = pick(body, STORED_EVENT_FIELDS);
  const dataFields = Object.hasOwn(STORED_DATA_FIELDS, type)
    ? STORED_DATA_FIELDS[type]
    : undefined;
  const data = body.data;
  if (dataFields && typeof data === 'object' && data !== null)
    payload.data = pick(data as Record<string, unknown>, dataFields);
  return payload;
}
