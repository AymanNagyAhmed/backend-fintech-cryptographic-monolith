import { Money } from '../../common/money/money.js';
import type { Currency } from '../../common/money/currency.js';

export type WithdrawalPolicyDecision =
  | { action: 'reject'; reason: 'OVER_DAILY_LIMIT' | 'SELF_APPROVAL' }
  | { action: 'require_approval'; reason: 'ABOVE_THRESHOLD' }
  | { action: 'delay'; reason: 'LARGE_AMOUNT'; delayUntil: Date }
  | { action: 'allow' };

export interface WithdrawalPolicyLimits {
  dailyLimit: Money;
  approvalThreshold: Money;
  largeDelayThreshold: Money;
  largeDelayHours: number;
}

export interface WithdrawalPolicyInput {
  amount: Money;
  currency: Currency;
  /** Sum of withdrawals already spent today (UTC) for this wallet/user. */
  spentToday: Money;
  requesterId: string;
  /** When set, evaluated as an approval attempt (must differ from requester). */
  approverId?: string;
  now?: Date;
}

/**
 * Pure custody policy (2.16): daily limit, four-eyes above threshold,
 * time delay for large amounts. Caller persists the outcome.
 */
export function evaluateWithdrawalPolicy(
  input: WithdrawalPolicyInput,
  limits: WithdrawalPolicyLimits,
): WithdrawalPolicyDecision {
  const now = input.now ?? new Date();
  if (input.approverId !== undefined && input.approverId === input.requesterId)
    return { action: 'reject', reason: 'SELF_APPROVAL' };

  const projected = input.spentToday.add(input.amount);
  if (projected.gt(limits.dailyLimit))
    return { action: 'reject', reason: 'OVER_DAILY_LIMIT' };

  if (input.amount.gte(limits.approvalThreshold))
    return { action: 'require_approval', reason: 'ABOVE_THRESHOLD' };

  if (input.amount.gte(limits.largeDelayThreshold)) {
    return {
      action: 'delay',
      reason: 'LARGE_AMOUNT',
      delayUntil: new Date(
        now.getTime() + limits.largeDelayHours * 60 * 60 * 1000,
      ),
    };
  }

  return { action: 'allow' };
}
