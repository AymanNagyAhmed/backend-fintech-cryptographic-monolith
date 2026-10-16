import { generateKeyPairSync } from 'node:crypto';
import { algOfKey } from './signature-algorithms.js';
import { decodePublicKey, encodePublicKey } from './public-key.js';

describe('public key encoding', () => {
  it.each(['ed25519', 'ecdsa-p256', 'ml-dsa-65'] as const)(
    'round-trips an %s SPKI key',
    (alg) => {
      const { publicKey } =
        alg === 'ecdsa-p256'
          ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
          : generateKeyPairSync(alg);
      const encoded = encodePublicKey(publicKey);
      expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
      const decoded = decodePublicKey(encoded);
      expect(decoded).not.toBeNull();
      expect(algOfKey(decoded!)).toBe(alg);
      expect(encodePublicKey(decoded!)).toBe(encoded);
    },
  );

  it('returns null for garbage', () => {
    expect(decodePublicKey('AAAA')).toBeNull();
    expect(decodePublicKey('not-base64!!!')).toBeNull();
  });
});
