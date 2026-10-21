import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception.js';

export const beneficiaryNotFound = () =>
  new DomainException(
    'BENEFICIARY_NOT_FOUND',
    'Beneficiary not found.',
    HttpStatus.NOT_FOUND,
  );

export const beneficiaryNotPending = (status: string) =>
  new DomainException(
    'BENEFICIARY_NOT_PENDING',
    `Beneficiary is ${status}; only pending_confirmation entries can be confirmed.`,
    HttpStatus.CONFLICT,
  );

export const beneficiaryDuplicate = () =>
  new DomainException(
    'BENEFICIARY_DUPLICATE',
    'This address is already on the allow-list for this currency and network.',
    HttpStatus.CONFLICT,
  );

export const beneficiaryNotActive = () =>
  new DomainException(
    'BENEFICIARY_NOT_ACTIVE',
    'Beneficiary is not active yet (awaiting 2FA confirmation or activation delay).',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

export const totpRequired = () =>
  new DomainException(
    'TOTP_REQUIRED',
    'Enable TOTP and confirm with a valid code before activating a beneficiary.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

export const invalidTotp = () =>
  new DomainException(
    'INVALID_TOTP',
    'The TOTP code is wrong or expired.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

export const withdrawalWalletNotFound = () =>
  new DomainException(
    'WALLET_NOT_FOUND',
    'The wallet does not exist.',
    HttpStatus.NOT_FOUND,
    [{ field: 'walletId', issue: 'not found' }],
  );

export const withdrawalCurrencyMismatch = () =>
  new DomainException(
    'CURRENCY_MISMATCH',
    'The wallet, the beneficiary and the amount must use the same currency.',
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ field: 'currency', issue: 'must match the wallet and the beneficiary' }],
  );

export const withdrawalWalletNotActive = (status: string) =>
  new DomainException(
    status === 'frozen' ? 'ACCOUNT_FROZEN' : 'ACCOUNT_CLOSED',
    `The wallet is ${status}.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ field: 'walletId', issue: status }],
  );

export const unsupportedCurrency = (currency: string) =>
  new DomainException(
    'UNSUPPORTED_CURRENCY',
    `Currency ${currency} is not supported.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
