-- CTO-32: MedoFlow-hosted checkout links for clinics without a website.
-- Only a SHA-256 hash of the token is stored.
CREATE TABLE "CheckoutLinkToken" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutLinkToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutLinkToken_tokenHash_key" ON "CheckoutLinkToken"("tokenHash");
CREATE INDEX "CheckoutLinkToken_clinicId_idx" ON "CheckoutLinkToken"("clinicId");
CREATE INDEX "CheckoutLinkToken_cartId_idx" ON "CheckoutLinkToken"("cartId");

ALTER TABLE "CheckoutLinkToken" ADD CONSTRAINT "CheckoutLinkToken_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CheckoutLinkToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "CheckoutLinkToken"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

GRANT SELECT, INSERT, UPDATE, DELETE ON "CheckoutLinkToken" TO medoflow_app;
