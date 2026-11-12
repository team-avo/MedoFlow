-- CTO-26: the clinic address goes live on Cloudflare Pages from Publish.
CREATE TABLE "SiteLaunch" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "deploymentId" TEXT,
    "url" TEXT,
    "liveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteLaunch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteLaunch_clinicId_key" ON "SiteLaunch"("clinicId");

ALTER TABLE "SiteLaunch" ADD CONSTRAINT "SiteLaunch_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteLaunch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "SiteLaunch"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

GRANT SELECT, INSERT, UPDATE, DELETE ON "SiteLaunch" TO medoflow_app;
