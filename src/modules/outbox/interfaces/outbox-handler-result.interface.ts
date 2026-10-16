/**
 * A handler returns this to leave the row unprocessed (it stays in the outbox and is claimed
 * again by a later run), e.g. when the audit partition lock is held by another writer.
 * Any other return value, or none, means handled. Throwing aborts the batch transaction.
 */
export const OUTBOX_DEFER = 'defer' as const;

export type OutboxHandlerResult = void | typeof OUTBOX_DEFER;
