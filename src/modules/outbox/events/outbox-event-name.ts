/** EventEmitter2 delimiter; handlers subscribe with `outbox.transfer.completed` or `outbox.**`. */
export const OUTBOX_EVENT_PREFIX = 'outbox';

/** `transfer.completed` -> `outbox.transfer.completed`. */
export function outboxEventName(type: string): string {
  return `${OUTBOX_EVENT_PREFIX}.${type}`;
}
