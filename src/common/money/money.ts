import { Decimal as DecimalJs } from 'decimal.js';
import { DomainException } from '../exceptions/domain.exception.js';

// Own clone: settings never leak into, or depend on, the global Decimal used by other libraries
export const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Decimal = InstanceType<typeof Decimal>;

// Fractional digits per currency; NUMERIC(20, 8) caps every currency at 8
export const CURRENCY_SCALE = {
  AED: 2,
  USD: 2,
  EUR: 2,
  BTC: 8,
} as const;
export type Currency = keyof typeof CURRENCY_SCALE;
export const CURRENCIES = Object.keys(CURRENCY_SCALE) as Currency[];

// NUMERIC(20, 8): 12 integer digits
export const MAX_INTEGER_DIGITS = 12;
export const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

export type RoundingMode = 'HALF_EVEN' | 'HALF_UP' | 'HALF_DOWN' | 'UP' | 'DOWN' | 'CEIL' | 'FLOOR';

const ROUNDING: Record<RoundingMode, DecimalJs.Rounding> = {
  HALF_EVEN: DecimalJs.ROUND_HALF_EVEN,
  HALF_UP: DecimalJs.ROUND_HALF_UP,
  HALF_DOWN: DecimalJs.ROUND_HALF_DOWN,
  UP: DecimalJs.ROUND_UP,
  DOWN: DecimalJs.ROUND_DOWN,
  CEIL: DecimalJs.ROUND_CEIL,
  FLOOR: DecimalJs.ROUND_FLOOR,
};

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.hasOwn(CURRENCY_SCALE, value);
}

function invalid(message: string): DomainException {
  return new DomainException('INVALID_AMOUNT', message, 422);
}

function parseDecimal(value: string | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value !== 'string' || !DECIMAL_STRING.test(value)) {
    throw invalid('Amount must be a decimal string such as "1500.00".');
  }
  return new Decimal(value);
}

export class Money {
  private constructor(
    readonly amount: Decimal,
    readonly currency: Currency,
  ) {}

  /** Exact: rejects amounts with more fractional digits than the currency allows. */
  static of(amount: string | Decimal, currency: Currency): Money {
    if (!isCurrency(currency)) throw invalid(`Unsupported currency "${String(currency)}".`);
    const value = parseDecimal(amount);
    const scale = CURRENCY_SCALE[currency];
    if (value.decimalPlaces() > scale) {
      throw invalid(`${currency} amounts allow at most ${scale} decimal places.`);
    }
    return Money.checked(value, currency);
  }

  /** Rounds to the currency scale with an explicit mode, e.g. for fees, FX or interest. */
  static round(amount: string | Decimal, currency: Currency, mode: RoundingMode): Money {
    if (!isCurrency(currency)) throw invalid(`Unsupported currency "${String(currency)}".`);
    const value = parseDecimal(amount).toDecimalPlaces(CURRENCY_SCALE[currency], ROUNDING[mode]);
    return Money.checked(value, currency);
  }

  static zero(currency: Currency): Money {
    return Money.of('0', currency);
  }

  static sum(items: readonly Money[], currency: Currency): Money {
    return items.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }

  private static checked(value: Decimal, currency: Currency): Money {
    if (value.abs().gte(new Decimal(10).pow(MAX_INTEGER_DIGITS))) {
      throw invalid(`Amount exceeds ${MAX_INTEGER_DIGITS} integer digits.`);
    }
    // Normalises -0 to 0
    return new Money(value.isZero() ? new Decimal(0) : value, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.checked(this.amount.plus(other.amount), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.checked(this.amount.minus(other.amount), this.currency);
  }

  multiply(factor: string | Decimal, mode: RoundingMode): Money {
    return Money.round(this.amount.times(parseDecimal(factor)), this.currency, mode);
  }

  negate(): Money {
    return Money.checked(this.amount.negated(), this.currency);
  }

  /**
   * Splits by integer ratios without losing minor units: each share is rounded down,
   * then the leftover units go to the shares with the largest remainders (ties: earlier share first).
   */
  allocate(ratios: readonly number[]): Money[] {
    if (ratios.length === 0 || ratios.some((r) => !Number.isInteger(r) || r < 0)) {
      throw invalid('Allocation ratios must be non-negative integers.');
    }
    const total = ratios.reduce((a, b) => a + b, 0);
    if (total === 0) throw invalid('Allocation ratios must not all be zero.');
    if (this.amount.isNegative()) throw invalid('Cannot allocate a negative amount.');

    const scale = CURRENCY_SCALE[this.currency];
    const unit = new Decimal(10).pow(-scale);
    const exact = ratios.map((r) => this.amount.times(r).div(total));
    const shares = exact.map((e) => e.toDecimalPlaces(scale, DecimalJs.ROUND_DOWN));
    let leftover = this.amount.minus(shares.reduce((a, b) => a.plus(b), new Decimal(0))).div(unit).toNumber();
    const order = exact
      .map((e, i) => ({ i, remainder: e.minus(shares[i]) }))
      .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.i - b.i);
    for (const { i } of order) {
      if (leftover <= 0) break;
      shares[i] = shares[i].plus(unit);
      leftover -= 1;
    }
    return shares.map((s) => Money.checked(s, this.currency));
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative() && !this.amount.isZero();
  }

  isPositive(): boolean {
    return this.amount.isPositive() && !this.amount.isZero();
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.eq(other.amount);
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    return this.amount.comparedTo(other.amount) as -1 | 0 | 1;
  }

  gt(other: Money): boolean {
    return this.compare(other) > 0;
  }

  gte(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  lt(other: Money): boolean {
    return this.compare(other) < 0;
  }

  lte(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  /** Fixed scale string for JSON and NUMERIC columns, e.g. "1500.00", "0.00010000". */
  toString(): string {
    return this.amount.toFixed(CURRENCY_SCALE[this.currency]);
  }

  toJSON(): { amount: string; currency: Currency } {
    return { amount: this.toString(), currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new DomainException(
        'CURRENCY_MISMATCH',
        `Cannot combine ${this.currency} with ${other.currency}.`,
        422,
      );
    }
  }
}
