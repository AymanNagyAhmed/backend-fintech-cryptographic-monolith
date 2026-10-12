-- CreateEnum
CREATE TYPE "auth"."user_role" AS ENUM ('user', 'approver', 'compliance', 'admin');

-- CreateEnum
CREATE TYPE "auth"."user_status" AS ENUM ('active', 'locked', 'disabled');

-- CreateTable
CREATE TABLE "auth"."users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "auth"."user_status" NOT NULL DEFAULT 'active',
    "roles" "auth"."user_role"[] DEFAULT ARRAY['user']::"auth"."user_role"[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "auth"."users"("email");

-- Custom SQL (Prisma schema cannot express CHECK constraints)
-- Lowercased and trimmed, so users_email_key is case-insensitive
ALTER TABLE "auth"."users"
  ADD CONSTRAINT "users_email_normalized_chk" CHECK ("email" = lower(btrim("email")));

-- Prisma keeps list columns nullable; every user has at least one role
ALTER TABLE "auth"."users"
  ADD CONSTRAINT "users_roles_not_empty_chk" CHECK ("roles" IS NOT NULL AND cardinality("roles") >= 1);

-- Only argon2id PHC strings, never a plaintext or another algorithm's hash
ALTER TABLE "auth"."users"
  ADD CONSTRAINT "users_password_hash_argon2id_chk" CHECK ("password_hash" LIKE '$argon2id$v=19$%');
