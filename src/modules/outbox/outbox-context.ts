/** Bounded contexts that own an `outbox` table (A-B9.3). The chainer reads all of them. */
export const OUTBOX_CONTEXTS = [
  'auth',
  'wallet',
  'ledger',
  'payments',
] as const;

export type OutboxContext = (typeof OUTBOX_CONTEXTS)[number];
