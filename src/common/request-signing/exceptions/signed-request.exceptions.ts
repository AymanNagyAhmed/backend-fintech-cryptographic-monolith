import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../exceptions/domain.exception.js';

// Error codes of signed B2B requests; clients branch on error.code

export const signatureHeadersInvalid = (header: string) =>
  new DomainException(
    'SIGNATURE_HEADERS_INVALID',
    'Signed request headers are missing or malformed.',
    HttpStatus.UNAUTHORIZED,
    [{ field: header, issue: 'missing or malformed' }],
  );

/** Same answer for an unknown or revoked client and a wrong signature. */
export const invalidSignature = () =>
  new DomainException(
    'INVALID_SIGNATURE',
    'The request signature is not valid for this client.',
    HttpStatus.UNAUTHORIZED,
  );

export const requestExpired = () =>
  new DomainException(
    'REQUEST_EXPIRED',
    'x-timestamp is outside the allowed window; sign the request again.',
    HttpStatus.UNAUTHORIZED,
  );

export const nonceReused = () =>
  new DomainException(
    'NONCE_REUSED',
    'This nonce was already used; every request needs a new one.',
    HttpStatus.UNAUTHORIZED,
  );

export const requestSigningUnavailable = () =>
  new DomainException(
    'REQUEST_SIGNING_UNAVAILABLE',
    'The service is temporarily unavailable. Please retry shortly.',
    HttpStatus.SERVICE_UNAVAILABLE,
    undefined,
    true,
  );
