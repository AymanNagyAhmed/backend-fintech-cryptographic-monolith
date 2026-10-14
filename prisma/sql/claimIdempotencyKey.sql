-- Claims (scope, key) for this transaction. A concurrent claim of the same key waits on the
-- unique index until the first transaction ends: no row if it committed, the claim if it
-- rolled back. Under REPEATABLE READ or SERIALIZABLE the wait ends in a serialization error.
-- @param {String} $1:scope
-- @param {String} $2:key
-- @param {String} $3:requestHash
INSERT INTO ledger.idempotency_keys (scope, key, request_hash)
VALUES ($1, $2, $3)
ON CONFLICT (scope, key) DO NOTHING
RETURNING id
