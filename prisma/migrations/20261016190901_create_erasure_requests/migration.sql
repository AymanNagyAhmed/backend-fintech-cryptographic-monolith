-- CreateTable
CREATE TABLE "privacy"."erasure_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "subject_ref" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "approver_id" UUID,
    "status" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "erasure_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "erasure_requests_subject_ref_status_idx" ON "privacy"."erasure_requests"("subject_ref", "status");

ALTER TABLE "privacy"."erasure_requests"
  ADD CONSTRAINT "erasure_requests_status_chk" CHECK (
    "status" IN ('pending', 'completed', 'cancelled')
  );

GRANT SELECT, INSERT, UPDATE ON "privacy"."erasure_requests" TO app_writer;
GRANT SELECT ON "privacy"."erasure_requests" TO auditor_ro;
REVOKE DELETE, TRUNCATE ON "privacy"."erasure_requests" FROM app_writer;
