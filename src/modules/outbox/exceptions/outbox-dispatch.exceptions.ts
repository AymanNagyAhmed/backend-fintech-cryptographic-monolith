import type { OutboxContext } from '../outbox-context.js';

/** The row has no usable `payload.type`; the batch rolls back and the row stays unprocessed. */
export class OutboxEventTypeMissingError extends Error {
  constructor(context: OutboxContext, id: string) {
    super(`Outbox row ${context}.${id} has no payload.type`);
    this.name = 'OutboxEventTypeMissingError';
  }
}

/**
 * Nothing subscribed to the event. Marking the row processed would lose it (the audit leaf
 * handler is the minimum subscriber), so the batch rolls back and the row stays unprocessed.
 */
export class OutboxNoHandlerError extends Error {
  constructor(context: OutboxContext, id: string, eventName: string) {
    super(`No handler for ${eventName} (outbox row ${context}.${id})`);
    this.name = 'OutboxNoHandlerError';
  }
}
