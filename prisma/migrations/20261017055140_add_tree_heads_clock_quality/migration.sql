-- AlterTable: host clock quality at STH write time (A-B16.5 / 2.9); not part of the signed payload
ALTER TABLE "audit"."tree_heads"
  ADD COLUMN "clock_quality" VARCHAR(16) NOT NULL DEFAULT 'ok';

ALTER TABLE "audit"."tree_heads"
  ADD CONSTRAINT "tree_heads_clock_quality_chk"
  CHECK ("clock_quality" IN ('ok', 'degraded', 'unknown'));

-- Append-only trigger must treat clock_quality as immutable (only tsa_token may change once)
CREATE OR REPLACE FUNCTION "audit"."tree_heads_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tree_heads is append-only: DELETE is not allowed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tsa_token IS NULL
       AND NEW.tsa_token IS NOT NULL
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.tree_size IS NOT DISTINCT FROM OLD.tree_size
       AND NEW.root_hash IS NOT DISTINCT FROM OLD.root_hash
       AND NEW.timestamp IS NOT DISTINCT FROM OLD.timestamp
       AND NEW.previous_sth_hash IS NOT DISTINCT FROM OLD.previous_sth_hash
       AND NEW.alg IS NOT DISTINCT FROM OLD.alg
       AND NEW.key_id IS NOT DISTINCT FROM OLD.key_id
       AND NEW.signature IS NOT DISTINCT FROM OLD.signature
       AND NEW.clock_quality IS NOT DISTINCT FROM OLD.clock_quality
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'tree_heads is append-only: only tsa_token may be set once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
