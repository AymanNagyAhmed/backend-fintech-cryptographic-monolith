-- CreateTable
CREATE TABLE "crypto"."signing_keys" (
    "key_id" VARCHAR(96) NOT NULL,
    "version" INTEGER NOT NULL,
    "alg" VARCHAR(32) NOT NULL,
    "public_key" TEXT NOT NULL,
    "activated_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "signing_keys_pkey" PRIMARY KEY ("key_id")
);

-- CreateIndex
CREATE INDEX "signing_keys_activated_at_idx" ON "crypto"."signing_keys"("activated_at");

-- Custom SQL (Prisma schema cannot express CHECK constraints, triggers or REVOKE)

-- key_id is `<keyRef>:v<version>` (key-id.ts); version must match the suffix; alg is one of
-- the registered signing algorithms; public_key is standard base64 of an SPKI DER public key
-- (never a private key). revoked_at is null or at/after activated_at.
ALTER TABLE "crypto"."signing_keys"
  ADD CONSTRAINT "signing_keys_key_id_chk" CHECK (
    "key_id" ~ '^[a-z0-9][a-z0-9_-]{0,63}:v[1-9][0-9]{0,8}$'
  ),
  ADD CONSTRAINT "signing_keys_version_chk" CHECK (
    "version" BETWEEN 1 AND 999999999
    AND "key_id" = regexp_replace("key_id", ':v[1-9][0-9]{0,8}$', '') || ':v' || "version"::text
  ),
  ADD CONSTRAINT "signing_keys_alg_chk" CHECK (
    "alg" IN ('ed25519', 'ecdsa-p256', 'ml-dsa-65')
  ),
  ADD CONSTRAINT "signing_keys_public_key_chk" CHECK (
    "public_key" ~ '^[A-Za-z0-9+/]+=*$'
    AND length("public_key") BETWEEN 44 AND 8192
  ),
  ADD CONSTRAINT "signing_keys_revoked_at_chk" CHECK (
    "revoked_at" IS NULL OR "revoked_at" >= "activated_at"
  );

-- A published key is fixed; the only change is setting revoked_at once
CREATE FUNCTION "crypto"."signing_keys_guard_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key_id IS DISTINCT FROM OLD.key_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.alg IS DISTINCT FROM OLD.alg
     OR NEW.public_key IS DISTINCT FROM OLD.public_key
     OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
     OR OLD.revoked_at IS NOT NULL
     OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'signing_keys: the key is fixed; only an active key can be revoked, once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "signing_keys_guard_update"
  BEFORE UPDATE ON "crypto"."signing_keys"
  FOR EACH ROW EXECUTE FUNCTION "crypto"."signing_keys_guard_update"();

CREATE FUNCTION "crypto"."signing_keys_no_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'signing_keys is append-only (revoke instead of delete)'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "signing_keys_no_delete"
  BEFORE DELETE ON "crypto"."signing_keys"
  FOR EACH ROW EXECUTE FUNCTION "crypto"."signing_keys_no_delete"();

CREATE TRIGGER "signing_keys_no_truncate"
  BEFORE TRUNCATE ON "crypto"."signing_keys"
  FOR EACH STATEMENT EXECUTE FUNCTION "crypto"."signing_keys_no_delete"();

-- Application inserts and revokes; never deletes. Private key material is never stored here.
REVOKE DELETE, TRUNCATE ON "crypto"."signing_keys" FROM app_writer;

-- Offline verifiers and auditors may read published public keys directly in the database
GRANT USAGE ON SCHEMA crypto TO auditor_ro;
GRANT SELECT ON "crypto"."signing_keys" TO auditor_ro;
