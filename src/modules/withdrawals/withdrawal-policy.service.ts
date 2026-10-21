import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { CURRENCIES, type Currency } from '../../common/money/currency.js';
import { Money } from '../../common/money/money.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import {
  evaluateWithdrawalPolicy,
  type WithdrawalPolicyDecision,
  type WithdrawalPolicyLimits,
} from './withdrawal-policy.js';

export interface EvaluateWithdrawalInput {
  amount: string;
  currency: Currency;
  spentToday: string;
  requesterId: string;
  approverId?: string;
  now?: Date;
}

@Injectable()
export class WithdrawalPolicyService {
  private readonly byCurrency: Record<Currency, WithdrawalPolicyLimits>;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    const largeDelayHours = config.get('WITHDRAWAL_LARGE_DELAY_HOURS', {
      infer: true,
    });
    this.byCurrency = Object.fromEntries(
      CURRENCIES.map((c) => [
        c,
        {
          dailyLimit: Money.of(
            config.get(`WITHDRAWAL_DAILY_LIMIT_${c}` as const, { infer: true }),
            c,
          ),
          approvalThreshold: Money.of(
            config.get(`WITHDRAWAL_APPROVAL_THRESHOLD_${c}` as const, {
              infer: true,
            }),
            c,
          ),
          largeDelayThreshold: Money.of(
            config.get(`WITHDRAWAL_LARGE_DELAY_THRESHOLD_${c}` as const, {
              infer: true,
            }),
            c,
          ),
          largeDelayHours,
        },
      ]),
    ) as Record<Currency, WithdrawalPolicyLimits>;
  }

  evaluate(input: EvaluateWithdrawalInput): WithdrawalPolicyDecision {
    const decision = evaluateWithdrawalPolicy(
      {
        amount: Money.of(input.amount, input.currency),
        currency: input.currency,
        spentToday: Money.of(input.spentToday, input.currency),
        requesterId: input.requesterId,
        ...(input.approverId !== undefined
          ? { approverId: input.approverId }
          : {}),
        ...(input.now !== undefined ? { now: input.now } : {}),
      },
      this.byCurrency[input.currency],
    );
    if (decision.action === 'reject' && decision.reason === 'OVER_DAILY_LIMIT')
      this.metrics?.recordWithdrawalLimitBreach();
    return decision;
  }

  limits(currency: Currency): WithdrawalPolicyLimits {
    return this.byCurrency[currency];
  }
}
