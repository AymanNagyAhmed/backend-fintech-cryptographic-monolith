import { SIGNING_ALGS } from '../../config/env.validation.js';
import type { SigningAlg } from './signer.js';

/**
 * Everything that varies by signing algorithm (2.7): digest before the key store / Node
 * `sign`, and the inclusive length of the decoded signature bytes. Chosen for new signatures
 * by `SIGNING_ALG`; verification accepts any registered `alg` so old artifacts keep verifying
 * after a config switch.
 */
export interface AlgorithmSpec {
  /** Hashed before signing when set; null = sign the message itself (Ed25519, ML-DSA). */
  digest: 'sha256' | null;
  signatureBytes: { readonly min: number; readonly max: number };
}

export const ALGORITHM_REGISTRY: Readonly<Record<SigningAlg, AlgorithmSpec>> = {
  ed25519: { digest: null, signatureBytes: { min: 64, max: 64 } },
  'ecdsa-p256': { digest: 'sha256', signatureBytes: { min: 8, max: 72 } },
  'ml-dsa-65': { digest: null, signatureBytes: { min: 3309, max: 3309 } },
};

export function isSigningAlg(value: unknown): value is SigningAlg {
  return (SIGNING_ALGS as readonly unknown[]).includes(value);
}

export function algorithmOf(alg: SigningAlg): AlgorithmSpec {
  return ALGORITHM_REGISTRY[alg];
}
