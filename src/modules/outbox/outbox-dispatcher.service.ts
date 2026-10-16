import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service.js';
import { claimOutboxBatch } from '../../generated/prisma/sql.js';
import {
  OutboxEventTypeMissingError,
  OutboxNoHandlerError,
} from './exceptions/outbox-dispatch.exceptions.js';
import type { OutboxEvent } from './interfaces/outbox-event.interface.js';
import { OUTBOX_DEFER } from './interfaces/outbox-handler-result.interface.js';
import { OUTBOX_CONTEXTS, type OutboxContext } from './outbox-context.js';
import { outboxEventName } from './events/outbox-event-name.js';
import { OutboxService } from './outbox.service.js';

export const DEFAULT_DISPATCH_BATCH_SIZE = 50;

export interface DispatchResult {
  context: OutboxContext;
  /** Rows handled and marked processed. */
  delivered: number;
  /** Rows a handler asked to retry later (left unprocessed). */
  deferred: number;
}

/**
 * Delivers one context's outbox rows to in-process handlers (A-B14.3), the extraction seam:
 * today handlers run in this process (`@OnEvent('outbox.<type>')`), after extraction the same
 * loop publishes to a broker instead.
 *
 * One transaction per run: claim a batch with `FOR UPDATE SKIP LOCKED` (concurrent
 * dispatchers take different rows), emit each row, mark it processed. If the process is
 * killed mid-run the transaction rolls back, the row locks are released, nothing is marked
 * and the next run delivers the rows again; handler effects written through `event.tx` roll
 * back with it, so each event takes effect once. A handler that throws aborts the whole batch.
 * Handlers run in registration order, one at a time; a handler that defers after another one
 * has written means the row is delivered again, so handlers must be idempotent by `event.id`.
 */
@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
    private readonly outbox: OutboxService,
  ) {}

  async dispatch(
    context: OutboxContext,
    batchSize: number = DEFAULT_DISPATCH_BATCH_SIZE,
  ): Promise<DispatchResult> {
    const result = await this.prisma.withTx(
      async (tx): Promise<DispatchResult> => {
        const rows = await tx.$queryRawTyped(
          claimOutboxBatch(context, batchSize),
        );
        let delivered = 0;
        let deferred = 0;
        for (const row of rows) {
          if (!row.id || !row.createdAt) continue;
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          if (typeof payload.type !== 'string' || payload.type === '')
            throw new OutboxEventTypeMissingError(context, row.id);
          const eventName = outboxEventName(payload.type);
          const event: OutboxEvent = {
            context,
            id: row.id,
            type: payload.type,
            payload,
            createdAt: row.createdAt,
            tx,
          };
          // One handler at a time: with emitAsync a failing handler would roll the transaction
          // back while the others still query it (their errors would be unhandled rejections).
          const listeners = this.emitter.listeners(eventName);
          if (listeners.length === 0)
            throw new OutboxNoHandlerError(context, row.id, eventName);
          const results: unknown[] = [];
          for (const listener of listeners) results.push(await listener(event));
          if (results.includes(OUTBOX_DEFER)) {
            deferred += 1;
            continue;
          }
          await this.outbox.markProcessed(tx, context, row.id);
          delivered += 1;
        }
        return { context, delivered, deferred };
      },
      undefined,
      { timeoutMs: 30_000 },
    );
    if (result.delivered > 0 || result.deferred > 0)
      this.logger.log(result, 'Outbox batch dispatched');
    return result;
  }

  /** One run per context, in turn. */
  async dispatchAll(
    batchSize: number = DEFAULT_DISPATCH_BATCH_SIZE,
  ): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const context of OUTBOX_CONTEXTS)
      results.push(await this.dispatch(context, batchSize));
    return results;
  }
}
