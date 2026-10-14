import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception.js';

/** Carries the account and its status, so callers can answer with their own field names. */
export class AccountNotActiveException extends DomainException {
  constructor(
    readonly accountId: string,
    readonly status: string,
  ) {
    super(
      'ACCOUNT_NOT_ACTIVE',
      'A ledger account of the posting is not active.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ field: 'accountId', issue: `${accountId} is ${status}` }],
    );
  }
}
