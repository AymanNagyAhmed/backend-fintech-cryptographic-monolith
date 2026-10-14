-- Outgoing transfer total of one account in the current UTC day (index from_account_id,
-- created_at). now() is the transaction start, so a transaction that waited on the account
-- lock across midnight still counts the day it started in. Run it while holding the
-- account lock, so concurrent transfers of the account are counted one after the other.
-- @param {String} $1:accountId
SELECT COALESCE(SUM(amount), 0::numeric(20, 8))::text AS total
FROM ledger.transfers
WHERE from_account_id = $1::uuid
  AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
