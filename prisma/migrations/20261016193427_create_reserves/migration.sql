-- CreateTable
CREATE TABLE "reserves"."snapshots" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "currency" VARCHAR(10) NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "tree_size" INTEGER NOT NULL,
    "root_hash" CHAR(64) NOT NULL,
    "total_liabilities" DECIMAL(20,8) NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserves"."leaves" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "snapshot_id" UUID NOT NULL,
    "leaf_index" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "balance" DECIMAL(20,8) NOT NULL,
    "salt" CHAR(32) NOT NULL,
    "leaf_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaves_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "snapshots_currency_published_at_idx" ON "reserves"."snapshots"("currency", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "snapshots_currency_snapshot_date_key" ON "reserves"."snapshots"("currency", "snapshot_date");

-- CreateIndex
CREATE INDEX "leaves_user_id_snapshot_id_idx" ON "reserves"."leaves"("user_id", "snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "leaves_snapshot_id_leaf_index_key" ON "reserves"."leaves"("snapshot_id", "leaf_index");

-- CreateIndex
CREATE UNIQUE INDEX "leaves_snapshot_id_user_id_key" ON "reserves"."leaves"("snapshot_id", "user_id");

-- AddForeignKey
ALTER TABLE "reserves"."leaves" ADD CONSTRAINT "leaves_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "reserves"."snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom SQL

ALTER TABLE "reserves"."snapshots"
  ADD CONSTRAINT "snapshots_currency_chk" CHECK ("currency" ~ '^[A-Z]{2,10}$'),
  ADD CONSTRAINT "snapshots_tree_size_chk" CHECK ("tree_size" >= 1),
  ADD CONSTRAINT "snapshots_root_hash_chk" CHECK ("root_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "snapshots_total_liabilities_chk" CHECK ("total_liabilities" >= 0);

ALTER TABLE "reserves"."leaves"
  ADD CONSTRAINT "leaves_leaf_index_chk" CHECK ("leaf_index" >= 0),
  ADD CONSTRAINT "leaves_balance_chk" CHECK ("balance" > 0),
  ADD CONSTRAINT "leaves_salt_chk" CHECK ("salt" ~ '^[0-9a-f]{32}$'),
  ADD CONSTRAINT "leaves_leaf_hash_chk" CHECK ("leaf_hash" ~ '^[0-9a-f]{64}$');

-- A published snapshot and its leaves are evidence: insert-only, no UPDATE, DELETE or TRUNCATE
CREATE FUNCTION "reserves"."insert_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%.% is insert-only: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "snapshots_insert_only"
  BEFORE UPDATE OR DELETE ON "reserves"."snapshots"
  FOR EACH ROW EXECUTE FUNCTION "reserves"."insert_only"();
CREATE TRIGGER "snapshots_no_truncate"
  BEFORE TRUNCATE ON "reserves"."snapshots"
  FOR EACH STATEMENT EXECUTE FUNCTION "reserves"."insert_only"();

CREATE TRIGGER "leaves_insert_only"
  BEFORE UPDATE OR DELETE ON "reserves"."leaves"
  FOR EACH ROW EXECUTE FUNCTION "reserves"."insert_only"();
CREATE TRIGGER "leaves_no_truncate"
  BEFORE TRUNCATE ON "reserves"."leaves"
  FOR EACH STATEMENT EXECUTE FUNCTION "reserves"."insert_only"();

GRANT SELECT, INSERT ON "reserves"."snapshots", "reserves"."leaves" TO app_writer;
REVOKE UPDATE, DELETE, TRUNCATE ON "reserves"."snapshots", "reserves"."leaves" FROM app_writer;

-- Auditors read the published figures only; leaves (user ids, balances, salts) stay with the app
GRANT USAGE ON SCHEMA "reserves" TO auditor_ro;
GRANT SELECT ON "reserves"."snapshots" TO auditor_ro;
