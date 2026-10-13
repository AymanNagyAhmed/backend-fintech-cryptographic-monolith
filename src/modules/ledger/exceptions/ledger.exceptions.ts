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
