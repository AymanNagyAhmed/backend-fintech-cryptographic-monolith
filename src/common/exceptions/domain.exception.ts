import { HttpStatus } from '@nestjs/common';
import type { ApiErrorDetail } from '../interfaces/api-response.interface.js';

export class DomainException extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number = HttpStatus.UNPROCESSABLE_ENTITY,
    readonly details?: ApiErrorDetail[],
    // 5xx messages and details are hidden unless the thrower marks them safe for clients
    readonly expose = false,
  ) {
    super(message);
    this.name = 'DomainException';
  }
}
