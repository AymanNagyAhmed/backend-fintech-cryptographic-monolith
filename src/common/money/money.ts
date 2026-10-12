import { CURRENCY_SCALE, isCurrency, type Currency } from './currency.js';
import { Decimal, MAX_INTEGER_DIGITS, parseDecimal } from './decimal.js';
import { CurrencyMismatchException } from './exceptions/currency-mismatch.exception.js';
import { InvalidAmountException } from './exceptions/invalid-amount.exception.js';
import { toDecimalRounding, type RoundingMode } from './rounding-mode.js';

export class Money {
  private constructor(
    readonly amount: Decimal,
    readonly currency: Currency,
  ) {}

  /** Exact: rejects amounts with more fractional digits than the currency allows. */
  static of(amount: string | Decimal, currency: Currency): Money {
    Money.assertCurrency(currency);
    const value = parseDecimal(amount);
    const scale = CURRENCY_SCALE[currency];
    if (value.decimalPlaces() > scale) {
      throw new InvalidAmountException(
        `${currency} amounts allow at most ${scale} decimal places.`,
      );
    }
    return Money.checked(value, currency);
  }

  /** Rounds to the currency scale with an explicit mode, e.g. for fees, FX or interest. */
  static round(
    amount: string | Decimal,
    currency: Currency,
    mode: RoundingMode,
  ): Money {
    Money.assertCurrency(currency);
    const value = parseDecimal(amount).toDecimalPlaces(
      CURRENCY_SCALE[currency],
      toDecimalRounding(mode),
    );
    return Money.checked(value, currency);
  }

  static zero(currency: Currency): Money {
    return Money.of('0', currency);
  }

  static sum(items: readonly Money[], currency: Currency): Money {
    return items.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }

  private static assertCurrency(currency: Currency): void {
    if (!isCurrency(currency))
      throw new InvalidAmountException(
        `Unsupported currency "${String(currency)}".`,
      );
  }

  private static checked(value: Decimal, currency: Currency): Money {
    if (value.abs().gte(new Decimal(10).pow(MAX_INTEGER_DIGITS))) {
      throw new InvalidAmountException(
        `Amount exceeds ${MAX_INTEGER_DIGITS} integer digits.`,
      );
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
    return Money.round(
      this.amount.times(parseDecimal(factor)),
      this.currency,
      mode,
    );
  }

  negate(): Money {
    return Money.checked(this.amount.negated(), this.currency);
  }

  /**
   * Splits by integer ratios without losing minor units: each share is rounded down,
   * then the leftover units go to the shares with the largest remainders (ties: earlier share first).
   */
  allocate(ratios: readonly number[]): Money[] {
    if (
      ratios.length === 0 ||
      ratios.some((r) => !Number.isInteger(r) || r < 0)
    ) {
      throw new InvalidAmountException(
        'Allocation ratios must be non-negative integers.',
      );
    }
    const total = ratios.reduce((a, b) => a + b, 0);
    if (total === 0)
      throw new InvalidAmountException(
        'Allocation ratios must not all be zero.',
      );
    if (this.amount.isNegative())
      throw new InvalidAmountException('Cannot allocate a negative amount.');

    const scale = CURRENCY_SCALE[this.currency];
    const unit = new Decimal(10).pow(-scale);
    const exact = ratios.map((r) => this.amount.times(r).div(total));
    const shares = exact.map((e) =>
      e.toDecimalPlaces(scale, toDecimalRounding('DOWN')),
    );
    let leftover = this.amount
      .minus(shares.reduce((a, b) => a.plus(b), new Decimal(0)))
      .div(unit)
      .toNumber();
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
    if (other.currency !== this.currency)
      throw new CurrencyMismatchException(this.currency, other.currency);
  }
}
