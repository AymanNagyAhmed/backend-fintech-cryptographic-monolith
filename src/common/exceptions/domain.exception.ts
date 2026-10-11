import { HttpStatus } from '@nestjs/common';
import type { ApiErrorDetail } from '../api-response.js';

export class DomainException extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number = HttpStatus.UNPROCESSABLE_ENTITY,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'DomainException';
  }
}
