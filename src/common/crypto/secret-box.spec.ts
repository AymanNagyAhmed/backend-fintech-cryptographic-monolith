import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box.js';

describe('SecretBox (AES-256-GCM)', () => {
  const box = new SecretBox(randomBytes(32).toString('base64'));
  const secret = Buffer.from('totp-secret-20-bytes');

  it('round-trips with a fresh IV each time', () => {
    const a = box.seal(secret, 'user-1');
    const b = box.seal(secret, 'user-1');
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(a).not.toBe(b);
    expect(box.open(a, 'user-1')).toEqual(secret);
  });

  it('fails for another AAD (ciphertext copied to another user)', () => {
    expect(() => box.open(box.seal(secret, 'user-1'), 'user-2')).toThrow();
  });

  it('fails for a changed ciphertext or a truncated tag', () => {
    const [v, iv, tag, ct] = box.seal(secret, 'u').split('.');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 1;
    expect(() =>
      box.open([v, iv, tag, flipped.toString('base64url')].join('.'), 'u'),
    ).toThrow();
    const short = Buffer.from(tag, 'base64url').subarray(0, 4);
    expect(() =>
      box.open([v, iv, short.toString('base64url'), ct].join('.'), 'u'),
    ).toThrow();
  });

  it('fails with another key and for unknown formats', () => {
    const sealed = box.seal(secret, 'u');
    const other = new SecretBox(randomBytes(32).toString('base64'));
    expect(() => other.open(sealed, 'u')).toThrow();
    expect(() => box.open('v2.a.b.c', 'u')).toThrow(/format/);
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow(
      /32 bytes/,
    );
  });
});
