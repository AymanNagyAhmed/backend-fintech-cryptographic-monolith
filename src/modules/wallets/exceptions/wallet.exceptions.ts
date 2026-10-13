import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception.js';

// Error codes of the wallets module; clients branch on error.code

/** The issue never echoes the label: it is user-written text. */
export const invalidWalletLabel = (issue: string) =>
  new DomainException(
    'INVALID_LABEL',
    'The wallet label is not valid.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ field: 'label', issue }],
  );

/** Also used for other users' wallets, so a wallet id reveals nothing about its owner. */
export const walletNotFound = () =>
  new DomainException(
    'WALLET_NOT_FOUND',
    'The wallet does not exist.',
    HttpStatus.NOT_FOUND,
  );

export const walletLimitReached = (max: number) =>
  new DomainException(
    'WALLET_LIMIT_REACHED',
    'The maximum number of wallets has been reached.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ field: 'currency', issue: `at most ${max} open wallets per user` }],
  );

export const walletClosed = () =>
  new DomainException(
    'WALLET_CLOSED',
    'A closed wallet cannot be changed.',
    HttpStatus.CONFLICT,
  );
