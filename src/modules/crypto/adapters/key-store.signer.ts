import type { KeyObject } from 'node:crypto';
import { parseKeyId } from '../key-id.js';
import { verifyDetached } from '../signature-algorithms.js';
import type { SignatureEnvelope, Signer } from '../signer.js';

/**
 * Base of the adapters: signing happens in the key store, verification here with the public
 * key of the exact version named in keyId, so rotated versions keep verifying. A public key
 * never changes, so found keys are cached; unknown versions and errors are not.
 */
export abstract class KeyStoreSigner implements Signer {
  private readonly publicKeys = new Map<string, Promise<KeyObject | null>>();

  abstract sign(bytes: Uint8Array, keyRef: string): Promise<SignatureEnvelope>;

  /** null when the key or the version does not exist; throws when the key store cannot answer. */
  protected abstract loadPublicKey(
    keyRef: string,
    version: number,
  ): Promise<KeyObject | null>;

  async verify(
    bytes: Uint8Array,
    signature: SignatureEnvelope,
  ): Promise<boolean> {
    const key = await this.publicKey(signature.keyId);
    return (
      key !== null &&
      verifyDetached(
        signature.alg,
        key,
        bytes,
        Buffer.from(signature.sig, 'base64'),
      )
    );
  }

  private async publicKey(keyId: string): Promise<KeyObject | null> {
    const parsed = parseKeyId(keyId);
    if (!parsed) return null;
    let pending = this.publicKeys.get(keyId);
    if (!pending) {
      pending = this.loadPublicKey(parsed.keyRef, parsed.version);
      this.publicKeys.set(keyId, pending);
    }
    try {
      const key = await pending;
      if (!key) this.publicKeys.delete(keyId);
      return key;
    } catch (e) {
      this.publicKeys.delete(keyId);
      throw e;
    }
  }
}
