-- B3.1: patient files are uploaded straight to object storage through a
-- presigned URL. A row starts PENDING and becomes AVAILABLE only after the
-- API has verified the stored object's size and content type. Existing rows
-- were written by the old in-process upload and are already verified.
CREATE TYPE "PatientFileStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REJECTED');

ALTER TABLE "PatientFile"
  ADD COLUMN "status" "PatientFileStatus" NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN "uploadedAt" TIMESTAMP(3);

UPDATE "PatientFile" SET "uploadedAt" = "createdAt" WHERE "uploadedAt" IS NULL;

CREATE INDEX "PatientFile_status_createdAt_idx" ON "PatientFile"("status", "createdAt");
