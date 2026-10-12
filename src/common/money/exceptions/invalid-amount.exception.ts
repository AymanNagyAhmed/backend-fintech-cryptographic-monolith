import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../exceptions/domain.exception.js';

export class InvalidAmountException extends DomainException {
  constructor(message: string) {
    super('INVALID_AMOUNT', message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
