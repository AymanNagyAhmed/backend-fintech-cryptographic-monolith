// Fractional digits per currency; NUMERIC(20, 8) caps every currency at 8
export const CURRENCY_SCALE = {
  AED: 2,
  USD: 2,
  EUR: 2,
  BTC: 8,
} as const;

export type Currency = keyof typeof CURRENCY_SCALE;

export const CURRENCIES = Object.keys(CURRENCY_SCALE) as Currency[];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.hasOwn(CURRENCY_SCALE, value);
}
