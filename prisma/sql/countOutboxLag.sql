-- Unprocessed outbox rows across contexts (A-B9.7 backpressure / lag alert).
SELECT
  (SELECT count(*)::int FROM auth.outbox WHERE processed_at IS NULL)
  + (SELECT count(*)::int FROM wallet.outbox WHERE processed_at IS NULL)
  + (SELECT count(*)::int FROM ledger.outbox WHERE processed_at IS NULL)
  + (SELECT count(*)::int FROM payments.outbox WHERE processed_at IS NULL)
  AS lag;
