import {
  generateKeyPairSync,
  type KeyObject,
  type KeyPairKeyObjectResult,
} from 'node:crypto';
import { formatKeyId } from '../key-id.js';
import { algOfKey, signDetached } from '../signature-algorithms.js';
import type { SignatureEnvelope, SigningAlg } from '../signer.js';
import { KeyStoreSigner } from './key-store.signer.js';

function generate(alg: SigningAlg): KeyPairKeyObjectResult {
  switch (alg) {
    case 'ed25519':
      return generateKeyPairSync('ed25519');
    case 'ecdsa-p256':
      return generateKeyPairSync('ec', { namedCurve: 'P-256' });
    case 'ml-dsa-65':
      return generateKeyPairSync('ml-dsa-65');
  }
}

/**
 * Tests only: key pairs generated in memory per key name (version 1 on first use), lost on
 * restart. Refused in production here and by the env validation (SIGNER_BACKEND=local).
 */
export class LocalTestSigner extends KeyStoreSigner {
  private readonly keys = new Map<string, KeyPairKeyObjectResult[]>();

  constructor(
    private readonly alg: SigningAlg,
    nodeEnv: string,
  ) {
    super();
    if (nodeEnv === 'production')
      throw new Error('LocalTestSigner is refused in production');
  }

  sign(bytes: Uint8Array, keyRef: string): Promise<SignatureEnvelope> {
    const versions = this.versionsOf(keyRef);
    const { privateKey } = versions[versions.length - 1];
    const alg = algOfKey(privateKey) ?? this.alg;
    return Promise.resolve({
      alg,
      keyId: formatKeyId(keyRef, versions.length),
      sig: signDetached(alg, privateKey, bytes).toString('base64'),
    });
  }

  /** Adds the next version (with the signer's algorithm, or `alg`) and returns its keyId. */
  rotate(keyRef: string, alg: SigningAlg = this.alg): string {
    const versions = this.versionsOf(keyRef);
    versions.push(generate(alg));
    return formatKeyId(keyRef, versions.length);
  }

  protected loadPublicKey(
    keyRef: string,
    version: number,
  ): Promise<KeyObject | null> {
    return Promise.resolve(
      this.keys.get(keyRef)?.[version - 1]?.publicKey ?? null,
    );
  }

  private versionsOf(keyRef: string): KeyPairKeyObjectResult[] {
    let versions = this.keys.get(keyRef);
    if (!versions) {
      versions = [generate(this.alg)];
      this.keys.set(keyRef, versions);
    }
    return versions;
  }
}
