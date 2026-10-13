-- CreateEnum
CREATE TYPE "auth"."api_signing_algorithm" AS ENUM ('hmac_sha256', 'ed25519');

-- CreateTable
CREATE TABLE "auth"."api_clients" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "client_id" VARCHAR(63) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "algorithm" "auth"."api_signing_algorithm" NOT NULL,
    "secret_enc" TEXT,
    "public_key" VARCHAR(43),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_client_id_key" ON "auth"."api_clients"("client_id");

-- Custom SQL (Prisma schema cannot express CHECK constraints or triggers)
ALTER TABLE "auth"."api_clients"
  ADD CONSTRAINT "api_clients_client_id_format_chk" CHECK ("client_id" ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  ADD CONSTRAINT "api_clients_name_chk" CHECK (length(btrim("name")) > 0),
  -- exactly the key material of the algorithm
  ADD CONSTRAINT "api_clients_key_chk" CHECK (
    ("algorithm" = 'hmac_sha256'
       AND "public_key" IS NULL
       AND "secret_enc" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
    OR ("algorithm" = 'ed25519'
       AND "secret_enc" IS NULL
       AND "public_key" ~ '^[A-Za-z0-9_-]{43}$')
  );

-- A key change is a new client; the app may only rename or revoke (once)
CREATE FUNCTION "auth"."api_clients_guard_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.algorithm IS DISTINCT FROM OLD.algorithm
     OR NEW.secret_enc IS DISTINCT FROM OLD.secret_enc
     OR NEW.public_key IS DISTINCT FROM OLD.public_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'api_clients: identity and key are fixed; revoked_at may be set once'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "api_clients_guard_update"
  BEFORE UPDATE ON "auth"."api_clients"
  FOR EACH ROW EXECUTE FUNCTION "auth"."api_clients_guard_update"();
