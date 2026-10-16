import { createPublicKey, type KeyObject } from 'node:crypto';

/** Standard base64 of an SPKI DER public key (what `crypto.signing_keys.public_key` stores). */
export function encodePublicKey(key: KeyObject): string {
  return Buffer.from(key.export({ type: 'spki', format: 'der' })).toString(
    'base64',
  );
}

/** null when the string is not a readable SPKI public key of a registered signing algorithm. */
export function decodePublicKey(encoded: string): KeyObject | null {
  try {
    return createPublicKey({
      key: Buffer.from(encoded, 'base64'),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return null;
  }
}
