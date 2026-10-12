import { Decimal as DecimalJs } from 'decimal.js';

export type RoundingMode =
  'HALF_EVEN' | 'HALF_UP' | 'HALF_DOWN' | 'UP' | 'DOWN' | 'CEIL' | 'FLOOR';

const ROUNDING: Record<RoundingMode, DecimalJs.Rounding> = {
  HALF_EVEN: DecimalJs.ROUND_HALF_EVEN,
  HALF_UP: DecimalJs.ROUND_HALF_UP,
  HALF_DOWN: DecimalJs.ROUND_HALF_DOWN,
  UP: DecimalJs.ROUND_UP,
  DOWN: DecimalJs.ROUND_DOWN,
  CEIL: DecimalJs.ROUND_CEIL,
  FLOOR: DecimalJs.ROUND_FLOOR,
};

export function toDecimalRounding(mode: RoundingMode): DecimalJs.Rounding {
  return ROUNDING[mode];
}
