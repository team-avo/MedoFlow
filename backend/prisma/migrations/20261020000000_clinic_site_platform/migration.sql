-- Component 8 (B8.1–B8.8): clinic website platform — themes/templates (Site),
-- host routing (SiteDomain), public images (SiteAsset), publish history
-- (SitePageRevision), URL redirects (SiteRedirect), contact-form leads
-- (SiteLead, PHI: sealed by field-level encryption), and URL slugs for
-- services, providers and products.

-- CreateEnum
CREATE TYPE "SitePageKind" AS ENUM ('HOME', 'STANDARD', 'SERVICES', 'TEAM', 'CONTACT', 'LEGAL');

-- CreateEnum
CREATE TYPE "SiteDomainKind" AS ENUM ('SUBDOMAIN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SiteDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "SiteAssetStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REJECTED');

-- CreateEnum
CREATE TYPE "SiteLeadStatus" AS ENUM ('NEW', 'READ', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "SitePage" ADD COLUMN     "draftSeoDescription" TEXT,
ADD COLUMN     "draftSeoTitle" TEXT,
ADD COLUMN     "draftTitle" TEXT,
ADD COLUMN     "kind" "SitePageKind" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "navOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "noindex" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ogImageAssetId" TEXT,
ADD COLUMN     "showInNav" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "templateKey" TEXT,
    "settingsDraftJson" JSONB NOT NULL DEFAULT '{}',
    "settingsPublishedJson" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDomain" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "kind" "SiteDomainKind" NOT NULL,
    "status" "SiteDomainStatus" NOT NULL DEFAULT 'PENDING',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verifyToken" TEXT,
    "providerRef" TEXT,
    "sslStatus" TEXT,
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteAsset" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "alt" TEXT NOT NULL DEFAULT '',
    "status" "SiteAssetStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePageRevision" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "sectionsJson" JSONB NOT NULL,
    "metaJson" JSONB NOT NULL DEFAULT '{}',
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitePageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteRedirect" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "code" INTEGER NOT NULL DEFAULT 301,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteRedirect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteLead" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT NOT NULL,
    "sourcePath" TEXT,
    "status" "SiteLeadStatus" NOT NULL DEFAULT 'NEW',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteLead_pkey" PRIMARY KEY ("id")
);

-- Backfill URL slugs before the unique indexes are built: slugify the name;
-- a duplicate within a clinic gets a short stable suffix from the row id.
CREATE OR REPLACE FUNCTION pg_temp.mf_slugify(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(nullif(left(trim(both '-' from regexp_replace(lower(t), '[^a-z0-9]+', '-', 'g')), 60), ''), 'item')
$$;
UPDATE "Service" t SET "slug" = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || '-' || substr(md5(t.id), 1, 6) END
FROM (SELECT id, pg_temp.mf_slugify("name") AS base, row_number() OVER (PARTITION BY "clinicId", pg_temp.mf_slugify("name") ORDER BY "createdAt", id) AS rn FROM "Service") r
WHERE t.id = r.id;

UPDATE "Product" t SET "slug" = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || '-' || substr(md5(t.id), 1, 6) END
FROM (SELECT id, pg_temp.mf_slugify("name") AS base, row_number() OVER (PARTITION BY "clinicId", pg_temp.mf_slugify("name") ORDER BY "createdAt", id) AS rn FROM "Product") r
WHERE t.id = r.id;

UPDATE "Provider" t SET "slug" = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || '-' || substr(md5(t.id), 1, 6) END
FROM (SELECT id, pg_temp.mf_slugify("firstName" || ' ' || "lastName") AS base, row_number() OVER (PARTITION BY "clinicId", pg_temp.mf_slugify("firstName" || ' ' || "lastName") ORDER BY "createdAt", id) AS rn FROM "Provider") r
WHERE t.id = r.id;

-- CreateIndex
CREATE UNIQUE INDEX "Site_clinicId_key" ON "Site"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteDomain_hostname_key" ON "SiteDomain"("hostname");

-- CreateIndex
CREATE INDEX "SiteDomain_clinicId_idx" ON "SiteDomain"("clinicId");

-- CreateIndex
CREATE INDEX "SiteAsset_clinicId_status_idx" ON "SiteAsset"("clinicId", "status");

-- CreateIndex
CREATE INDEX "SitePageRevision_clinicId_idx" ON "SitePageRevision"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "SitePageRevision_pageId_version_key" ON "SitePageRevision"("pageId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SiteRedirect_clinicId_fromPath_key" ON "SiteRedirect"("clinicId", "fromPath");

-- CreateIndex
CREATE INDEX "SiteLead_clinicId_status_createdAt_idx" ON "SiteLead"("clinicId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_clinicId_slug_key" ON "Product"("clinicId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_clinicId_slug_key" ON "Provider"("clinicId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Service_clinicId_slug_key" ON "Service"("clinicId", "slug");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDomain" ADD CONSTRAINT "SiteDomain_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAsset" ADD CONSTRAINT "SiteAsset_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePageRevision" ADD CONSTRAINT "SitePageRevision_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePageRevision" ADD CONSTRAINT "SitePageRevision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "SitePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteRedirect" ADD CONSTRAINT "SiteRedirect_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteLead" ADD CONSTRAINT "SiteLead_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing pages: "home" is the HOME page; the editor's draft metadata starts
-- equal to the live copy; already-published pages are at version 1.
UPDATE "SitePage" SET "kind" = 'HOME' WHERE "slug" = 'home';
UPDATE "SitePage" SET "draftTitle" = "title", "draftSeoTitle" = "seoTitle",
  "draftSeoDescription" = "seoDescription";
UPDATE "SitePage" SET "version" = 1 WHERE "status" = 'PUBLISHED';

-- Every clinic gets a default subdomain. SUBDOMAIN rows store the DNS label
-- only ("everwell"), so the same row serves everwell.<SITE_ROOT_DOMAIN> in
-- every environment. A tenant's first clinic takes the signup subdomain;
-- others fall back to their clinic slug when it is a valid DNS label.
INSERT INTO "SiteDomain" ("id", "clinicId", "hostname", "kind", "status", "isPrimary", "verifiedAt", "updatedAt")
SELECT 'sd' || substr(md5(c.id || b.subdomain), 1, 23), c.id, b.subdomain, 'SUBDOMAIN', 'VERIFIED', true, now(), now()
FROM "Brand" b
JOIN LATERAL (
  SELECT id FROM "Clinic" WHERE "tenantId" = b."tenantId" ORDER BY "createdAt", id LIMIT 1
) c ON true
WHERE b.subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
ON CONFLICT ("hostname") DO NOTHING;

INSERT INTO "SiteDomain" ("id", "clinicId", "hostname", "kind", "status", "isPrimary", "verifiedAt", "updatedAt")
SELECT 'sd' || substr(md5(c.id || c.slug), 1, 23), c.id, c.slug, 'SUBDOMAIN', 'VERIFIED', true, now(), now()
FROM "Clinic" c
WHERE c.slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
  AND NOT EXISTS (SELECT 1 FROM "SiteDomain" d WHERE d."clinicId" = c.id)
ON CONFLICT ("hostname") DO NOTHING;

-- Row-level security: every new table is clinic-scoped (same policy as
-- SitePage, migration 20261013020000).
ALTER TABLE "Site" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Site"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

ALTER TABLE "SiteDomain" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "SiteDomain"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

ALTER TABLE "SiteAsset" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "SiteAsset"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

ALTER TABLE "SitePageRevision" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "SitePageRevision"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

ALTER TABLE "SiteRedirect" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "SiteRedirect"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

ALTER TABLE "SiteLead" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "SiteLead"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

GRANT SELECT, INSERT, UPDATE, DELETE ON "Site", "SiteDomain", "SiteAsset", "SitePageRevision", "SiteRedirect", "SiteLead" TO medoflow_app;
