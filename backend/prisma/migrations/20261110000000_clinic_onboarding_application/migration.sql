-- Clinic onboarding: practice application, signed agreement and admin review.
--
-- * Tenant.verificationStatus gates go-live (public site, booking, intake).
-- * ClinicProfile holds the practice application (one per clinic).
-- * ClinicAgreement is the append-only record of each signed agreement.
-- * Provider gains NPI, license state and credentials.

-- CreateEnum
CREATE TYPE "ClinicVerificationStatus" AS ENUM ('PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "reviewNotes" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "submittedForReviewAt" TIMESTAMP(3),
ADD COLUMN     "verificationStatus" "ClinicVerificationStatus" NOT NULL DEFAULT 'APPROVED';

-- Every clinic that exists today is already live: keep it that way. Only
-- clinics that sign up from now on start in review.
ALTER TABLE "Tenant" ALTER COLUMN "verificationStatus" SET DEFAULT 'PENDING_REVIEW';

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "credentials" TEXT,
ADD COLUMN     "licenseState" TEXT,
ADD COLUMN     "npi" TEXT;

-- CreateTable
CREATE TABLE "ClinicProfile" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "dbaName" TEXT,
    "practiceType" TEXT NOT NULL,
    "locationCount" INTEGER NOT NULL DEFAULT 1,
    "officePhone" TEXT,
    "fax" TEXT,
    "website" TEXT,
    "primaryContactName" TEXT NOT NULL,
    "primaryContactEmail" TEXT NOT NULL,
    "primaryContactPhone" TEXT,
    "officeManagerName" TEXT,
    "officeManagerEmail" TEXT,
    "accountsPayableName" TEXT,
    "accountsPayableEmail" TEXT,
    "mailingSameAsPrimary" BOOLEAN NOT NULL DEFAULT true,
    "mailingAddressLine1" TEXT,
    "mailingAddressLine2" TEXT,
    "mailingCity" TEXT,
    "mailingState" TEXT,
    "mailingPostalCode" TEXT,
    "groupNpi" TEXT,
    "noNpi" BOOLEAN NOT NULL DEFAULT false,
    "federalTaxId" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "licenseState" TEXT,
    "deaNumber" TEXT,
    "estimatedSeats" INTEGER NOT NULL DEFAULT 1,
    "referralSource" TEXT,
    "salesRep" TEXT,
    "practitioners" JSONB NOT NULL DEFAULT '[]',
    "practiceCompletedAt" TIMESTAMP(3),
    "practitionersCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicAgreement" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "signerUserId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerTitle" TEXT NOT NULL,
    "signatureText" TEXT NOT NULL,
    "acknowledgements" JSONB NOT NULL,
    "communicationsConsent" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicProfile_clinicId_key" ON "ClinicProfile"("clinicId");

-- CreateIndex
CREATE INDEX "ClinicAgreement_clinicId_acceptedAt_idx" ON "ClinicAgreement"("clinicId", "acceptedAt");

-- CreateIndex
CREATE INDEX "Tenant_verificationStatus_idx" ON "Tenant"("verificationStatus");

-- AddForeignKey
ALTER TABLE "ClinicProfile" ADD CONSTRAINT "ClinicProfile_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicAgreement" ADD CONSTRAINT "ClinicAgreement_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Row-level security (same policy shape as 20261013020000) ────────────────
ALTER TABLE "ClinicProfile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "ClinicProfile"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

ALTER TABLE "ClinicAgreement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "ClinicAgreement"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Default privileges only cover tables created by the role that set them;
-- grant explicitly so the app role can use the new tables wherever this runs.
GRANT SELECT, INSERT, UPDATE, DELETE ON "ClinicProfile" TO medoflow_app;
-- Signed agreements are evidence: the app role may add them, never change them.
GRANT SELECT, INSERT ON "ClinicAgreement" TO medoflow_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "ClinicAgreement" FROM medoflow_app;
