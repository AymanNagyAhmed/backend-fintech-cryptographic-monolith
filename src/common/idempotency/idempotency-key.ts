import { invalidIdempotencyKey } from './exceptions/idempotency.exceptions.js';

// Same rules as the CHECKs on ledger.idempotency_keys
const SCOPE = /^[a-z0-9][a-z0-9_.:-]{0,99}$/;
/** Printable ASCII without spaces: a UUID header, a provider event id, a message id. */
const KEY = /^[!-~]{1,255}$/;

/** Client input (the Idempotency-Key header): 400 INVALID_IDEMPOTENCY_KEY when missing or malformed. */
export function assertIdempotencyKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !KEY.test(key)) throw invalidIdempotencyKey();
}

/** Scopes are chosen by code, so a bad one is a programming error (500), never client input. */
export function assertIdempotencyScope(scope: string): void {
  if (!SCOPE.test(scope))
    throw new Error(`Invalid idempotency scope "${scope}"`);
}
