-- CreateEnum
CREATE TYPE "payments"."webhook_outcome" AS ENUM ('credited', 'rejected', 'ignored');

-- CreateEnum
CREATE TYPE "payments"."webhook_review_status" AS ENUM ('pending', 'resolved');

-- CreateTable
CREATE TABLE "payments"."webhook_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "provider" VARCHAR(32) NOT NULL,
    "event_id" VARCHAR(100) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "outcome" "payments"."webhook_outcome" NOT NULL,
    "reason_code" VARCHAR(50),
    "reason_message" VARCHAR(500),
    "request_hash" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "signed_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "review_status" "payments"."webhook_review_status",
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by" VARCHAR(100),
    "review_note" VARCHAR(1000),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_events_review_status_received_at_idx" ON "payments"."webhook_events"("review_status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "payments"."webhook_events"("provider", "event_id");

-- Custom SQL (Prisma schema cannot express CHECK constraints, triggers or REVOKE)

-- Same formats as WebhookEventDto; payload is the redacted body of exactly this event
ALTER TABLE "payments"."webhook_events"
  ADD CONSTRAINT "webhook_events_provider_chk" CHECK ("provider" ~ '^[a-z][a-z0-9_]{0,31}$'),
  ADD CONSTRAINT "webhook_events_event_id_chk" CHECK ("event_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'),
  ADD CONSTRAINT "webhook_events_type_chk" CHECK ("type" ~ '^[a-z0-9_.]{1,100}$'),
  ADD CONSTRAINT "webhook_events_request_hash_chk" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "webhook_events_reason_chk" CHECK (
    ("reason_code" IS NULL) = ("reason_message" IS NULL)
    AND ("outcome" = 'rejected') = ("reason_code" IS NOT NULL)
    AND ("reason_code" IS NULL OR "reason_code" ~ '^[A-Z][A-Z0-9_]{0,49}$')
  ),
  ADD CONSTRAINT "webhook_events_payload_chk" CHECK (
    jsonb_typeof("payload") = 'object'
    AND pg_column_size("payload") <= 4096
    AND "payload"->>'id' = "event_id"
    AND "payload"->>'type' = "type"
  ),
  -- Allow-list (webhook-payload.ts): a field that is not listed can never be stored
  ADD CONSTRAINT "webhook_events_payload_allow_list_chk" CHECK (
    "payload" - ARRAY['id', 'type', 'created', 'data'] = '{}'::jsonb
    AND CASE "type"
      WHEN 'payment.succeeded' THEN
        jsonb_typeof("payload"->'data') = 'object'
        AND ("payload"->'data') - ARRAY['walletId', 'amount', 'currency'] = '{}'::jsonb
      ELSE NOT ("payload" ? 'data')
    END
  ),
  ADD CONSTRAINT "webhook_events_signed_at_chk" CHECK (
    "signed_at" BETWEEN "received_at" - interval '1 hour' AND "received_at" + interval '1 hour'
  ),
  -- Only rejected events are reviewed; a resolved review names who resolved it and how
  ADD CONSTRAINT "webhook_events_review_chk" CHECK (
    ("outcome" = 'rejected') = ("review_status" IS NOT NULL)
    AND CASE "review_status"
      WHEN 'resolved' THEN
        "reviewed_at" >= "received_at"
        AND btrim("reviewed_by") <> ''
        AND btrim("review_note") <> ''
      ELSE "reviewed_at" IS NULL AND "reviewed_by" IS NULL AND "review_note" IS NULL
    END
  );

-- The event is fixed; the only change is resolving a pending review, once
CREATE FUNCTION "payments"."webhook_events_guard_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
     OR NEW.reason_message IS DISTINCT FROM OLD.reason_message
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR (OLD.review_status IS DISTINCT FROM 'pending' AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*)) THEN
    RAISE EXCEPTION 'webhook_events: the event is fixed; only a pending review can be resolved, once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "webhook_events_guard_update"
  BEFORE UPDATE ON "payments"."webhook_events"
  FOR EACH ROW EXECUTE FUNCTION "payments"."webhook_events_guard_update"();

-- Rejected deposits must stay reviewable: no DELETE or TRUNCATE, also not as migrator
CREATE FUNCTION "payments"."webhook_events_no_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'webhook_events is append-only'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "webhook_events_no_delete"
  BEFORE DELETE ON "payments"."webhook_events"
  FOR EACH ROW EXECUTE FUNCTION "payments"."webhook_events_no_delete"();

CREATE TRIGGER "webhook_events_no_truncate"
  BEFORE TRUNCATE ON "payments"."webhook_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "payments"."webhook_events_no_delete"();

-- The application only inserts; reviews run as migrator until review endpoints exist
REVOKE UPDATE, DELETE, TRUNCATE ON "payments"."webhook_events" FROM app_writer;
