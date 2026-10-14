import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception.js';
import { Money } from '../../../common/money/money.js';

// Error codes of transfers; clients branch on error.code. Funds and currency scale errors
// come from LedgerService.post (INSUFFICIENT_FUNDS, INVALID_AMOUNT).

type WalletField = 'fromWalletId' | 'toWalletId';

/** Same code as the wallet routes; the source is also "not found" when another user owns it. */
export const transferWalletNotFound = (field: WalletField) =>
  new DomainException(
    'WALLET_NOT_FOUND',
    'The wallet does not exist.',
    HttpStatus.NOT_FOUND,
    [{ field, issue: 'not found' }],
  );

export const sameWalletTransfer = () =>
  new DomainException(
    'INVALID_TRANSFER',
    'A transfer needs two different wallets.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ field: 'toWalletId', issue: 'must differ from fromWalletId' }],
  );

export const transferCurrencyMismatch = (
  field: WalletField,
  walletCurrency: string,
) =>
  new DomainException(
    'CURRENCY_MISMATCH',
    'The transfer currency does not match the wallet currency.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ field, issue: `wallet currency is ${walletCurrency}` }],
  );

/**
 * A wallet, or the ledger account behind it, that is not active: ACCOUNT_CLOSED for closed
 * (final), ACCOUNT_FROZEN otherwise (frozen can be lifted).
 */
export const transferAccountNotActive = (field: WalletField, status: string) =>
  status === 'closed'
    ? new DomainException(
        'ACCOUNT_CLOSED',
        'The wallet is closed and cannot send or receive transfers.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ field, issue: 'wallet is closed' }],
      )
    : new DomainException(
        'ACCOUNT_FROZEN',
        'The wallet is frozen and cannot send or receive transfers.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ field, issue: 'wallet is frozen' }],
      );

/** `left` is never negative: the limit can be lowered below what was already sent today. */
export const dailyLimitExceeded = (limit: Money, sentToday: Money) => {
  const diff = limit.subtract(sentToday);
  const left = diff.isNegative() ? Money.zero(limit.currency) : diff;
  return new DomainException(
    'DAILY_LIMIT_EXCEEDED',
    'The transfer exceeds the daily limit of the source wallet.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [
      {
        field: 'amount',
        issue: `Daily limit is ${limit.toString()} ${limit.currency}, ${sentToday.toString()} sent today, ${left.toString()} left`,
      },
    ],
  );
};
