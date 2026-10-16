-- Claim the globally oldest unprocessed outbox row across contexts (A-B9.5).
-- Peek without locking, then lock the concrete row (SKIP LOCKED if a peer won the race).
CREATE OR REPLACE FUNCTION audit.claim_outbox_row()
RETURNS TABLE (
  context text,
  id uuid,
  payload jsonb,
  "createdAt" timestamptz
)
LANGUAGE plpgsql
AS $$
DECLARE
  chosen_context text;
  chosen_id uuid;
BEGIN
  SELECT x.context, x.id
  INTO chosen_context, chosen_id
  FROM (
    SELECT 'auth'::text AS context, o.id, o.created_at FROM auth.outbox o WHERE o.processed_at IS NULL
    UNION ALL
    SELECT 'wallet', o.id, o.created_at FROM wallet.outbox o WHERE o.processed_at IS NULL
    UNION ALL
    SELECT 'ledger', o.id, o.created_at FROM ledger.outbox o WHERE o.processed_at IS NULL
    UNION ALL
    SELECT 'payments', o.id, o.created_at FROM payments.outbox o WHERE o.processed_at IS NULL
  ) x
  ORDER BY x.created_at, x.context, x.id
  LIMIT 1;

  IF chosen_id IS NULL THEN
    RETURN;
  END IF;

  IF chosen_context = 'auth' THEN
    RETURN QUERY
      SELECT 'auth'::text, o.id, o.payload, o.created_at
      FROM auth.outbox o
      WHERE o.id = chosen_id AND o.processed_at IS NULL
      FOR UPDATE SKIP LOCKED;
  ELSIF chosen_context = 'wallet' THEN
    RETURN QUERY
      SELECT 'wallet'::text, o.id, o.payload, o.created_at
      FROM wallet.outbox o
      WHERE o.id = chosen_id AND o.processed_at IS NULL
      FOR UPDATE SKIP LOCKED;
  ELSIF chosen_context = 'ledger' THEN
    RETURN QUERY
      SELECT 'ledger'::text, o.id, o.payload, o.created_at
      FROM ledger.outbox o
      WHERE o.id = chosen_id AND o.processed_at IS NULL
      FOR UPDATE SKIP LOCKED;
  ELSE
    RETURN QUERY
      SELECT 'payments'::text, o.id, o.payload, o.created_at
      FROM payments.outbox o
      WHERE o.id = chosen_id AND o.processed_at IS NULL
      FOR UPDATE SKIP LOCKED;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION audit.claim_outbox_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.claim_outbox_row() TO app_writer;
