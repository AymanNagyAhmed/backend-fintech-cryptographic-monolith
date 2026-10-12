import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception.js';

// Error codes of the auth flows; clients branch on error.code

export const invalidCredentials = () =>
  new DomainException(
    'INVALID_CREDENTIALS',
    'Email or password is incorrect.',
    HttpStatus.UNAUTHORIZED,
  );

export const totpRequired = () =>
  new DomainException(
    'TOTP_REQUIRED',
    'This account has TOTP enabled; send totpCode.',
    HttpStatus.UNAUTHORIZED,
  );

export const invalidTotp = () =>
  new DomainException(
    'INVALID_TOTP',
    'The TOTP code is wrong, expired or already used.',
    HttpStatus.UNAUTHORIZED,
  );

export const invalidRefreshToken = () =>
  new DomainException(
    'INVALID_REFRESH_TOKEN',
    'Refresh token is invalid, expired or revoked.',
    HttpStatus.UNAUTHORIZED,
  );

export const refreshTokenReused = () =>
  new DomainException(
    'REFRESH_TOKEN_REUSED',
    'Refresh token was already used; the session has been revoked.',
    HttpStatus.UNAUTHORIZED,
  );

export const accountInactive = () =>
  new DomainException(
    'ACCOUNT_INACTIVE',
    'This account is locked or disabled.',
    HttpStatus.FORBIDDEN,
  );

export const mfaRequired = () =>
  new DomainException(
    'MFA_REQUIRED',
    'This action needs a session that logged in with a TOTP code.',
    HttpStatus.FORBIDDEN,
  );

export const userGone = () =>
  new DomainException(
    'UNAUTHORIZED',
    'User no longer exists.',
    HttpStatus.UNAUTHORIZED,
  );
