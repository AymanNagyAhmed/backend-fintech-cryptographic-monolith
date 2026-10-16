-- A-B12.2: Convert audit.audit_events to HASH (partition_key) with 16 partitions (2.15).

DROP TRIGGER IF EXISTS "audit_events_append_only" ON "audit"."audit_events";
DROP TRIGGER IF EXISTS "audit_events_no_truncate" ON "audit"."audit_events";

ALTER TABLE "audit"."audit_events" RENAME TO "audit_events_heap";

-- Avoid name clashes with the new partitioned table's indexes/constraints
ALTER TABLE "audit"."audit_events_heap" RENAME CONSTRAINT "audit_events_pkey" TO "audit_events_heap_pkey";
ALTER INDEX "audit"."audit_events_partition_key_seq_key" RENAME TO "audit_events_heap_partition_key_seq_key";
ALTER INDEX "audit"."audit_events_source_context_source_id_key" RENAME TO "audit_events_heap_source_key";
ALTER INDEX "audit"."audit_events_partition_key_occurred_at_idx" RENAME TO "audit_events_heap_partition_occurred_idx";

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
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("partition_key", "id")
) PARTITION BY HASH ("partition_key");

CREATE TABLE "audit"."audit_events_p00" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 0);
CREATE TABLE "audit"."audit_events_p01" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 1);
CREATE TABLE "audit"."audit_events_p02" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 2);
CREATE TABLE "audit"."audit_events_p03" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 3);
CREATE TABLE "audit"."audit_events_p04" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 4);
CREATE TABLE "audit"."audit_events_p05" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 5);
CREATE TABLE "audit"."audit_events_p06" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 6);
CREATE TABLE "audit"."audit_events_p07" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 7);
CREATE TABLE "audit"."audit_events_p08" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 8);
CREATE TABLE "audit"."audit_events_p09" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 9);
CREATE TABLE "audit"."audit_events_p10" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 10);
CREATE TABLE "audit"."audit_events_p11" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 11);
CREATE TABLE "audit"."audit_events_p12" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 12);
CREATE TABLE "audit"."audit_events_p13" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 13);
CREATE TABLE "audit"."audit_events_p14" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 14);
CREATE TABLE "audit"."audit_events_p15" PARTITION OF "audit"."audit_events" FOR VALUES WITH (MODULUS 16, REMAINDER 15);

INSERT INTO "audit"."audit_events" (
  "id", "partition_key", "seq", "payload", "prev_hash", "hash",
  "source_context", "source_id", "occurred_at", "created_at"
)
SELECT
  "id", "partition_key", "seq", "payload", "prev_hash", "hash",
  "source_context", "source_id", "occurred_at", "created_at"
FROM "audit"."audit_events_heap";

DROP TABLE "audit"."audit_events_heap";

CREATE UNIQUE INDEX "audit_events_partition_key_seq_key"
  ON "audit"."audit_events"("partition_key", "seq");
CREATE UNIQUE INDEX "audit_events_partition_source_key"
  ON "audit"."audit_events"("partition_key", "source_context", "source_id");
CREATE INDEX "audit_events_partition_key_occurred_at_idx"
  ON "audit"."audit_events"("partition_key", "occurred_at");

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

CREATE TRIGGER "audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "audit"."audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit"."audit_events_append_only"();

CREATE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON "audit"."audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit"."audit_events_append_only"();

REVOKE UPDATE, DELETE, TRUNCATE ON "audit"."audit_events" FROM app_writer;
GRANT SELECT, INSERT ON "audit"."audit_events" TO app_writer;
GRANT SELECT ON "audit"."audit_events" TO auditor_ro;
