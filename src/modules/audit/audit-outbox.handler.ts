import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OUTBOX_DEFER,
  type OutboxHandlerResult,
} from '../outbox/interfaces/outbox-handler-result.interface.js';
import type { OutboxEvent } from '../outbox/interfaces/outbox-event.interface.js';
import { OUTBOX_EVENT_PREFIX } from '../outbox/events/outbox-event-name.js';
import { ChainerService } from './chainer.service.js';

/**
 * The audit subscriber of every outbox event (A-B14.3): writes the hash-chain leaf in the
 * dispatcher's transaction, so the leaf and `processed_at` commit together. Errors propagate
 * (`suppressErrors: false`) so the dispatcher rolls the batch back instead of losing the row.
 */
@Injectable()
export class AuditOutboxHandler {
  constructor(private readonly chainer: ChainerService) {}

  @OnEvent(`${OUTBOX_EVENT_PREFIX}.**`, { suppressErrors: false })
  async handle(event: OutboxEvent): Promise<OutboxHandlerResult> {
    const outcome = await this.chainer.chainRow(event.tx, {
      context: event.context,
      id: event.id,
      payload: event.payload,
      createdAt: event.createdAt,
    });
    if (outcome === 'skipped') return OUTBOX_DEFER;
  }
}
