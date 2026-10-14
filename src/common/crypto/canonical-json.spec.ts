import { createHash } from 'node:crypto';
import { Decimal } from '../money/decimal.js';
import { canonicalJson, canonicalJsonSha256 } from './canonical-json.js';

describe('canonicalJson (RFC 8785)', () => {
  it('serializes the RFC 8785 section 3.2.2 example', () => {
    const input = {
      numbers: [
        // The RFC input literal is rounded to 333333333.3333333 on purpose
        // oxlint-disable-next-line no-loss-of-precision
        333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001,
      ],
      string: '\u20ac$\u000F\u000aA\'\u0042\u0022\u005c\\"/',
      literals: [null, true, false],
    };
    expect(canonicalJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts keys by UTF-16 code units (RFC 8785 section 3.2.3)', () => {
    const input = {
      '\u20ac': 'Euro Sign',
      '\r': 'Carriage Return',
      '\ufb33': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '\ud83d\ude00': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      '\u00f6': 'Latin Small Letter O With Diaeresis',
    };
    const sorted = [
      '\r',
      '1',
      '\u0080',
      '\u00f6',
      '\u20ac',
      '\ud83d\ude00',
      '\ufb33',
    ];
    const expected = sorted
      .map(
        (k) =>
          `${JSON.stringify(k)}:${JSON.stringify(input[k as keyof typeof input])}`,
      )
      .join(',');
    expect(canonicalJson(input)).toBe(`{${expected}}`);
  });

  it('gives the same output for objects that differ only in key order and nesting order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe(
      canonicalJson({ a: { c: 'x', d: [1, 2] }, b: 1 }),
    );
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });

  it('drops undefined and function properties like JSON.stringify and honours toJSON', () => {
    expect(
      canonicalJson({
        a: undefined,
        f: () => 1,
        at: new Date('2026-10-14T00:00:00Z'),
        amount: new Decimal('10.50'),
      }),
    ).toBe('{"amount":"10.5","at":"2026-10-14T00:00:00.000Z"}');
  });

  it.each([
    ['NaN', { a: Number.NaN }, /\$\.a is not a finite number/],
    ['Infinity', [Infinity], /\$\[0\] is not a finite number/],
    ['a bigint', { a: { b: 1n } }, /\$\.a\.b is a bigint/],
    ['undefined in an array', [1, undefined], /\$\[1\] is a undefined/],
    ['a top-level undefined', undefined, /\$ is a undefined/],
  ])('throws on %s instead of guessing', (_, value, message) => {
    expect(() => canonicalJson(value)).toThrow(message);
  });

  it('hashes the canonical form with SHA-256 (lowercase hex)', () => {
    const expected = createHash('sha256')
      .update('{"a":1,"b":"€"}')
      .digest('hex');
    expect(canonicalJsonSha256({ b: '€', a: 1 })).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });
});
