-- CreateTable
CREATE TABLE "ledger"."idempotency_keys" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "scope" VARCHAR(100) NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status_code" SMALLINT,
    "response" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger"."transfers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ref" VARCHAR(128) NOT NULL,
    "from_account_id" UUID NOT NULL,
    "to_account_id" UUID NOT NULL,
    "from_wallet_id" UUID NOT NULL,
    "to_wallet_id" UUID NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "initiator_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idempotency_keys_created_at_idx" ON "ledger"."idempotency_keys"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "ledger"."idempotency_keys"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_ref_key" ON "ledger"."transfers"("ref");

-- CreateIndex
CREATE INDEX "transfers_from_account_id_created_at_idx" ON "ledger"."transfers"("from_account_id", "created_at");

-- CreateIndex
CREATE INDEX "transfers_to_account_id_idx" ON "ledger"."transfers"("to_account_id");

-- CreateIndex
CREATE INDEX "transfers_initiator_user_id_id_idx" ON "ledger"."transfers"("initiator_user_id", "id");

-- AddForeignKey
ALTER TABLE "ledger"."transfers" ADD CONSTRAINT "transfers_ref_fkey" FOREIGN KEY ("ref") REFERENCES "ledger"."postings"("ref") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger"."transfers" ADD CONSTRAINT "transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "ledger"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger"."transfers" ADD CONSTRAINT "transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "ledger"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom SQL (Prisma schema cannot express CHECK constraints, triggers or REVOKE)

-- idempotency_keys ------------------------------------------------------------
-- key: printable ASCII without spaces (Idempotency-Key header, provider event id, message id)
ALTER TABLE "ledger"."idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_scope_chk" CHECK ("scope" ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'),
  ADD CONSTRAINT "idempotency_keys_key_chk" CHECK ("key" ~ '^[!-~]{1,255}$'),
  ADD CONSTRAINT "idempotency_keys_request_hash_chk" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "idempotency_keys_response_chk" CHECK (
    ("status_code" IS NULL) = ("response" IS NULL)
    AND ("status_code" IS NULL OR "status_code" BETWEEN 200 AND 599)
    AND ("response" IS NULL OR pg_column_size("response") <= 65536)
  );

-- The claim is fixed; the stored response is written once and then replayed unchanged
CREATE FUNCTION "ledger"."idempotency_keys_guard_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.key IS DISTINCT FROM OLD.key
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.status_code IS NOT NULL AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*)) THEN
    RAISE EXCEPTION 'idempotency_keys: scope, key and request_hash are fixed; the response is written once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "idempotency_keys_guard_update"
  BEFORE UPDATE ON "ledger"."idempotency_keys"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."idempotency_keys_guard_update"();

-- transfers -------------------------------------------------------------------
ALTER TABLE "ledger"."transfers"
  ADD CONSTRAINT "transfers_amount_positive_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "transfers_distinct_accounts_chk" CHECK ("from_account_id" <> "to_account_id"),
  ADD CONSTRAINT "transfers_distinct_wallets_chk" CHECK ("from_wallet_id" <> "to_wallet_id");

-- Both sides are wallet accounts in the transfer's currency
CREATE FUNCTION "ledger"."transfers_check_accounts"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  matching int;
BEGIN
  SELECT count(*) INTO matching FROM "ledger"."accounts"
  WHERE id IN (NEW.from_account_id, NEW.to_account_id)
    AND kind = 'wallet' AND currency = NEW.currency;
  IF matching <> 2 THEN
    RAISE EXCEPTION 'transfers: both accounts must be wallet accounts in %', NEW.currency
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "transfers_check_accounts"
  BEFORE INSERT ON "ledger"."transfers"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."transfers_check_accounts"();

-- At commit: the posting moves exactly amount from the source to the target and touches
-- no other account, so a transfer row cannot claim a movement that did not happen
CREATE FUNCTION "ledger"."transfers_check_posting"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  accounts int;
  from_net numeric;
  to_net numeric;
BEGIN
  SELECT count(DISTINCT account_id),
         coalesce(sum(amount) FILTER (WHERE account_id = NEW.from_account_id), 0),
         coalesce(sum(amount) FILTER (WHERE account_id = NEW.to_account_id), 0)
    INTO accounts, from_net, to_net
  FROM "ledger"."ledger_entries" WHERE ref = NEW.ref;
  IF accounts <> 2 OR from_net <> -NEW.amount OR to_net <> NEW.amount THEN
    RAISE EXCEPTION 'transfers: posting % does not move % from % to %',
      NEW.ref, NEW.amount, NEW.from_account_id, NEW.to_account_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "transfers_check_posting"
  AFTER INSERT ON "ledger"."transfers"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger"."transfers_check_posting"();

-- Append-only like the postings it records
REVOKE UPDATE, DELETE, TRUNCATE ON "ledger"."transfers" FROM app_writer;

CREATE TRIGGER "transfers_append_only"
  BEFORE UPDATE OR DELETE ON "ledger"."transfers"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."ledger_entries_append_only"();

CREATE TRIGGER "transfers_no_truncate"
  BEFORE TRUNCATE ON "ledger"."transfers"
  FOR EACH STATEMENT EXECUTE FUNCTION "ledger"."ledger_entries_append_only"();
