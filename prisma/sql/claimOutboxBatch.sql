-- Outbox dispatcher batch (A-B14.3): up to $2 oldest unprocessed rows of one context,
-- locked with FOR UPDATE SKIP LOCKED until the transaction ends (audit.claim_outbox_batch).
-- @param {String} $1:context
-- @param {Int} $2:batchSize
SELECT id, payload, "createdAt" FROM audit.claim_outbox_batch($1::text, $2::int);
