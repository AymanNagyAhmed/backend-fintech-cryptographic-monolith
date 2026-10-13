import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception.js';

// Error codes of the ledger; clients branch on error.code

/** Server-side configuration error: the message stays internal (5xx, not exposed). */
export const systemAccountMismatch = (code: string) =>
  new DomainException(
    'SYSTEM_ACCOUNT_MISMATCH',
    `System account ${code} exists with another currency or allowNegative.`,
    HttpStatus.INTERNAL_SERVER_ERROR,
  );

export const invalidPosting = (field: string, issue: string) =>
  new DomainException(
    'INVALID_POSTING',
    'The posting is malformed.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ field, issue }],
  );

export const unbalancedPosting = (total: string) =>
  new DomainException(
    'UNBALANCED_POSTING',
    'The entries of a posting must sum to zero.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ field: 'entries', issue: `amounts sum to ${total}` }],
  );

export const postingExists = (ref: string) =>
  new DomainException(
    'POSTING_EXISTS',
    `A posting with ref ${ref} already exists.`,
    HttpStatus.CONFLICT,
  );

export const accountNotFound = (accountId: string) =>
  new DomainException(
    'ACCOUNT_NOT_FOUND',
    'A ledger account of the posting does not exist.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ field: 'accountId', issue: `${accountId} not found` }],
  );

export const accountNotActive = (accountId: string, status: string) =>
  new DomainException(
    'ACCOUNT_NOT_ACTIVE',
    'A ledger account of the posting is not active.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ field: 'accountId', issue: `${accountId} is ${status}` }],
  );

export const insufficientFunds = (requested: string, available: string) =>
  new DomainException(
    'INSUFFICIENT_FUNDS',
    'The source account does not have enough balance to complete this posting.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [
      {
        field: 'amount',
        issue: `Requested amount ${requested} exceeds available balance of ${available}`,
      },
    ],
  );
