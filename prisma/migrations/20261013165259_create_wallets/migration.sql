-- CreateEnum
CREATE TYPE "wallet"."wallet_status" AS ENUM ('active', 'frozen', 'closed');

-- CreateTable
CREATE TABLE "wallet"."wallets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_user_id" UUID NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "status" "wallet"."wallet_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_ledger_account_id_key" ON "wallet"."wallets"("ledger_account_id");

-- CreateIndex
CREATE INDEX "wallets_owner_user_id_id_idx" ON "wallet"."wallets"("owner_user_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_owner_user_id_currency_key" ON "wallet"."wallets"("owner_user_id", "currency");

-- Custom SQL (Prisma schema cannot express CHECK constraints or triggers)
-- Same list as CURRENCY_SCALE in src/common/money/currency.ts (a test compares them)
ALTER TABLE "wallet"."wallets"
  ADD CONSTRAINT "wallets_currency_chk" CHECK ("currency" IN ('AED', 'USD', 'EUR', 'BTC'));

-- Owner, currency and ledger account are fixed; closed is final
CREATE FUNCTION "wallet"."wallets_guard_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.ledger_account_id IS DISTINCT FROM OLD.ledger_account_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.status = 'closed' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'wallets: owner, currency and ledger account are fixed; a closed wallet stays closed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "wallets_guard_update"
  BEFORE UPDATE ON "wallet"."wallets"
  FOR EACH ROW EXECUTE FUNCTION "wallet"."wallets_guard_update"();
