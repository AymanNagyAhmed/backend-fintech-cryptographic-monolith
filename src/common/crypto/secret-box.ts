import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM for small secrets at rest: "v1.<iv>.<tag>.<ciphertext>" (base64url).
 * The AAD binds a ciphertext to its row (user id, client id), so it cannot be copied to another row.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32)
      throw new Error('SecretBox key must be 32 bytes');
  }

  seal(plaintext: Buffer, aad: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), ct]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  /** Throws when the ciphertext, tag or AAD do not match. */
  open(sealed: string, aad: string): Buffer {
    const [version, iv, tag, ct] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || !ct)
      throw new Error('Unsupported sealed secret format');
    // Without authTagLength, GCM would also accept a truncated (forgeable) tag
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64url'),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]);
  }
}
