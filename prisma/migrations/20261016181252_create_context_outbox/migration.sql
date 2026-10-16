-- CreateTable
CREATE TABLE "auth"."outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger"."outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments"."outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet"."outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_processed_at_created_at_idx" ON "auth"."outbox"("processed_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_processed_at_created_at_idx" ON "ledger"."outbox"("processed_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_processed_at_created_at_idx" ON "payments"."outbox"("processed_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_processed_at_created_at_idx" ON "wallet"."outbox"("processed_at", "created_at");

-- Custom SQL (Prisma schema cannot express CHECK constraints, triggers or REVOKE)
-- Each context owns its outbox. Business code INSERT only; the chainer claims by setting
-- processed_at once. No DELETE (app_writer never has DELETE; trigger blocks migrator too).

DO $outbox$
DECLARE
  sch text;
BEGIN
  FOREACH sch IN ARRAY ARRAY['auth', 'wallet', 'ledger', 'payments'] LOOP
    EXECUTE format($sql$
      ALTER TABLE %1$I.outbox
        ADD CONSTRAINT outbox_payload_chk CHECK (
          jsonb_typeof(payload) = 'object'
          AND pg_column_size(payload) <= 65536
        ),
        ADD CONSTRAINT outbox_processed_at_chk CHECK (
          processed_at IS NULL OR processed_at >= created_at
        );

      CREATE FUNCTION %1$I.outbox_guard_update() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.payload IS DISTINCT FROM OLD.payload
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR OLD.processed_at IS NOT NULL
           OR NEW.processed_at IS NULL THEN
          RAISE EXCEPTION 'outbox: only an unprocessed row may set processed_at once'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN NEW;
      END;
      $fn$;

      CREATE TRIGGER outbox_guard_update
        BEFORE UPDATE ON %1$I.outbox
        FOR EACH ROW EXECUTE FUNCTION %1$I.outbox_guard_update();

      CREATE FUNCTION %1$I.outbox_no_delete() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION 'outbox is append-only (claim via processed_at; never delete)'
          USING ERRCODE = 'integrity_constraint_violation';
      END;
      $fn$;

      CREATE TRIGGER outbox_no_delete
        BEFORE DELETE ON %1$I.outbox
        FOR EACH ROW EXECUTE FUNCTION %1$I.outbox_no_delete();

      CREATE TRIGGER outbox_no_truncate
        BEFORE TRUNCATE ON %1$I.outbox
        FOR EACH STATEMENT EXECUTE FUNCTION %1$I.outbox_no_delete();

      REVOKE DELETE, TRUNCATE ON %1$I.outbox FROM app_writer;
    $sql$, sch);
  END LOOP;
END;
$outbox$;
