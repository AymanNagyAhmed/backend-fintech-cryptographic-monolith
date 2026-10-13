import {
  createHash,
  createHmac,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';

/** Request headers of a signed B2B request (lowercase, as Node exposes them). */
export const SIGNATURE_HEADERS = {
  clientId: 'x-client-id',
  timestamp: 'x-timestamp',
  nonce: 'x-nonce',
  signature: 'x-signature',
} as const;

/** A timestamp may differ from the server clock by this much, either way. */
export const SIGNATURE_WINDOW_SEC = 300;
/** A nonce is kept until no request with it can pass the time window any more. */
export const NONCE_TTL_SEC = 2 * SIGNATURE_WINDOW_SEC;

export const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,62}$/;
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export const TIMESTAMP_PATTERN = /^\d{1,12}$/;
export const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{1,1024}={0,2}$/;

export interface CanonicalRequestParts {
  method: string;
  /** Path and query exactly as sent, including the /v1 prefix, e.g. `/v1/b2b/ping?x=1`. */
  path: string;
  /** Unix time in seconds. */
  timestamp: string;
  nonce: string;
  /** The raw body bytes; empty for a request without a body. */
  body: Buffer | string;
}

export const sha256Hex = (data: Buffer | string) =>
  createHash('sha256').update(data).digest('hex');

/**
 * `METHOD \n path \n timestamp \n nonce \n hex(sha256(body))`. Newlines separate the parts, so
 * no two different requests produce the same string (none of the parts may contain one).
 */
export function canonicalRequest(parts: CanonicalRequestParts): string {
  return [
    parts.method.toUpperCase(),
    parts.path,
    parts.timestamp,
    parts.nonce,
    sha256Hex(parts.body),
  ].join('\n');
}

/** HMAC-SHA256 with the client secret string as key, base64. */
export const hmacSignature = (secret: string, canonical: string) =>
  createHmac('sha256', secret).update(canonical).digest('base64');

/** Ed25519 over the canonical string, base64. */
export const ed25519Signature = (privateKey: KeyObject, canonical: string) =>
  sign(null, Buffer.from(canonical), privateKey).toString('base64');

export interface SignRequestInput extends Omit<
  CanonicalRequestParts,
  'timestamp' | 'nonce'
> {
  clientId: string;
  /** HMAC secret string or Ed25519 private key. */
  key: string | KeyObject;
  timestamp?: string;
  nonce?: string;
}

/** Client side (scripts, tests): the four headers of a signed request. */
export function signRequestHeaders(
  input: SignRequestInput,
): Record<(typeof SIGNATURE_HEADERS)[keyof typeof SIGNATURE_HEADERS], string> {
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? randomBytes(16).toString('base64url');
  const canonical = canonicalRequest({ ...input, timestamp, nonce });
  return {
    [SIGNATURE_HEADERS.clientId]: input.clientId,
    [SIGNATURE_HEADERS.timestamp]: timestamp,
    [SIGNATURE_HEADERS.nonce]: nonce,
    [SIGNATURE_HEADERS.signature]:
      typeof input.key === 'string'
        ? hmacSignature(input.key, canonical)
        : ed25519Signature(input.key, canonical),
  };
}
