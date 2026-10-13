-- CreateTable
CREATE TABLE "ledger"."postings" (
    "ref" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "postings_pkey" PRIMARY KEY ("ref")
);

-- Backfill: one posting per existing ref, before the FK is added
INSERT INTO "ledger"."postings" ("ref", "created_at")
SELECT "ref", min("created_at") FROM "ledger"."ledger_entries" GROUP BY "ref";

-- AddForeignKey
ALTER TABLE "ledger"."ledger_entries" ADD CONSTRAINT "ledger_entries_ref_fkey" FOREIGN KEY ("ref") REFERENCES "ledger"."postings"("ref") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom SQL (Prisma schema cannot express CHECK constraints, triggers or REVOKE)
ALTER TABLE "ledger"."postings"
  ADD CONSTRAINT "postings_ref_chk" CHECK ("ref" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$');

-- Append-only like ledger_entries; the function now names the table it guards
REVOKE UPDATE, DELETE, TRUNCATE ON "ledger"."postings" FROM app_writer;

CREATE OR REPLACE FUNCTION "ledger"."ledger_entries_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed; post a reversing entry', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "postings_append_only"
  BEFORE UPDATE OR DELETE ON "ledger"."postings"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."ledger_entries_append_only"();

CREATE TRIGGER "postings_no_truncate"
  BEFORE TRUNCATE ON "ledger"."postings"
  FOR EACH STATEMENT EXECUTE FUNCTION "ledger"."ledger_entries_append_only"();
