-- CreateTable
CREATE TABLE "auth"."refresh_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "auth"."refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "auth"."refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "auth"."refresh_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "auth"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom SQL (Prisma schema cannot express CHECK constraints or triggers)
-- Hex HMAC-SHA256, never the token itself
ALTER TABLE "auth"."refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_token_hash_hex_chk" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "auth"."refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_expiry_chk" CHECK ("expires_at" > "created_at");

-- The app may only mark a token used or revoked, once: no re-enabling, no changing who or what it is
CREATE FUNCTION "auth"."refresh_tokens_guard_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'refresh_tokens: only used_at and revoked_at may be set, once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "refresh_tokens_guard_update"
  BEFORE UPDATE ON "auth"."refresh_tokens"
  FOR EACH ROW EXECUTE FUNCTION "auth"."refresh_tokens_guard_update"();
