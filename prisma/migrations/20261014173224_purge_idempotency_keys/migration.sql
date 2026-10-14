-- Custom SQL (Prisma schema cannot express functions or grants)

-- Purge of old idempotency keys (A-B6.6). app_writer has no DELETE on ledger tables; this
-- function runs as its owner (migrator) and deletes only keys older than p_older_than,
-- which can never be shorter than 30 days, so the application role cannot erase recent
-- keys and replay a request. At most p_limit rows per call (oldest first), so a large
-- backlog is purged in short transactions; rows locked by a running request are skipped.
CREATE FUNCTION "ledger"."purge_idempotency_keys"(p_older_than interval, p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  deleted integer;
BEGIN
  IF p_older_than IS NULL OR p_older_than < interval '30 days' THEN
    RAISE EXCEPTION 'purge_idempotency_keys: keys are kept at least 30 days'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'purge_idempotency_keys: limit must be between 1 and 10000'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH doomed AS (
    SELECT id FROM "ledger"."idempotency_keys"
    WHERE created_at < now() - p_older_than
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM "ledger"."idempotency_keys" k
  USING doomed
  WHERE k.id = doomed.id;

  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

REVOKE ALL ON FUNCTION "ledger"."purge_idempotency_keys"(interval, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "ledger"."purge_idempotency_keys"(interval, integer) TO app_writer;
