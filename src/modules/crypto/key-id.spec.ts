import { formatKeyId, isKeyRef, parseKeyId } from './key-id.js';

describe('key ids', () => {
  it('formats and parses a key version', () => {
    expect(formatKeyId('audit-signing', 3)).toBe('audit-signing:v3');
    expect(parseKeyId('audit-signing:v3')).toEqual({
      keyRef: 'audit-signing',
      version: 3,
    });
    expect(parseKeyId(formatKeyId('k_1', 999_999_999))).toEqual({
      keyRef: 'k_1',
      version: 999_999_999,
    });
  });

  it.each(['audit-signing', 'a', 'k_1-2', 'a'.repeat(64)])(
    'accepts the key name %s',
    (name) => {
      expect(isKeyRef(name)).toBe(true);
    },
  );

  it.each(['', 'Audit', '-a', 'a b', 'a:v1', 'a/b', 'a'.repeat(65), 42])(
    'refuses the key name %j',
    (name) => {
      expect(isKeyRef(name)).toBe(false);
    },
  );

  it.each([0, -1, 1.5, 1_000_000_000, Number.NaN])(
    'refuses to format version %s',
    (version) => {
      expect(() => formatKeyId('audit-signing', version)).toThrow(
        'Invalid key version',
      );
    },
  );

  it('refuses to format an invalid key name', () => {
    expect(() => formatKeyId('Audit', 1)).toThrow('Invalid key name');
  });

  it.each([
    'audit-signing',
    'audit-signing:v0',
    'audit-signing:v01',
    'audit-signing:1',
    'audit-signing:v1:v2',
    'audit-signing:v1 ',
    ':v1',
    'audit-signing:v1000000000',
    null,
    1,
  ])('does not parse %j', (keyId) => {
    expect(parseKeyId(keyId)).toBeNull();
  });
});
