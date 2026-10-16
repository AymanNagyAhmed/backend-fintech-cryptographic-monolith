import type { SIGNING_ALGS } from '../../config/env.validation.js';

export type SigningAlg = (typeof SIGNING_ALGS)[number];

/**
 * A detached signature as every signed artifact stores it (2.6, 2.7): which algorithm, which
 * key version (`<keyRef>:v<version>`, key-id.ts) and the signature bytes, standard base64.
 * ed25519: 64 raw bytes over the message; ecdsa-p256: ASN.1 DER over SHA-256 of the message;
 * ml-dsa-65: 3309 bytes (FIPS 204).
 */
export interface SignatureEnvelope {
  alg: SigningAlg;
  keyId: string;
  sig: string;
}

/**
 * Port to the key store that holds the private keys (OpenBao Transit in dev, AWS KMS in prod).
 * Private keys never leave it: the application only sends bytes and gets signatures back.
 * `keyRef` names a key; `sign` uses its current version and reports it in `keyId`.
 * `verify` resolves false for a signature that does not match; it rejects only when the key
 * store cannot answer.
 */
export interface Signer {
  sign(bytes: Uint8Array, keyRef: string): Promise<SignatureEnvelope>;
  verify(bytes: Uint8Array, signature: SignatureEnvelope): Promise<boolean>;
}

/** Nest token of the configured Signer adapter; the application uses SignerService. */
export const SIGNER_BACKEND = Symbol('SIGNER_BACKEND');

/** Decoded signature length in bytes per algorithm (ECDSA DER varies with the integers). */
export const SIGNATURE_BYTES: Readonly<
  Record<SigningAlg, { min: number; max: number }>
> = {
  ed25519: { min: 64, max: 64 },
  'ecdsa-p256': { min: 8, max: 72 },
  'ml-dsa-65': { min: 3309, max: 3309 },
};
