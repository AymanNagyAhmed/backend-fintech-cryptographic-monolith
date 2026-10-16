-- CreateEnum
CREATE TYPE "withdrawals"."beneficiary_status" AS ENUM ('pending_confirmation', 'confirmed', 'revoked');

-- CreateTable
CREATE TABLE "withdrawals"."beneficiaries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_user_id" UUID NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "address" VARCHAR(256) NOT NULL,
    "network" VARCHAR(64) NOT NULL,
    "status" "withdrawals"."beneficiary_status" NOT NULL DEFAULT 'pending_confirmation',
    "confirmed_at" TIMESTAMPTZ(6),
    "active_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals"."outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "beneficiaries_owner_user_id_status_id_idx" ON "withdrawals"."beneficiaries"("owner_user_id", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiaries_owner_user_id_currency_network_address_key" ON "withdrawals"."beneficiaries"("owner_user_id", "currency", "network", "address");

-- CreateIndex
CREATE INDEX "outbox_processed_at_created_at_idx" ON "withdrawals"."outbox"("processed_at", "created_at");

ALTER TABLE "withdrawals"."beneficiaries"
  ADD CONSTRAINT "beneficiaries_currency_chk" CHECK (
    "currency" IN ('AED', 'USD', 'EUR', 'BTC')
  ),
  ADD CONSTRAINT "beneficiaries_label_chk" CHECK (
    length(btrim("label")) > 0
    AND "label" !~ '[[:cntrl:]]'
  ),
  ADD CONSTRAINT "beneficiaries_address_chk" CHECK (
    length(btrim("address")) > 0
    AND "address" !~ '[[:cntrl:]]'
  ),
  ADD CONSTRAINT "beneficiaries_network_chk" CHECK (
    length(btrim("network")) > 0
    AND "network" = lower("network")
    AND "network" !~ '[[:cntrl:]]'
  ),
  ADD CONSTRAINT "beneficiaries_confirmed_chk" CHECK (
    ("status" = 'pending_confirmation' AND "confirmed_at" IS NULL AND "active_at" IS NULL AND "revoked_at" IS NULL)
    OR ("status" = 'confirmed' AND "confirmed_at" IS NOT NULL AND "active_at" IS NOT NULL AND "active_at" >= "confirmed_at" AND "revoked_at" IS NULL)
    OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
  );

GRANT SELECT, INSERT, UPDATE ON "withdrawals"."beneficiaries" TO app_writer;
GRANT SELECT ON "withdrawals"."beneficiaries" TO auditor_ro;
REVOKE DELETE, TRUNCATE ON "withdrawals"."beneficiaries" FROM app_writer;

GRANT SELECT, INSERT, UPDATE ON "withdrawals"."outbox" TO app_writer;
GRANT SELECT ON "withdrawals"."outbox" TO auditor_ro;

-- Same outbox guards as auth/wallet/ledger/payments (A-B9.3)
ALTER TABLE withdrawals.outbox
  ADD CONSTRAINT outbox_payload_chk CHECK (
    jsonb_typeof(payload) = 'object'
    AND pg_column_size(payload) <= 65536
  ),
  ADD CONSTRAINT outbox_processed_at_chk CHECK (
    processed_at IS NULL OR processed_at >= created_at
  );

CREATE FUNCTION withdrawals.outbox_guard_update() RETURNS trigger
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
  BEFORE UPDATE ON withdrawals.outbox
  FOR EACH ROW EXECUTE FUNCTION withdrawals.outbox_guard_update();

CREATE FUNCTION withdrawals.outbox_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'outbox is append-only (claim via processed_at; never delete)'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$fn$;

CREATE TRIGGER outbox_no_delete
  BEFORE DELETE ON withdrawals.outbox
  FOR EACH ROW EXECUTE FUNCTION withdrawals.outbox_no_delete();

CREATE TRIGGER outbox_no_truncate
  BEFORE TRUNCATE ON withdrawals.outbox
  FOR EACH STATEMENT EXECUTE FUNCTION withdrawals.outbox_no_delete();

REVOKE DELETE, TRUNCATE ON withdrawals.outbox FROM app_writer;

-- Allow withdrawals as an audit source_context
ALTER TABLE audit.audit_events
  DROP CONSTRAINT audit_events_source_context_chk;

ALTER TABLE audit.audit_events
  ADD CONSTRAINT audit_events_source_context_chk CHECK (
    source_context::text = ANY (
      ARRAY[
        'auth'::character varying,
        'wallet'::character varying,
        'ledger'::character varying,
        'payments'::character varying,
        'withdrawals'::character varying
      ]::text[]
    )
  );

-- Claim the globally oldest unprocessed outbox row across contexts (incl. withdrawals)
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
    UNION ALL
    SELECT 'withdrawals', o.id, o.created_at FROM withdrawals.outbox o WHERE o.processed_at IS NULL
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
  ELSIF chosen_context = 'payments' THEN
    RETURN QUERY
      SELECT 'payments'::text, o.id, o.payload, o.created_at
      FROM payments.outbox o
      WHERE o.id = chosen_id AND o.processed_at IS NULL
      FOR UPDATE SKIP LOCKED;
  ELSE
    RETURN QUERY
      SELECT 'withdrawals'::text, o.id, o.payload, o.created_at
      FROM withdrawals.outbox o
      WHERE o.id = chosen_id AND o.processed_at IS NULL
      FOR UPDATE SKIP LOCKED;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION audit.claim_outbox_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.claim_outbox_row() TO app_writer;
