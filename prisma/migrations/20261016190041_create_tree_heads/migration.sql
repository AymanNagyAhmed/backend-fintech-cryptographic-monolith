-- CreateTable
CREATE TABLE "audit"."tree_heads" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tree_size" INTEGER NOT NULL,
    "root_hash" CHAR(64) NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "previous_sth_hash" CHAR(64),
    "alg" VARCHAR(32) NOT NULL,
    "key_id" VARCHAR(128) NOT NULL,
    "signature" TEXT NOT NULL,
    "tsa_token" BYTEA,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tree_heads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tree_heads_tree_size_key" ON "audit"."tree_heads"("tree_size");

-- CreateIndex
CREATE INDEX "tree_heads_created_at_idx" ON "audit"."tree_heads"("created_at");

-- Custom SQL

ALTER TABLE "audit"."tree_heads"
  ADD CONSTRAINT "tree_heads_tree_size_chk" CHECK ("tree_size" >= 1),
  ADD CONSTRAINT "tree_heads_root_hash_chk" CHECK ("root_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "tree_heads_previous_sth_hash_chk" CHECK (
    "previous_sth_hash" IS NULL OR "previous_sth_hash" ~ '^[0-9a-f]{64}$'
  );

-- Append-only except a one-time fill of tsa_token (A-B10.5)
CREATE FUNCTION "audit"."tree_heads_append_only"() RETURNS trigger
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

CREATE TRIGGER "tree_heads_append_only"
  BEFORE UPDATE OR DELETE ON "audit"."tree_heads"
  FOR EACH ROW EXECUTE FUNCTION "audit"."tree_heads_append_only"();

CREATE TRIGGER "tree_heads_no_truncate"
  BEFORE TRUNCATE ON "audit"."tree_heads"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit"."tree_heads_append_only"();

REVOKE DELETE, TRUNCATE ON "audit"."tree_heads" FROM app_writer;
GRANT SELECT, INSERT, UPDATE ON "audit"."tree_heads" TO app_writer;
GRANT SELECT ON "audit"."tree_heads" TO auditor_ro;
