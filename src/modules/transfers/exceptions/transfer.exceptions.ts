import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception.js';

// Error codes of transfers; clients branch on error.code. Funds, account status and
// currency scale errors come from LedgerService.post (INSUFFICIENT_FUNDS, ACCOUNT_NOT_ACTIVE,
// INVALID_AMOUNT).

/** Same code as the wallet routes; the source is also "not found" when another user owns it. */
export const transferWalletNotFound = (field: 'fromWalletId' | 'toWalletId') =>
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
  field: 'fromWalletId' | 'toWalletId',
  walletCurrency: string,
) =>
  new DomainException(
    'CURRENCY_MISMATCH',
    'The transfer currency does not match the wallet currency.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ field, issue: `wallet currency is ${walletCurrency}` }],
  );
