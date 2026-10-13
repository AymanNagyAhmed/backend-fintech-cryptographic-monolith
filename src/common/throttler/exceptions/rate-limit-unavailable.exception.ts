import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../exceptions/domain.exception.js';

export class RateLimitUnavailableException extends DomainException {
  constructor() {
    super(
      'RATE_LIMIT_UNAVAILABLE',
      'The service is temporarily unavailable. Please retry shortly.',
      HttpStatus.SERVICE_UNAVAILABLE,
      undefined,
      true,
    );
  }
}
