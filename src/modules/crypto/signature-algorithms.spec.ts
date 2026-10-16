import { generateKeyPairSync } from 'node:crypto';
import {
  algOfKey,
  signDetached,
  verifyDetached,
} from './signature-algorithms.js';
import { SIGNATURE_BYTES, type SigningAlg } from './signer.js';

const pairs = {
  ed25519: generateKeyPairSync('ed25519'),
  'ecdsa-p256': generateKeyPairSync('ec', { namedCurve: 'P-256' }),
  'ml-dsa-65': generateKeyPairSync('ml-dsa-65'),
} satisfies Record<SigningAlg, unknown>;
const algs = Object.keys(pairs) as SigningAlg[];
const message = new TextEncoder().encode('checkpoint 42');

describe('signature algorithms', () => {
  it.each(algs)(
    '%s signs and verifies with the length in SIGNATURE_BYTES',
    (alg) => {
      const { privateKey, publicKey } = pairs[alg];
      expect(algOfKey(privateKey)).toBe(alg);
      expect(algOfKey(publicKey)).toBe(alg);
      const sig = signDetached(alg, privateKey, message);
      const { min, max } = SIGNATURE_BYTES[alg];
      expect(sig.length).toBeGreaterThanOrEqual(min);
      expect(sig.length).toBeLessThanOrEqual(max);
      expect(verifyDetached(alg, publicKey, message, sig)).toBe(true);
      expect(
        verifyDetached(alg, publicKey, new TextEncoder().encode('x'), sig),
      ).toBe(false);
    },
  );

  it.each(algs)(
    '%s verifies false for a truncated or empty signature',
    (alg) => {
      const { privateKey, publicKey } = pairs[alg];
      const sig = signDetached(alg, privateKey, message);
      expect(verifyDetached(alg, publicKey, message, sig.subarray(1))).toBe(
        false,
      );
      expect(verifyDetached(alg, publicKey, message, Buffer.alloc(0))).toBe(
        false,
      );
    },
  );

  it('verifies false when the key is for another algorithm', () => {
    const sig = signDetached('ed25519', pairs.ed25519.privateKey, message);
    expect(
      verifyDetached('ecdsa-p256', pairs.ed25519.publicKey, message, sig),
    ).toBe(false);
    expect(
      verifyDetached('ed25519', pairs['ecdsa-p256'].publicKey, message, sig),
    ).toBe(false);
  });

  it('knows no other curves or key types', () => {
    expect(
      algOfKey(generateKeyPairSync('ec', { namedCurve: 'P-384' }).publicKey),
    ).toBeNull();
    expect(algOfKey(generateKeyPairSync('ed448').publicKey)).toBeNull();
  });

  it('refuses to sign with a key of another algorithm', () => {
    expect(() =>
      signDetached('ml-dsa-65', pairs.ed25519.privateKey, message),
    ).toThrow('The key is not an ml-dsa-65 key');
  });
});
