import { createHash } from 'node:crypto';
import { canonicalJson } from '../../common/crypto/canonical-json.js';

/** Unsigned STH body (signature covers canonical JSON of this object). */
export interface SthPayload {
  treeSize: number;
  rootHash: string;
  timestamp: string;
  previousSthHash: string | null;
}

export function sthCanonicalBytes(payload: SthPayload): Buffer {
  return Buffer.from(canonicalJson(payload), 'utf8');
}

/** Hash of a stored STH for previousSthHash linking (excludes signature / TSA). */
export function sthContentHash(payload: SthPayload): string {
  return createHash('sha256').update(sthCanonicalBytes(payload)).digest('hex');
}
