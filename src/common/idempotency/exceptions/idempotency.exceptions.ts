import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../exceptions/domain.exception.js';

// Error codes of idempotent operations; clients branch on error.code

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

export const invalidIdempotencyKey = () =>
  new DomainException(
    'INVALID_IDEMPOTENCY_KEY',
    'An Idempotency-Key header is required.',
    HttpStatus.BAD_REQUEST,
    [
      {
        field: IDEMPOTENCY_KEY_HEADER,
        issue: 'must be 1-255 printable ASCII characters without spaces',
      },
    ],
  );

/** Same key, different request: never run it, never replay the other response. */
export const idempotencyKeyReused = () =>
  new DomainException(
    'IDEMPOTENCY_KEY_REUSED',
    'This Idempotency-Key was already used with a different request.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [
      {
        field: IDEMPOTENCY_KEY_HEADER,
        issue: 'reused with a different request',
      },
    ],
  );

/** The key exists without a stored result (should not happen: the result commits with the claim). */
export const idempotencyKeyInUse = () =>
  new DomainException(
    'IDEMPOTENCY_KEY_IN_USE',
    'The request with this Idempotency-Key has no stored result yet. Retry shortly.',
    HttpStatus.CONFLICT,
  );
