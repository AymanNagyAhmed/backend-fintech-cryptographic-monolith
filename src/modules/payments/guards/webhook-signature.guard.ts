import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import {
  invalidWebhookSignature,
  webhookProviderNotFound,
  webhookSignatureHeadersInvalid,
  webhookTimestampExpired,
} from '../exceptions/webhook.exceptions.js';
import { isWebhookProvider, WEBHOOK_PROVIDERS } from '../webhook-providers.js';
import {
  isWithinWebhookWindow,
  verifyWebhookSignature,
  WEBHOOK_HEADERS,
  WEBHOOK_SIGNATURE_PATTERN,
  WEBHOOK_TIMESTAMP_PATTERN,
} from '../webhook-signature.js';

const EMPTY_BODY = Buffer.alloc(0);

/**
 * Checks HMAC-SHA256 over `timestamp + "." + rawBody` (2.13) before the body is parsed into an
 * event. Order: provider, header format, 5-minute window, signature. Replays inside the window
 * pass here; the event id makes processing them a no-op.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const provider = req.params.provider;
    if (!isWebhookProvider(provider)) throw webhookProviderNotFound();

    const header = (name: string, pattern: RegExp) => {
      const value = req.headers[name];
      if (typeof value !== 'string' || !pattern.test(value))
        throw webhookSignatureHeadersInvalid(name);
      return value;
    };
    const timestamp = header(
      WEBHOOK_HEADERS.timestamp,
      WEBHOOK_TIMESTAMP_PATTERN,
    );
    const signature = header(
      WEBHOOK_HEADERS.signature,
      WEBHOOK_SIGNATURE_PATTERN,
    );
    if (!isWithinWebhookWindow(timestamp)) throw webhookTimestampExpired();

    const secret = this.config.get(WEBHOOK_PROVIDERS[provider].secretEnv, {
      infer: true,
    });
    // Without a parsed body (no or unknown content type) the signature is over empty bytes
    if (
      !verifyWebhookSignature(
        secret,
        timestamp,
        req.rawBody ?? EMPTY_BODY,
        signature,
      )
    )
      throw invalidWebhookSignature();
    return true;
  }
}
