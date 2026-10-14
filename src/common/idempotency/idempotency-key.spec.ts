import {
  assertIdempotencyKey,
  assertIdempotencyScope,
} from './idempotency-key.js';

describe('assertIdempotencyKey', () => {
  it.each([
    ['a UUID', '0192f3a4-5b6c-7d8e-9f01-23456789abcd'],
    ['a provider event id', 'evt_1Q2w3E4r5T6y'],
    ['255 characters', 'k'.repeat(255)],
    ['printable punctuation', 'a!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'],
  ])('accepts %s', (_, key) => {
    expect(() => assertIdempotencyKey(key)).not.toThrow();
  });

  it.each([
    ['a missing header', undefined],
    ['an array (repeated header)', ['a', 'b']],
    ['an empty string', ''],
    ['a space', 'a b'],
    ['a non-ASCII character', 'clé'],
    ['a control character', 'a\nb'],
    ['256 characters', 'k'.repeat(256)],
  ])('rejects %s with 400 INVALID_IDEMPOTENCY_KEY', (_, key) => {
    expect(() => assertIdempotencyKey(key)).toThrow(
      expect.objectContaining({
        code: 'INVALID_IDEMPOTENCY_KEY',
        statusCode: 400,
        details: [expect.objectContaining({ field: 'Idempotency-Key' })],
      }),
    );
  });
});

describe('assertIdempotencyScope', () => {
  it.each(['transfer:0192f3a4-5b6c-7d8e-9f01-23456789abcd', 'webhook:stripe'])(
    'accepts %s',
    (scope) => {
      expect(() => assertIdempotencyScope(scope)).not.toThrow();
    },
  );

  it.each(['Transfer', 'a b', '', ':x', 'x'.repeat(101)])(
    'rejects "%s" as a programming error, not a client error',
    (scope) => {
      expect(() => assertIdempotencyScope(scope)).toThrow(
        /Invalid idempotency scope/,
      );
    },
  );
});
