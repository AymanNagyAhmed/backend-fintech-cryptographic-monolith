import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../exceptions/domain.exception.js';
import type { Currency } from '../currency.js';

export class CurrencyMismatchException extends DomainException {
  constructor(left: Currency, right: Currency) {
    super(
      'CURRENCY_MISMATCH',
      `Cannot combine ${left} with ${right}.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
