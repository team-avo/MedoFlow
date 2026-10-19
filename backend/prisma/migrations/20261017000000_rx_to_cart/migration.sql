-- Component 5 — Prescription → Cart (B5.1–B5.5).
--
-- * Product.fulfillmentClass + aliases: the catalog facts the Rx→Cart mapper
--   and the scope guard need. Existing products default to SUPPLEMENT.
-- * RxOrderProposal / RxOrderLine: products the scribe detected in a visit,
--   mapped to the clinic catalog, waiting for provider confirmation.
--   RxOrderLine.rawText is PHI and is sealed by field-level encryption.
-- * CartItem provenance (rxOrderLineId, prescribedByProviderId,
--   patientDecision) and Prescription.status for the e-prescribe queue.
-- * PatientCommerceProfile: Stripe customer, card summary and shipping
--   address on file (saved at booking) for one-click checkout. No card data
--   beyond the Stripe ids, brand and last 4 is stored.
-- CreateEnum
CREATE TYPE "ProductFulfillmentClass" AS ENUM ('SUPPLEMENT', 'OTC', 'AESTHETIC', 'RX_NON_SCHEDULED', 'RX_SCHEDULED');

-- CreateEnum
CREATE TYPE "CartItemPatientDecision" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('DRAFT', 'PENDING_EPRESCRIBE', 'SENT');

-- CreateEnum
CREATE TYPE "RxProposalStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RxMatchStatus" AS ENUM ('MATCHED', 'AMBIGUOUS', 'UNMAPPED');

-- CreateEnum
CREATE TYPE "RxRoute" AS ENUM ('CART', 'EPRESCRIBE', 'MANUAL');

-- CreateEnum
CREATE TYPE "RxLineDecision" AS ENUM ('PENDING', 'CONFIRMED', 'REMOVED');

-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN     "patientDecision" "CartItemPatientDecision",
ADD COLUMN     "prescribedByProviderId" TEXT,
ADD COLUMN     "rxOrderLineId" TEXT;

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "rxOrderLineId" TEXT,
ADD COLUMN     "status" "PrescriptionStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "fulfillmentClass" "ProductFulfillmentClass" NOT NULL DEFAULT 'SUPPLEMENT';

-- CreateTable
CREATE TABLE "RxOrderProposal" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "aiScribeSessionId" TEXT NOT NULL,
    "visitRecordId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "RxProposalStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "cartId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RxOrderProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RxOrderLine" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "matchedProductId" TEXT,
    "matchStatus" "RxMatchStatus" NOT NULL,
    "route" "RxRoute" NOT NULL,
    "decision" "RxLineDecision" NOT NULL DEFAULT 'PENDING',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RxOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientCommerceProfile" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "defaultPaymentMethodId" TEXT,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "cardExpMonth" INTEGER,
    "cardExpYear" INTEGER,
    "shippingName" TEXT,
    "shippingLine1" TEXT,
    "shippingLine2" TEXT,
    "shippingCity" TEXT,
    "shippingState" TEXT,
    "shippingPostalCode" TEXT,
    "shippingCountry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientCommerceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RxOrderProposal_aiScribeSessionId_key" ON "RxOrderProposal"("aiScribeSessionId");

-- CreateIndex
CREATE INDEX "RxOrderProposal_clinicId_idx" ON "RxOrderProposal"("clinicId");

-- CreateIndex
CREATE INDEX "RxOrderProposal_patientId_idx" ON "RxOrderProposal"("patientId");

-- CreateIndex
CREATE INDEX "RxOrderLine_clinicId_idx" ON "RxOrderLine"("clinicId");

-- CreateIndex
CREATE INDEX "RxOrderLine_proposalId_idx" ON "RxOrderLine"("proposalId");

-- CreateIndex
CREATE INDEX "PatientCommerceProfile_clinicId_idx" ON "PatientCommerceProfile"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientCommerceProfile_clinicId_patientId_key" ON "PatientCommerceProfile"("clinicId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_rxOrderLineId_key" ON "CartItem"("rxOrderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_rxOrderLineId_key" ON "Prescription"("rxOrderLineId");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_rxOrderLineId_fkey" FOREIGN KEY ("rxOrderLineId") REFERENCES "RxOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_rxOrderLineId_fkey" FOREIGN KEY ("rxOrderLineId") REFERENCES "RxOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_prescribedByProviderId_fkey" FOREIGN KEY ("prescribedByProviderId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RxOrderProposal" ADD CONSTRAINT "RxOrderProposal_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RxOrderProposal" ADD CONSTRAINT "RxOrderProposal_aiScribeSessionId_fkey" FOREIGN KEY ("aiScribeSessionId") REFERENCES "AIScribeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RxOrderProposal" ADD CONSTRAINT "RxOrderProposal_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RxOrderProposal" ADD CONSTRAINT "RxOrderProposal_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RxOrderLine" ADD CONSTRAINT "RxOrderLine_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RxOrderLine" ADD CONSTRAINT "RxOrderLine_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "RxOrderProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RxOrderLine" ADD CONSTRAINT "RxOrderLine_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCommerceProfile" ADD CONSTRAINT "PatientCommerceProfile_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientCommerceProfile" ADD CONSTRAINT "PatientCommerceProfile_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Row-level security (same policy shape as 20261013020000) ────────────────
ALTER TABLE "RxOrderProposal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "RxOrderProposal"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

ALTER TABLE "RxOrderLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "RxOrderLine"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

ALTER TABLE "PatientCommerceProfile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "PatientCommerceProfile"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Default privileges only cover tables created by the role that set them;
-- grant explicitly so the app role can use the new tables wherever this runs.
GRANT SELECT, INSERT, UPDATE, DELETE ON "RxOrderProposal", "RxOrderLine", "PatientCommerceProfile" TO medoflow_app;
