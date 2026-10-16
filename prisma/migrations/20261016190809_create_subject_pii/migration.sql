-- CreateTable
CREATE TABLE "privacy"."subject_pii" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "subject_ref" UUID NOT NULL,
    "field" VARCHAR(64) NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "ciphertext_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subject_pii_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subject_pii_ciphertext_hash_idx" ON "privacy"."subject_pii"("ciphertext_hash");

-- CreateIndex
CREATE UNIQUE INDEX "subject_pii_subject_ref_field_key" ON "privacy"."subject_pii"("subject_ref", "field");

GRANT SELECT, INSERT, UPDATE ON "privacy"."subject_pii" TO app_writer;
GRANT SELECT ON "privacy"."subject_pii" TO auditor_ro;
REVOKE DELETE, TRUNCATE ON "privacy"."subject_pii" FROM app_writer;
