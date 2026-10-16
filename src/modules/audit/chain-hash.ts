import { createHash } from 'node:crypto';
import { canonicalJson } from '../../common/crypto/canonical-json.js';

/** First leaf in a partition links to this prev_hash (32 zero bytes as hex). */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Hash of one audit leaf: SHA-256(prev_hash_bytes || canonical_json_utf8) as lowercase hex (2.2, 2.4).
 * `prevHash` is the previous leaf's hex digest (or {@link GENESIS_PREV_HASH}).
 */
export function chainHash(prevHash: string, payload: unknown): string {
  if (!/^[0-9a-f]{64}$/.test(prevHash))
    throw new TypeError('chainHash: prevHash must be 64 lowercase hex chars');
  return createHash('sha256')
    .update(Buffer.from(prevHash, 'hex'))
    .update(canonicalJson(payload), 'utf8')
    .digest('hex');
}
