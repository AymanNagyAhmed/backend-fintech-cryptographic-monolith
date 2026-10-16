-- CreateTable
CREATE TABLE "audit"."audit_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "partition_key" VARCHAR(64) NOT NULL,
    "seq" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,
    "prev_hash" CHAR(64) NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "source_context" VARCHAR(32) NOT NULL,
    "source_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_partition_key_occurred_at_idx" ON "audit"."audit_events"("partition_key", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_partition_key_seq_key" ON "audit"."audit_events"("partition_key", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_source_context_source_id_key" ON "audit"."audit_events"("source_context", "source_id");

-- Custom SQL (Prisma schema cannot express CHECK constraints, triggers or REVOKE)

ALTER TABLE "audit"."audit_events"
  ADD CONSTRAINT "audit_events_partition_key_chk" CHECK (
    "partition_key" ~ '^[A-Za-z0-9_.:-]{1,64}$'
  ),
  ADD CONSTRAINT "audit_events_seq_chk" CHECK ("seq" >= 1),
  ADD CONSTRAINT "audit_events_prev_hash_chk" CHECK ("prev_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "audit_events_hash_chk" CHECK ("hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "audit_events_source_context_chk" CHECK (
    "source_context" IN ('auth', 'wallet', 'ledger', 'payments')
  ),
  ADD CONSTRAINT "audit_events_payload_chk" CHECK (
    jsonb_typeof("payload") = 'object'
    AND pg_column_size("payload") <= 65536
  );

-- Append-only: corrections are never in-place edits (2.1)
CREATE FUNCTION "audit"."audit_events_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "audit"."audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit"."audit_events_append_only"();

CREATE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON "audit"."audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit"."audit_events_append_only"();

-- Default privileges already SELECT+INSERT for audit; pin the table explicitly
REVOKE UPDATE, DELETE, TRUNCATE ON "audit"."audit_events" FROM app_writer;
GRANT SELECT, INSERT ON "audit"."audit_events" TO app_writer;
GRANT SELECT ON "audit"."audit_events" TO auditor_ro;
