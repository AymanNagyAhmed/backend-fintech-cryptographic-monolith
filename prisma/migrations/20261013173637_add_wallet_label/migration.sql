-- AlterTable
ALTER TABLE "wallet"."wallets" ADD COLUMN     "label" VARCHAR(50);

-- Custom SQL (Prisma schema cannot express CHECK constraints or triggers)
-- Same rules as normalizeWalletLabel in src/modules/wallets/wallet-label.ts:
-- 1-50 characters, no C0 / DEL / C1 control characters, and no leading or trailing whitespace
-- as String.prototype.trim sees it (listed explicitly: [[:space:]] depends on the locale)
ALTER TABLE "wallet"."wallets"
  ADD CONSTRAINT "wallets_label_chk" CHECK (
    "label" IS NULL OR (
      char_length("label") BETWEEN 1 AND 50
      AND "label" !~ '[\u0001-\u001F\u007F-\u009F]'
      AND "label" !~ '^[ \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'
      AND "label" !~ '[ \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]$'
    )
  );

-- Owner, currency and ledger account are fixed; closed is final and a closed wallet keeps its label
CREATE OR REPLACE FUNCTION "wallet"."wallets_guard_update"() RETURNS trigger
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
  IF OLD.status = 'closed' AND NEW.label IS DISTINCT FROM OLD.label THEN
    RAISE EXCEPTION 'wallets: a closed wallet cannot be renamed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
