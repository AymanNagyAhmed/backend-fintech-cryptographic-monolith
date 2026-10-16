-- Claim up to p_limit unprocessed outbox rows of ONE context for the in-process dispatcher
-- (A-B14.3). Oldest first; rows locked by another dispatcher are skipped, not waited for
-- (FOR UPDATE SKIP LOCKED), so concurrent dispatchers never take the same row. The row locks
-- last until the caller's transaction ends: a crash rolls back and releases them, the rows
-- stay unprocessed and are delivered again by the next run.
-- Complements audit.claim_outbox_row() (single oldest row across contexts, used by the chainer).
CREATE OR REPLACE FUNCTION audit.claim_outbox_batch(p_context text, p_limit integer)
RETURNS TABLE (
  id uuid,
  payload jsonb,
  "createdAt" timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'claim_outbox_batch: p_limit must be between 1 and 1000'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_context = 'auth' THEN
    RETURN QUERY
      SELECT o.id, o.payload, o.created_at
      FROM auth.outbox o
      WHERE o.processed_at IS NULL
      ORDER BY o.created_at, o.id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED;
  ELSIF p_context = 'wallet' THEN
    RETURN QUERY
      SELECT o.id, o.payload, o.created_at
      FROM wallet.outbox o
      WHERE o.processed_at IS NULL
      ORDER BY o.created_at, o.id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED;
  ELSIF p_context = 'ledger' THEN
    RETURN QUERY
      SELECT o.id, o.payload, o.created_at
      FROM ledger.outbox o
      WHERE o.processed_at IS NULL
      ORDER BY o.created_at, o.id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED;
  ELSIF p_context = 'payments' THEN
    RETURN QUERY
      SELECT o.id, o.payload, o.created_at
      FROM payments.outbox o
      WHERE o.processed_at IS NULL
      ORDER BY o.created_at, o.id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED;
  ELSIF p_context = 'withdrawals' THEN
    RETURN QUERY
      SELECT o.id, o.payload, o.created_at
      FROM withdrawals.outbox o
      WHERE o.processed_at IS NULL
      ORDER BY o.created_at, o.id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED;
  ELSE
    RAISE EXCEPTION 'claim_outbox_batch: unknown context %', p_context
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION audit.claim_outbox_batch(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.claim_outbox_batch(text, integer) TO app_writer;
