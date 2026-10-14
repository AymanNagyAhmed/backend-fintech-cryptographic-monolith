import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { flattenValidationErrors } from '../../common/pipes/validation.pipe.js';
import { WebhookEventDto } from './dto/webhook-event.dto.js';
import type { WebhookReceiptDto } from './dto/webhook-receipt.dto.js';
import { invalidWebhookEvent } from './exceptions/webhook.exceptions.js';
import type { WebhookProvider } from './webhook-providers.js';

@Injectable()
export class PaymentsService {
  /** Called after WebhookSignatureGuard, so `body` is exactly what the provider signed. */
  receive(provider: WebhookProvider, body: unknown): WebhookReceiptDto {
    const event = this.parseEvent(body);
    return {
      provider,
      eventId: event.id,
      type: event.type,
      status: 'received',
    };
  }

  /** Checks only the fields this service reads; the provider's other fields are kept as sent. */
  parseEvent(body: unknown): WebhookEventDto {
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      throw invalidWebhookEvent([
        { field: 'body', issue: 'must be a JSON object' },
      ]);
    const event = plainToInstance(WebhookEventDto, body);
    const errors = validateSync(event, {
      validationError: { target: false, value: false },
    });
    if (errors.length)
      throw invalidWebhookEvent(flattenValidationErrors(errors));
    return event;
  }
}
