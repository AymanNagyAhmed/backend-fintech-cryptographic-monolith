import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsDecimalString } from './is-decimal-string.decorator.js';

describe('@IsDecimalString()', () => {
  class AmountDto {
    @IsDecimalString()
    amount: unknown;
  }
  class SignedUsdDto {
    @IsDecimalString({ maxScale: 2, positive: false })
    amount: unknown;
  }
  const ok = (cls: new () => object, amount: unknown) =>
    validateSync(plainToInstance(cls, { amount })).length === 0;

  it.each(['10.50', '0.00000001', '999999999999.99999999', '1'])(
    'accepts %j',
    (v) => {
      expect(ok(AmountDto, v)).toBe(true);
    },
  );

  it.each([
    10.5,
    '0',
    '0.00',
    '-1.00',
    '1e3',
    '1.123456789',
    '1000000000000',
    '',
    null,
    '.5',
    '5.',
  ])('rejects %j', (v) => {
    expect(ok(AmountDto, v)).toBe(false);
  });

  it('honours maxScale and positive: false', () => {
    expect(ok(SignedUsdDto, '-12.34')).toBe(true);
    expect(ok(SignedUsdDto, '0')).toBe(true);
    expect(ok(SignedUsdDto, '1.001')).toBe(false);
  });
});
