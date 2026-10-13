import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception.js';
import { CURRENCIES } from '../../../common/money/currency.js';

// Error codes of the wallet flows; clients branch on error.code

export const unsupportedCurrency = (currency: string) =>
  new DomainException(
    'UNSUPPORTED_CURRENCY',
    `Currency ${currency} is not supported.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ field: 'currency', issue: `must be one of ${CURRENCIES.join(', ')}` }],
  );
