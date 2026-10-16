import type { Prisma } from '../../../generated/prisma/client.js';
import type { OutboxContext } from '../outbox-context.js';

/**
 * One outbox row delivered to in-process handlers (A-B14.3). `tx` is the dispatcher's
 * transaction: a handler that writes through it commits atomically with `processed_at`, so
 * its effect happens once even if the dispatcher is killed and the row is delivered again.
 */
export interface OutboxEvent {
  context: OutboxContext;
  /** Outbox row id, stable across redeliveries (idempotency key for the handler). */
  id: string;
  /** `payload.type`, e.g. `transfer.completed`. */
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  tx: Prisma.TransactionClient;
}
