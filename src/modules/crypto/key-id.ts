/** Key name as OpenBao Transit and KMS aliases allow it, e.g. `audit-signing`. */
export const KEY_REF_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const KEY_ID_PATTERN = /^([a-z0-9][a-z0-9_-]{0,63}):v([1-9]\d{0,8})$/;

export interface KeyVersion {
  keyRef: string;
  version: number;
}

export const isKeyRef = (value: unknown): value is string =>
  typeof value === 'string' && KEY_REF_PATTERN.test(value);

/** `audit-signing` version 3 -> `audit-signing:v3` (the keyId stored with every signature). */
export function formatKeyId(keyRef: string, version: number): string {
  if (!isKeyRef(keyRef))
    throw new Error(`Invalid key name: ${JSON.stringify(keyRef)}`);
  if (!Number.isSafeInteger(version) || version < 1 || version > 999_999_999)
    throw new Error(`Invalid key version: ${version}`);
  return `${keyRef}:v${version}`;
}

/** null for anything that formatKeyId cannot produce (also leading zeros, `v0`). */
export function parseKeyId(keyId: unknown): KeyVersion | null {
  if (typeof keyId !== 'string') return null;
  const match = KEY_ID_PATTERN.exec(keyId);
  return match ? { keyRef: match[1], version: Number(match[2]) } : null;
}
