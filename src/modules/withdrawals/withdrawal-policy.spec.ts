import type { ConfigService } from '@nestjs/config';
import type { MetricsService } from '../../common/metrics/metrics.service.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { Money } from '../../common/money/money.js';
import { evaluateWithdrawalPolicy } from './withdrawal-policy.js';
import { WithdrawalPolicyService } from './withdrawal-policy.service.js';

const limits = {
  dailyLimit: Money.of('1000.00', 'AED'),
  approvalThreshold: Money.of('500.00', 'AED'),
  largeDelayThreshold: Money.of('200.00', 'AED'),
  largeDelayHours: 12,
};

const base = {
  currency: 'AED' as const,
  spentToday: Money.zero('AED'),
  requesterId: 'user-1',
};

describe('evaluateWithdrawalPolicy', () => {
  it('allows small amounts under all thresholds', () => {
    expect(
      evaluateWithdrawalPolicy(
        { ...base, amount: Money.of('50.00', 'AED') },
        limits,
      ),
    ).toEqual({ action: 'allow' });
  });

  it('counts a withdrawal over the daily limit and not a self-approval', () => {
    const recordWithdrawalLimitBreach = vi.fn();
    const policy = new WithdrawalPolicyService(
      {
        get: (key: string) =>
          key === 'WITHDRAWAL_LARGE_DELAY_HOURS' ? 12 : '1000.00',
      } as unknown as ConfigService<EnvironmentVariables, true>,
      { recordWithdrawalLimitBreach } as unknown as MetricsService,
    );
    expect(
      policy.evaluate({
        amount: '100.00',
        currency: 'AED',
        spentToday: '950.00',
        requesterId: 'user-1',
      }),
    ).toEqual({ action: 'reject', reason: 'OVER_DAILY_LIMIT' });
    expect(
      policy.evaluate({
        amount: '10.00',
        currency: 'AED',
        spentToday: '0.00',
        requesterId: 'user-1',
        approverId: 'user-1',
      }),
    ).toEqual({ action: 'reject', reason: 'SELF_APPROVAL' });
    expect(recordWithdrawalLimitBreach).toHaveBeenCalledOnce();
  });

  it('rejects when daily limit would be exceeded', () => {
    expect(
      evaluateWithdrawalPolicy(
        {
          ...base,
          amount: Money.of('100.00', 'AED'),
          spentToday: Money.of('950.00', 'AED'),
        },
        limits,
      ),
    ).toEqual({ action: 'reject', reason: 'OVER_DAILY_LIMIT' });
  });

  it('requires a second approver at or above the approval threshold', () => {
    expect(
      evaluateWithdrawalPolicy(
        { ...base, amount: Money.of('500.00', 'AED') },
        limits,
      ),
    ).toEqual({ action: 'require_approval', reason: 'ABOVE_THRESHOLD' });
  });

  it('rejects self-approval', () => {
    expect(
      evaluateWithdrawalPolicy(
        {
          ...base,
          amount: Money.of('500.00', 'AED'),
          approverId: 'user-1',
        },
        limits,
      ),
    ).toEqual({ action: 'reject', reason: 'SELF_APPROVAL' });
  });

  it('delays large amounts below the approval threshold', () => {
    const now = new Date('2026-10-16T12:00:00Z');
    expect(
      evaluateWithdrawalPolicy(
        { ...base, amount: Money.of('200.00', 'AED'), now },
        limits,
      ),
    ).toEqual({
      action: 'delay',
      reason: 'LARGE_AMOUNT',
      delayUntil: new Date('2026-10-17T00:00:00Z'),
    });
  });

  it('prefers four-eyes over delay when both thresholds are met', () => {
    expect(
      evaluateWithdrawalPolicy(
        { ...base, amount: Money.of('600.00', 'AED') },
        limits,
      ),
    ).toEqual({ action: 'require_approval', reason: 'ABOVE_THRESHOLD' });
  });
});
