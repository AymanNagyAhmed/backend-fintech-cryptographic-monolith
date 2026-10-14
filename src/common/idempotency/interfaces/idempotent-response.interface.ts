export interface IdempotentResponse<T> {
  /** Stored with the result; a replay answers with the same status. */
  statusCode: number;
  /** The JSON form of the result (what the first call stored), identical on every replay. */
  body: T;
  /** true when the result comes from an earlier call with the same scope and key. */
  replayed: boolean;
}
