-- CTO-40: product catalog import (Shopify, Square, WooCommerce, Wix, CSV/XLSX).
-- Additive only: new nullable Product columns and three clinic-scoped tables,
-- each with the clinic RLS policy and app grants.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT,
ADD COLUMN     "externalSyncedAt" TIMESTAMP(3),
ADD COLUMN     "imageAssetId" TEXT,
ADD COLUMN     "imageSourceUrl" TEXT,
ADD COLUMN     "storeConnectionId" TEXT;

-- CreateTable
CREATE TABLE "StoreConnection" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "apiKeyId" TEXT,
    "scopes" TEXT NOT NULL DEFAULT '',
    "connectedById" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogImport" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "preset" TEXT,
    "storeConnectionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'FETCHING',
    "columnMapping" JSONB,
    "options" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameOverride" TEXT,
    "sku" TEXT,
    "price" DECIMAL(10,2),
    "description" TEXT,
    "imageSourceUrl" TEXT,
    "stock" INTEGER,
    "sourceCategory" TEXT,
    "suggestedClass" "ProductFulfillmentClass",
    "chosenClass" "ProductFulfillmentClass",
    "rxLike" BOOLEAN NOT NULL DEFAULT false,
    "action" TEXT NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "matchedProductId" TEXT,
    "matchedBy" TEXT,
    "diff" JSONB,
    "error" TEXT,
    "appliedProductId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreConnection_clinicId_idx" ON "StoreConnection"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreConnection_clinicId_provider_externalAccountId_key" ON "StoreConnection"("clinicId", "provider", "externalAccountId");

-- CreateIndex
CREATE INDEX "CatalogImport_clinicId_createdAt_idx" ON "CatalogImport"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogImportRow_importId_position_idx" ON "CatalogImportRow"("importId", "position");

-- CreateIndex
CREATE INDEX "CatalogImportRow_clinicId_idx" ON "CatalogImportRow"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_clinicId_externalSource_externalId_key" ON "Product"("clinicId", "externalSource", "externalId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_storeConnectionId_fkey" FOREIGN KEY ("storeConnectionId") REFERENCES "StoreConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreConnection" ADD CONSTRAINT "StoreConnection_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogImport" ADD CONSTRAINT "CatalogImport_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogImport" ADD CONSTRAINT "CatalogImport_storeConnectionId_fkey" FOREIGN KEY ("storeConnectionId") REFERENCES "StoreConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogImportRow" ADD CONSTRAINT "CatalogImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "CatalogImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "StoreConnection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "StoreConnection"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));
GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreConnection" TO medoflow_app;

ALTER TABLE "CatalogImport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "CatalogImport"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));
GRANT SELECT, INSERT, UPDATE, DELETE ON "CatalogImport" TO medoflow_app;

ALTER TABLE "CatalogImportRow" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "CatalogImportRow"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));
GRANT SELECT, INSERT, UPDATE, DELETE ON "CatalogImportRow" TO medoflow_app;
