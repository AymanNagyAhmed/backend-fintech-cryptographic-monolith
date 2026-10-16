import {
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from 'node:crypto';
import { algorithmOf } from './algorithm-registry.js';
import type { SigningAlg } from './signer.js';

/** The algorithm a public or private key is for, or null for any other key. */
export function algOfKey(key: KeyObject): SigningAlg | null {
  switch (key.asymmetricKeyType) {
    case 'ed25519':
      return 'ed25519';
    case 'ml-dsa-65':
      return 'ml-dsa-65';
    case 'ec':
      return key.asymmetricKeyDetails?.namedCurve === 'prime256v1'
        ? 'ecdsa-p256'
        : null;
    default:
      return null;
  }
}

/** Signs with a private key in this process: LocalTestSigner only, never production keys. */
export function signDetached(
  alg: SigningAlg,
  privateKey: KeyObject,
  bytes: Uint8Array,
): Buffer {
  if (algOfKey(privateKey) !== alg)
    throw new Error(`The key is not an ${alg} key`);
  return nodeSign(algorithmOf(alg).digest, bytes, {
    key: privateKey,
    dsaEncoding: 'der',
  });
}

/** False for a key of another algorithm or a malformed signature, never throws. */
export function verifyDetached(
  alg: SigningAlg,
  publicKey: KeyObject,
  bytes: Uint8Array,
  signature: Uint8Array,
): boolean {
  if (algOfKey(publicKey) !== alg) return false;
  try {
    return nodeVerify(
      algorithmOf(alg).digest,
      bytes,
      { key: publicKey, dsaEncoding: 'der' },
      signature,
    );
  } catch {
    return false;
  }
}
