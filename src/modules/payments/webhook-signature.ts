import { createHmac, timingSafeEqual } from 'node:crypto';

/** Request headers of a signed webhook (lowercase, as Node exposes them). */
export const WEBHOOK_HEADERS = {
  timestamp: 'x-timestamp',
  signature: 'x-signature',
} as const;

/** A webhook timestamp may differ from the server clock by this much, either way. */
export const WEBHOOK_WINDOW_SEC = 300;

export const WEBHOOK_TIMESTAMP_PATTERN = /^\d{1,12}$/;
/** Lowercase or uppercase hex of an HMAC-SHA256 (what `openssl dgst -sha256 -hmac` prints). */
export const WEBHOOK_SIGNATURE_PATTERN = /^[0-9a-fA-F]{64}$/;

/** HMAC-SHA256 over `timestamp + "." + rawBody` with the provider secret string as key, hex. */
export function webhookSignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer | string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
}

/** Constant-time comparison; `signature` must already match WEBHOOK_SIGNATURE_PATTERN. */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer | string,
  signature: string,
): boolean {
  const expected = Buffer.from(
    webhookSignature(secret, timestamp, rawBody),
    'hex',
  );
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const isWithinWebhookWindow = (timestamp: string, nowMs = Date.now()) =>
  Math.abs(Math.floor(nowMs / 1000) - Number(timestamp)) <= WEBHOOK_WINDOW_SEC;

/** Provider side (tests, scripts): the two headers of a signed webhook. */
export function signWebhookHeaders(
  secret: string,
  rawBody: Buffer | string,
  timestamp = String(Math.floor(Date.now() / 1000)),
): Record<(typeof WEBHOOK_HEADERS)[keyof typeof WEBHOOK_HEADERS], string> {
  return {
    [WEBHOOK_HEADERS.timestamp]: timestamp,
    [WEBHOOK_HEADERS.signature]: webhookSignature(secret, timestamp, rawBody),
  };
}
