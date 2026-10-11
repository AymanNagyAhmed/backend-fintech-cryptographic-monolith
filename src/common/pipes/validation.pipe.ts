import { HttpStatus, ValidationPipe, type ValidationError } from '@nestjs/common';
import type { ApiErrorDetail } from '../api-response.js';
import { DomainException } from '../exceptions/domain.exception.js';

export function flattenValidationErrors(errors: ValidationError[], parent = ''): ApiErrorDetail[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((issue) => ({ field, issue }));
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    // Rejected values are not echoed back: they may be passwords or card numbers
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new DomainException(
        'VALIDATION_FAILED',
        'The request contains invalid fields.',
        HttpStatus.BAD_REQUEST,
        flattenValidationErrors(errors),
      ),
  });
}
