-- CreateEnum
CREATE TYPE "ledger"."account_kind" AS ENUM ('wallet', 'system');

-- CreateEnum
CREATE TYPE "ledger"."account_status" AS ENUM ('active', 'frozen', 'closed');

-- CreateTable
CREATE TABLE "ledger"."accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "currency" VARCHAR(10) NOT NULL,
    "kind" "ledger"."account_kind" NOT NULL,
    "code" VARCHAR(64),
    "allow_negative" BOOLEAN NOT NULL DEFAULT false,
    "balance" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "status" "ledger"."account_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger"."ledger_entries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seq" BIGSERIAL NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "ref" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "ledger"."accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_seq_key" ON "ledger"."ledger_entries"("seq");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_seq_idx" ON "ledger"."ledger_entries"("account_id", "seq");

-- CreateIndex
CREATE INDEX "ledger_entries_ref_idx" ON "ledger"."ledger_entries"("ref");

-- AddForeignKey
ALTER TABLE "ledger"."ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger"."accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom SQL (Prisma schema cannot express CHECK constraints, triggers or REVOKE)

-- accounts --------------------------------------------------------------------
-- Currency list = CURRENCY_SCALE in src/common/money/currency.ts (a test compares them)
ALTER TABLE "ledger"."accounts"
  ADD CONSTRAINT "accounts_currency_chk" CHECK ("currency" IN ('AED', 'USD', 'EUR', 'BTC')),
  ADD CONSTRAINT "accounts_balance_non_negative_chk" CHECK ("allow_negative" OR "balance" >= 0),
  ADD CONSTRAINT "accounts_negative_only_system_chk" CHECK ("kind" = 'system' OR NOT "allow_negative"),
  ADD CONSTRAINT "accounts_code_chk" CHECK (
    ("kind" = 'system') = ("code" IS NOT NULL)
    AND ("code" IS NULL OR "code" ~ '^[a-z0-9][a-z0-9_.:-]{2,63}$')
  );

-- Identity fixed; a closed account does not change at all (not even its balance)
CREATE FUNCTION "ledger"."accounts_guard_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.allow_negative IS DISTINCT FROM OLD.allow_negative
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.status = 'closed' AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*)) THEN
    RAISE EXCEPTION 'accounts: currency, kind, code and allow_negative are fixed; a closed account is final'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "accounts_guard_update"
  BEFORE UPDATE ON "ledger"."accounts"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."accounts_guard_update"();

-- ledger_entries --------------------------------------------------------------
ALTER TABLE "ledger"."ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_non_zero_chk" CHECK ("amount" <> 0),
  ADD CONSTRAINT "ledger_entries_ref_chk" CHECK ("ref" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$');

-- Entry currency = account currency
CREATE FUNCTION "ledger"."ledger_entries_check_currency"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account_currency varchar(10);
BEGIN
  SELECT currency INTO account_currency FROM "ledger"."accounts" WHERE id = NEW.account_id;
  IF account_currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'ledger_entries: entry currency % does not match account currency %',
      NEW.currency, account_currency
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ledger_entries_check_currency"
  BEFORE INSERT ON "ledger"."ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."ledger_entries_check_currency"();

-- At commit: every posting (ref) is in one currency and sums to 0
CREATE FUNCTION "ledger"."ledger_entries_check_balanced"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  total numeric;
  currencies int;
BEGIN
  SELECT sum(amount), count(DISTINCT currency) INTO total, currencies
  FROM "ledger"."ledger_entries" WHERE ref = NEW.ref;
  IF total <> 0 OR currencies <> 1 THEN
    RAISE EXCEPTION 'ledger_entries: posting % is unbalanced (sum %, % currencies)', NEW.ref, total, currencies
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ledger_entries_check_balanced"
  AFTER INSERT ON "ledger"."ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger"."ledger_entries_check_balanced"();

-- Append-only: no privilege for the app, and a trigger for every role (2.1)
REVOKE UPDATE, DELETE, TRUNCATE ON "ledger"."ledger_entries" FROM app_writer;

CREATE FUNCTION "ledger"."ledger_entries_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % is not allowed; post a reversing entry', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "ledger"."ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."ledger_entries_append_only"();

CREATE TRIGGER "ledger_entries_no_truncate"
  BEFORE TRUNCATE ON "ledger"."ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "ledger"."ledger_entries_append_only"();
