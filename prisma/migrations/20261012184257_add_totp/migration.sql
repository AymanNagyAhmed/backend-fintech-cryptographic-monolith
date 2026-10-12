-- AlterTable
ALTER TABLE "auth"."refresh_tokens" ADD COLUMN     "mfa" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "auth"."totp_credentials" (
    "user_id" UUID NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "enabled_at" TIMESTAMPTZ(6),
    "last_step" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "totp_credentials_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "auth"."totp_credentials" ADD CONSTRAINT "totp_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom SQL (Prisma schema cannot express CHECK constraints or triggers)
ALTER TABLE "auth"."totp_credentials"
  ADD CONSTRAINT "totp_credentials_secret_enc_format_chk" CHECK ("secret_enc" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');

-- mfa joins the columns the app may never change
CREATE OR REPLACE FUNCTION "auth"."refresh_tokens_guard_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.mfa IS DISTINCT FROM OLD.mfa
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'refresh_tokens: only used_at and revoked_at may be set, once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- A pending secret may be replaced; once enabled, the secret and enabled_at are fixed
-- (a reset is an admin action run as migrator). last_step only moves forward (no code replay).
CREATE FUNCTION "auth"."totp_credentials_guard_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.enabled_at IS NOT NULL AND (NEW.enabled_at IS DISTINCT FROM OLD.enabled_at
                                         OR NEW.secret_enc IS DISTINCT FROM OLD.secret_enc))
     OR (OLD.last_step IS NOT NULL AND (NEW.last_step IS NULL OR NEW.last_step < OLD.last_step)
         AND NEW.secret_enc IS NOT DISTINCT FROM OLD.secret_enc) THEN
    RAISE EXCEPTION 'totp_credentials: enabled secret is fixed and last_step only increases'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "totp_credentials_guard_update"
  BEFORE UPDATE ON "auth"."totp_credentials"
  FOR EACH ROW EXECUTE FUNCTION "auth"."totp_credentials_guard_update"();
