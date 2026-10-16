import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '../../common/money/decimal.js';
import { Money } from '../../common/money/money.js';
import type { Currency } from '../../common/money/currency.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';

export interface HotColdSnapshot {
  currency: Currency;
  hotBalance: string;
  coldBalance: string;
  total: string;
  /** Hot share as a percent string with 2 decimals, e.g. "4.50". */
  hotShare: string;
  maxHotShare: string;
  alert: boolean;
}

/**
 * Hot/cold custody split: alert when hot share exceeds HOT_WALLET_MAX_SHARE (e.g. 5%).
 */
@Injectable()
export class HotColdService {
  private readonly logger = new Logger(HotColdService.name);
  private readonly maxHotShare: Decimal;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.maxHotShare = new Decimal(
      config.get('HOT_WALLET_MAX_SHARE', { infer: true }),
    );
  }

  /**
   * `hotBalance` / `coldBalance` are decimal strings for one currency.
   * Returns the share and whether it breaches the configured max.
   */
  evaluate(
    currency: Currency,
    hotBalance: string,
    coldBalance: string,
  ): HotColdSnapshot {
    const hot = Money.of(hotBalance, currency);
    const cold = Money.of(coldBalance, currency);
    const total = hot.add(cold);
    let hotShare = '0.00';
    let alert = false;
    if (!total.isZero()) {
      const pct = new Decimal(hot.toString())
        .mul(100)
        .div(new Decimal(total.toString()))
        .toDecimalPlaces(2);
      hotShare = pct.toFixed(2);
      alert = pct.gt(this.maxHotShare);
    }
    if (alert)
      this.logger.warn(
        {
          currency,
          hotShare,
          maxHotShare: this.maxHotShare.toFixed(2),
          hotBalance: hot.toString(),
          coldBalance: cold.toString(),
        },
        'Hot wallet share above configured maximum',
      );
    return {
      currency,
      hotBalance: hot.toString(),
      coldBalance: cold.toString(),
      total: total.toString(),
      hotShare,
      maxHotShare: this.maxHotShare.toFixed(2),
      alert,
    };
  }
}
