import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../exceptions/domain.exception.js';
import { CURRENCIES } from '../currency.js';

export class UnsupportedCurrencyException extends DomainException {
  constructor(currency: string) {
    super(
      'UNSUPPORTED_CURRENCY',
      `Currency ${currency} is not supported.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ field: 'currency', issue: `must be one of ${CURRENCIES.join(', ')}` }],
    );
  }
}
