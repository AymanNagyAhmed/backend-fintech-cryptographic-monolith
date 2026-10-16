/** The key store (OpenBao, KMS) could not answer or answered something unusable; never a bad signature. */
export class KeyStoreException extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KeyStoreException';
  }
}
