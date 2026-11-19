-- CTO-38: guided custom-domain connect (stages, detected DNS provider, per-record checks).
-- Additive only; the table keeps its RLS policy and grants.
ALTER TABLE "SiteDomain" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'dns';
ALTER TABLE "SiteDomain" ADD COLUMN "dnsProvider" TEXT;
ALTER TABLE "SiteDomain" ADD COLUMN "zone" TEXT;
ALTER TABLE "SiteDomain" ADD COLUMN "checks" JSONB;
ALTER TABLE "SiteDomain" ADD COLUMN "liveAt" TIMESTAMP(3);
ALTER TABLE "SiteDomain" ADD COLUMN "lastRetryAt" TIMESTAMP(3);

-- Existing rows: subdomains and verified custom domains are already serving.
UPDATE "SiteDomain" SET "stage" = 'live' WHERE "kind" = 'SUBDOMAIN';
UPDATE "SiteDomain" SET "stage" = 'verified' WHERE "kind" = 'CUSTOM' AND "status" = 'VERIFIED';

CREATE INDEX "SiteDomain_kind_stage_idx" ON "SiteDomain"("kind", "stage");
