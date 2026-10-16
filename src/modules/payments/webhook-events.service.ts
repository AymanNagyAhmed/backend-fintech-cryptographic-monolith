import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  WebhookOutcome,
  WebhookRejectionDto,
} from './dto/webhook-receipt.dto.js';
import type { WebhookProvider } from './webhook-providers.js';

export interface WebhookEventRecord {
  provider: WebhookProvider;
  eventId: string;
  type: string;
  outcome: WebhookOutcome;
  reason?: WebhookRejectionDto;
  requestHash: string;
  /** Already redacted (redactWebhookPayload). */
  payload: Record<string, unknown>;
  signedAt: Date;
}

export interface StoredWebhookEvent {
  outcome: WebhookOutcome;
  reason?: WebhookRejectionDto;
  requestHash: string;
}

/** payments.webhook_events: one row per provider event, insert-only for the application. */
@Injectable()
export class WebhookEventsService {
  async find(
    tx: Prisma.TransactionClient,
    provider: WebhookProvider,
    eventId: string,
  ): Promise<StoredWebhookEvent | null> {
    const row = await tx.webhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId } },
      select: {
        outcome: true,
        reasonCode: true,
        reasonMessage: true,
        requestHash: true,
      },
    });
    if (!row) return null;
    const { outcome, reasonCode, reasonMessage, requestHash } = row;
    return {
      outcome,
      requestHash,
      ...(reasonCode !== null && {
        reason: {
          code: reasonCode as WebhookRejectionDto['code'],
          message: reasonMessage ?? '',
        },
      }),
    };
  }

  /** Rejected events start pending review. */
  async record(
    tx: Prisma.TransactionClient,
    event: WebhookEventRecord,
  ): Promise<void> {
    await tx.webhookEvent.create({
      data: {
        provider: event.provider,
        eventId: event.eventId,
        type: event.type,
        outcome: event.outcome,
        reasonCode: event.reason?.code ?? null,
        reasonMessage: event.reason?.message ?? null,
        requestHash: event.requestHash,
        payload: event.payload as Prisma.InputJsonObject,
        signedAt: event.signedAt,
        reviewStatus: event.outcome === 'rejected' ? 'pending' : null,
      },
      select: { id: true },
    });
  }
}
