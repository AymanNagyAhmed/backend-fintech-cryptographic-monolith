import { Decimal as DecimalJs } from 'decimal.js';
import { InvalidAmountException } from './exceptions/invalid-amount.exception.js';

// Own clone: settings never leak into, or depend on, the global Decimal used by other libraries
export const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Decimal = InstanceType<typeof Decimal>;

// NUMERIC(20, 8): 12 integer digits
export const MAX_INTEGER_DIGITS = 12;
export const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/** Accepts only plain decimal strings ("1500.00") or Decimal; never JS numbers or exponents. */
export function parseDecimal(value: string | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value !== 'string' || !DECIMAL_STRING.test(value)) {
    throw new InvalidAmountException(
      'Amount must be a decimal string such as "1500.00".',
    );
  }
  return new Decimal(value);
}
