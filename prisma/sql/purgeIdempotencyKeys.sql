-- One purge batch: deletes up to $2 keys older than $1 days (at least 30, enforced by the
-- SECURITY DEFINER function) and returns how many it deleted
-- @param {Int} $1:olderThanDays
-- @param {Int} $2:limit
SELECT ledger.purge_idempotency_keys(make_interval(days => $1::int), $2::int) AS deleted
