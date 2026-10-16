import type { OutboxContext } from './outbox-context.js';

/** One claimed outbox row (A-B9.5 chainer). */
export interface OutboxRow {
  context: OutboxContext;
  id: string;
  payload: unknown;
  createdAt: Date;
}
