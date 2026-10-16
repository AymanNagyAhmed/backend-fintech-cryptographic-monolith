import type { SigningAlg } from '../signer.js';
import { LocalTestSigner } from './local-test.signer.js';

const message = new TextEncoder().encode('checkpoint 42');

describe('LocalTestSigner', () => {
  it('is refused in production', () => {
    expect(() => new LocalTestSigner('ed25519', 'production')).toThrow(
      'LocalTestSigner is refused in production',
    );
  });

  it.each<SigningAlg>(['ed25519', 'ecdsa-p256', 'ml-dsa-65'])(
    'signs with version 1 of a new %s key and verifies',
    async (alg) => {
      const signer = new LocalTestSigner(alg, 'test');
      const signature = await signer.sign(message, 'audit-signing');
      expect(signature).toMatchObject({ alg, keyId: 'audit-signing:v1' });
      expect(await signer.verify(message, signature)).toBe(true);
    },
  );

  it('keeps old versions verifying after a rotation', async () => {
    const signer = new LocalTestSigner('ed25519', 'test');
    const v1 = await signer.sign(message, 'audit-signing');
    expect(signer.rotate('audit-signing')).toBe('audit-signing:v2');
    const v2 = await signer.sign(message, 'audit-signing');
    expect(v2.keyId).toBe('audit-signing:v2');
    expect(await signer.verify(message, v1)).toBe(true);
    expect(await signer.verify(message, v2)).toBe(true);
    // a v1 signature relabelled as v2 does not verify
    expect(
      await signer.verify(message, { ...v1, keyId: 'audit-signing:v2' }),
    ).toBe(false);
  });

  it('rotates to another algorithm; both versions verify', async () => {
    const signer = new LocalTestSigner('ed25519', 'test');
    const v1 = await signer.sign(message, 'audit-signing');
    signer.rotate('audit-signing', 'ml-dsa-65');
    const v2 = await signer.sign(message, 'audit-signing');
    expect(v2).toMatchObject({ alg: 'ml-dsa-65', keyId: 'audit-signing:v2' });
    expect(await signer.verify(message, v1)).toBe(true);
    expect(await signer.verify(message, v2)).toBe(true);
    expect(await signer.verify(message, { ...v2, alg: 'ed25519' })).toBe(false);
  });

  it('verifies false for unknown keys and versions', async () => {
    const signer = new LocalTestSigner('ed25519', 'test');
    const signature = await signer.sign(message, 'audit-signing');
    expect(
      await signer.verify(message, { ...signature, keyId: 'audit-signing:v9' }),
    ).toBe(false);
    expect(
      await signer.verify(message, { ...signature, keyId: 'other:v1' }),
    ).toBe(false);
  });

  it('keeps keys per signer instance', async () => {
    const signature = await new LocalTestSigner('ed25519', 'test').sign(
      message,
      'audit-signing',
    );
    const other = new LocalTestSigner('ed25519', 'test');
    await other.sign(message, 'audit-signing');
    expect(await other.verify(message, signature)).toBe(false);
  });
});
