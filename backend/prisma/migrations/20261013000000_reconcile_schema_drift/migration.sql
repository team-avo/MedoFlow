-- Reconcile schema drift (B0.5 CI prerequisite).
--
-- Some earlier changes reached the live databases via `prisma db push` and
-- never got a migration, so a database built from migrations alone did not
-- match schema.prisma (missing Appointment.aiScribeConsentGrantedAt, FK
-- actions, defaults, one index). CI builds its test database from
-- migrations, so this closes the gap.
--
-- Every statement is idempotent: on databases that already have these
-- objects (Neon, the demo dump) it is a no-op in effect.

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "aiScribeConsentGrantedAt" TIMESTAMP(3);

ALTER TABLE "Brand" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ScribeTemplate" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "SitePage" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Tenant" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE INDEX IF NOT EXISTS "Tenant_slug_idx" ON "Tenant"("slug");

ALTER TABLE "Brand" DROP CONSTRAINT IF EXISTS "Brand_tenantId_fkey";
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Clinic" DROP CONSTRAINT IF EXISTS "Clinic_tenantId_fkey";
ALTER TABLE "Clinic" ADD CONSTRAINT "Clinic_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SitePage" DROP CONSTRAINT IF EXISTS "SitePage_clinicId_fkey";
ALTER TABLE "SitePage" ADD CONSTRAINT "SitePage_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Provider" DROP CONSTRAINT IF EXISTS "Provider_scribeTemplateId_fkey";
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_scribeTemplateId_fkey" FOREIGN KEY ("scribeTemplateId") REFERENCES "ScribeTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ScribeTemplate" DROP CONSTRAINT IF EXISTS "ScribeTemplate_clinicId_fkey";
ALTER TABLE "ScribeTemplate" ADD CONSTRAINT "ScribeTemplate_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
