import { DomainException } from '../exceptions/domain.exception.js';
import type { Currency } from './currency.js';
import { Decimal } from './decimal.js';
import { Money } from './money.js';
import type { RoundingMode } from './rounding-mode.js';

const usd = (a: string) => Money.of(a, 'USD');

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainException ? e.code : 'NOT_A_DOMAIN_EXCEPTION';
  }
  return undefined;
}

describe('Money (2.11)', () => {
  it('sums "0.1" 10,000 times to exactly 1000 (floats give 999.9999999998)', () => {
    let float = 0;
    let dec = new Decimal(0);
    let money = Money.zero('USD');
    for (let i = 0; i < 10_000; i++) {
      float += 0.1;
      dec = dec.plus('0.1');
      money = money.add(usd('0.10'));
    }
    expect(float).not.toBe(1000);
    expect(dec.toFixed(1)).toBe('1000.0');
    expect(money.toString()).toBe('1000.00');
    expect(
      Money.sum(
        Array.from({ length: 10_000 }, () => Money.of('0.00000001', 'BTC')),
        'BTC',
      ).toString(),
    ).toBe('0.00010000');
  });

  it('adds 0.1 + 0.2 to exactly 0.30', () => {
    expect(usd('0.1').add(usd('0.2')).toString()).toBe('0.30');
  });

  // Golden rounding table: input, currency, mode, expected
  const golden: [string, Currency, RoundingMode, string][] = [
    ['1.005', 'USD', 'HALF_UP', '1.01'],
    ['1.005', 'USD', 'HALF_EVEN', '1.00'],
    ['1.015', 'USD', 'HALF_EVEN', '1.02'],
    ['1.005', 'USD', 'HALF_DOWN', '1.00'],
    ['1.001', 'USD', 'UP', '1.01'],
    ['1.009', 'USD', 'DOWN', '1.00'],
    ['2.675', 'USD', 'HALF_UP', '2.68'], // float: (2.675).toFixed(2) === "2.67"
    ['-1.005', 'USD', 'HALF_UP', '-1.01'],
    ['-1.005', 'USD', 'HALF_EVEN', '-1.00'],
    ['-1.001', 'USD', 'FLOOR', '-1.01'],
    ['-1.009', 'USD', 'CEIL', '-1.00'],
    ['-1.009', 'USD', 'DOWN', '-1.00'],
    ['-0.004', 'AED', 'HALF_EVEN', '0.00'],
    ['0.123456785', 'BTC', 'HALF_EVEN', '0.12345678'],
    ['0.123456785', 'BTC', 'HALF_UP', '0.12345679'],
    ['0.000000005', 'BTC', 'HALF_UP', '0.00000001'],
  ];
  it.each(golden)(
    'round(%s %s, %s) = %s',
    (input, currency, mode, expected) => {
      expect(Money.round(input, currency, mode).toString()).toBe(expected);
    },
  );

  it('multiplies with an explicit rounding mode (7.5% fee on 19.99)', () => {
    expect(usd('19.99').multiply('0.075', 'HALF_EVEN').toString()).toBe('1.50');
    expect(usd('19.99').multiply('0.075', 'DOWN').toString()).toBe('1.49');
    expect(usd('10.00').multiply('0.125', 'HALF_EVEN').toString()).toBe('1.25');
    expect(usd('0.05').multiply('0.5', 'HALF_EVEN').toString()).toBe('0.02');
    expect(usd('0.05').multiply('0.5', 'HALF_UP').toString()).toBe('0.03');
  });

  it('allocates without losing minor units', () => {
    expect(usd('100.00').allocate([1, 1, 1]).map(String)).toEqual([
      '33.34',
      '33.33',
      '33.33',
    ]);
    expect(usd('0.05').allocate([3, 7]).map(String)).toEqual(['0.02', '0.03']);
    expect(Money.of('1.00000000', 'BTC').allocate([1, 2]).map(String)).toEqual([
      '0.33333333',
      '0.66666667',
    ]);
    const parts = usd('999.99').allocate([5, 3, 2, 1]);
    expect(Money.sum(parts, 'USD').toString()).toBe('999.99');
  });

  it('formats with the currency scale and serialises as a string', () => {
    expect(usd('1500').toString()).toBe('1500.00');
    expect(Money.of('0.0001', 'BTC').toString()).toBe('0.00010000');
    expect(JSON.stringify({ fee: usd('1.5') })).toBe(
      '{"fee":{"amount":"1.50","currency":"USD"}}',
    );
    expect(usd('-0').toString()).toBe('0.00');
  });

  it('compares amounts', () => {
    expect(usd('10.00').gt(usd('9.99'))).toBe(true);
    expect(usd('10').equals(usd('10.00'))).toBe(true);
    expect(usd('0').isZero()).toBe(true);
    expect(usd('-0.01').isNegative()).toBe(true);
  });

  it.each([
    ['10.001', 'USD'],
    ['0.000000001', 'BTC'],
    ['1e3', 'USD'],
    ['1,000.00', 'USD'],
    [' 1.00', 'USD'],
    ['NaN', 'USD'],
    ['Infinity', 'USD'],
    ['1000000000000', 'USD'],
  ] as [string, Currency][])(
    'rejects %j %s with INVALID_AMOUNT',
    (amount, currency) => {
      expect(codeOf(() => Money.of(amount, currency))).toBe('INVALID_AMOUNT');
    },
  );

  it('rejects JS numbers and unknown currencies', () => {
    expect(codeOf(() => Money.of(10.5 as unknown as string, 'USD'))).toBe(
      'INVALID_AMOUNT',
    );
    expect(codeOf(() => Money.of('1', 'XYZ' as Currency))).toBe(
      'INVALID_AMOUNT',
    );
    expect(codeOf(() => Money.of('1', 'toString' as Currency))).toBe(
      'INVALID_AMOUNT',
    );
  });

  it('refuses to mix currencies', () => {
    expect(codeOf(() => usd('1').add(Money.of('1', 'AED')))).toBe(
      'CURRENCY_MISMATCH',
    );
    expect(codeOf(() => usd('1').gt(Money.of('1', 'BTC')))).toBe(
      'CURRENCY_MISMATCH',
    );
  });
});
