import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception.js';
import type { ApiErrorDetail } from '../../../common/interfaces/api-response.interface.js';

// Error codes of incoming payment webhooks; a 400 tells the provider not to count it as delivered

export const webhookProviderNotFound = () =>
  new DomainException(
    'WEBHOOK_PROVIDER_NOT_FOUND',
    'No webhook endpoint exists for this provider.',
    HttpStatus.NOT_FOUND,
    [{ field: 'provider', issue: 'unknown provider' }],
  );

export const webhookSignatureHeadersInvalid = (header: string) =>
  new DomainException(
    'WEBHOOK_SIGNATURE_HEADERS_INVALID',
    'Webhook signature headers are missing or malformed.',
    HttpStatus.BAD_REQUEST,
    [{ field: header, issue: 'missing or malformed' }],
  );

export const webhookTimestampExpired = () =>
  new DomainException(
    'WEBHOOK_TIMESTAMP_EXPIRED',
    'x-timestamp is outside the allowed 5-minute window.',
    HttpStatus.BAD_REQUEST,
  );

export const invalidWebhookSignature = () =>
  new DomainException(
    'INVALID_WEBHOOK_SIGNATURE',
    'The webhook signature is not valid.',
    HttpStatus.BAD_REQUEST,
  );

/** The provider's clearing account is not active: 503, so the provider retries later. */
export const depositsUnavailable = () =>
  new DomainException(
    'DEPOSITS_UNAVAILABLE',
    'Deposits from this provider are paused. Please retry later.',
    HttpStatus.SERVICE_UNAVAILABLE,
    undefined,
    true,
  );

export const invalidWebhookEvent = (details: ApiErrorDetail[]) =>
  new DomainException(
    'INVALID_WEBHOOK_EVENT',
    'The webhook event is missing required fields.',
    HttpStatus.BAD_REQUEST,
    details,
  );
