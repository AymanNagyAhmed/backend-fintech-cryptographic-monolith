import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { DECIMAL_STRING, MAX_INTEGER_DIGITS } from '../decimal.js';

export interface DecimalStringOptions {
  /** Max fractional digits; defaults to 8 (NUMERIC(20, 8)). Use CURRENCY_SCALE for a known currency. */
  maxScale?: number;
  /** Reject zero and negative amounts (default true: transfers, deposits, withdrawals). */
  positive?: boolean;
}

/** Money must arrive as a JSON string ("10.50"); JSON numbers are rejected because floats lose precision. */
export function IsDecimalString(
  options: DecimalStringOptions = {},
  validationOptions?: ValidationOptions,
) {
  const maxScale = options.maxScale ?? 8;
  const positive = options.positive ?? true;

  return (target: object, propertyName: string): void => {
    registerDecorator({
      name: 'isDecimalString',
      target: target.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || !DECIMAL_STRING.test(value))
            return false;
          const unsigned = value.replace(/^-/, '');
          const [intPart, fraction = ''] = unsigned.split('.');
          if (fraction.length > maxScale) return false;
          if (intPart.replace(/^0+(?=\d)/, '').length > MAX_INTEGER_DIGITS)
            return false;
          if (positive && (value.startsWith('-') || /^[0.]+$/.test(unsigned)))
            return false;
          return true;
        },
        defaultMessage(args: ValidationArguments): string {
          const sign = positive ? 'a positive ' : 'a ';
          return `${args.property} must be ${sign}decimal string with at most ${MAX_INTEGER_DIGITS} integer and ${maxScale} fractional digits, e.g. "10.50"`;
        },
      },
    });
  };
}
