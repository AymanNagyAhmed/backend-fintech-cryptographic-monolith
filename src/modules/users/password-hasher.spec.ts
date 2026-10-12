import { DEFAULT_ARGON2, PasswordHasher } from './password-hasher.js';

// Small parameters keep the suite fast; the defaults are checked separately
const FAST = { memory: 64, passes: 1, parallelism: 1 };

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher(FAST);

  it('produces an argon2id PHC string with a random salt', async () => {
    const a = await hasher.hash('S3cure!pass-123');
    const b = await hasher.hash('S3cure!pass-123');
    expect(a).toMatch(
      /^\$argon2id\$v=19\$m=64,t=1,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const encoded = await hasher.hash('S3cure!pass-123');
    await expect(hasher.verify(encoded, 'S3cure!pass-123')).resolves.toBe(true);
    await expect(hasher.verify(encoded, 'S3cure!pass-124')).resolves.toBe(
      false,
    );
  });

  it('treats NFC and NFD forms of a password as equal', async () => {
    const encoded = await hasher.hash('caf\u00e9');
    await expect(hasher.verify(encoded, 'cafe\u0301')).resolves.toBe(true);
  });

  it('verifies with the parameters stored in the hash', async () => {
    const encoded = await hasher.hash('pw');
    const stronger = new PasswordHasher({ ...FAST, passes: 2 });
    await expect(stronger.verify(encoded, 'pw')).resolves.toBe(true);
    expect(stronger.needsRehash(encoded)).toBe(true);
    expect(hasher.needsRehash(encoded)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['bcrypt', '$2b$12$abcdefghijklmnopqrstuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu'],
    ['argon2i', '$argon2i$v=19$m=64,t=1,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA'],
    [
      'old version',
      '$argon2id$v=16$m=64,t=1,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA',
    ],
  ])('rejects a %s hash and asks for a rehash', async (_, encoded) => {
    await expect(hasher.verify(encoded, 'pw')).resolves.toBe(false);
    expect(hasher.needsRehash(encoded)).toBe(true);
  });

  it('defaults to the RFC 9106 second recommended option', () => {
    expect(DEFAULT_ARGON2).toEqual({
      memory: 65_536,
      passes: 3,
      parallelism: 4,
    });
    expect(
      new PasswordHasher().needsRehash(
        '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA',
      ),
    ).toBe(false);
  });
});
