# CTO-40 · Product catalog import (Shopify, Square, WooCommerce, Wix, CSV / Excel): walkthrough and verification

- **Branch:** `feat/cto-40-catalog-import`, cut from `development` at `b7bfc50` (CTO-39 merged)
- **Date:** 2026-11-18
- **Decision record:** `docs/adr/0008-product-catalog-import.md`
- **Task:** `arh-agent-docs/cto-feedback-tasks.md` § CTO-40, with AC5–AC7 added for the wider scope

## 1. Outcome

A clinic can bring the products it already sells into the MedoFlow Storefront without re-typing them. It can import from four sources:

- **Live store connections:** Shopify, Square, WooCommerce and Wix.
- **A file (CSV or .xlsx):** each platform's own product export, or any other spreadsheet through a generic column mapping. That covers marketplace seller sheets such as Tata 1mg, med-spa software exports and distributor price lists.

Every import is a dry run first. The owner sees what would be created, updated or left alone, resolves conflicts, and chooses a class for each product (or accepts the suggested classes). Nothing is written until they press Import.

Imported products arrive **UNCLASSIFIED** unless someone chose a class. An unclassified product:

- is refused by the cart;
- is left off the public storefront;
- is routed to MANUAL by Rx to Cart.

So nothing imported can be sold by accident, and a prescription item can never reach the one-click cart.

A re-sync of the same store is idempotent: rows match by external id and come back UNCHANGED. It updates price, stock and photo, and never touches the clinic's own name or class.

| AC                                                                                                              | Status                                                                       |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| AC1: connect Shopify or Wix, import name, SKU, price, image and stock with field mapping and a dry run          | ✅ code and tests; real-store run pending (§6)                               |
| AC2: re-sync is idempotent by external id; Rx-like items arrive unclassified and must be classified before sale | ✅ (`UNCLASSIFIED` class, integration-tested)                                |
| AC3: Rx to Cart maps imported products                                                                          | ✅ (`rxMapping.test.ts` plus the integration test)                           |
| AC4: tokens encrypted; disconnect removes them                                                                  | ✅ (`fle:v1` in the raw row; wiped on disconnect; Shopify uninstall webhook) |
| AC5 (new): Square and WooCommerce                                                                               | ✅ code and tests; real-store run pending                                    |
| AC6 (new): CSV and .xlsx with per-platform presets plus generic mapping (Tata 1mg style)                        | ✅                                                                           |
| AC7 (new): photos re-hosted through an SSRF-safe fetch; private addresses refused                               | ✅                                                                           |

## 2. Research and scope

The full table is in ADR 0008. In short:

- **Wix** stays: it is second in the US by number of stores.
- **Square** is added for front-desk retail.
- **WooCommerce** is added because it needs no app review.
- **Med-spa systems** (Boulevard, Zenoti, Vagaro, Mangomint) have partner-gated APIs, so they go through file import.
- **Fullscript** is a different integration (a dispensary, not stock the clinic holds) and needs its own task.
- **Tata 1mg, PharmEasy and Netmeds** have no public seller catalog API, so they go through file import now. Live connectors belong to CTO-43.

## 3. What changed (files)

### 3.1 Backend

**Database**

- **Migration `20261118000000_product_unclassified_class`:** `ALTER TYPE ... ADD VALUE 'UNCLASSIFIED'`. It is in its own migration because a new enum value can't be used in the transaction that adds it.
- **Migration `20261118000100_catalog_import`:**
  - new nullable `Product` columns: `imageAssetId`, `imageSourceUrl`, `externalSource`, `externalId`, `storeConnectionId`, `externalSyncedAt`;
  - a unique key on `(clinicId, externalSource, externalId)`;
  - new tables `StoreConnection`, `CatalogImport` and `CatalogImportRow`, each with the clinic RLS policy and app grants.
  - Additive only.

**Wiring**

- `config/prisma.ts`: the three tables added to `CLINIC_SCOPED_MODELS`.
- `utils/fieldCrypto.ts`: `StoreConnection.accessToken` and `refreshToken` encrypted (`fle:v1`).

**Sale gate (B5.5)**

- `rxMappingService.ts`: `isUnclassified`, `SELLABLE_CLASSES`, and `routeFor(UNCLASSIFIED)` returns `MANUAL`.
- `cartService.ts`: add-item and checkout reject unclassified products with 422 `PRODUCT_UNCLASSIFIED`.
- `site/services/renderService.ts` and `controllers/publicController.ts`: public storefronts show `SELLABLE_CLASSES` only. Public products now carry `imageUrl`.
- `productService.getProducts` returns `imageUrl`.

**Import pipeline: `services/catalogImport/`**

- `types.ts`: the normalized item, and price, stock and HTML-to-text helpers.
- `csv.ts`: an RFC 4180 reader (BOM; comma, semicolon or tab delimiters).
- `xlsx.ts`: a dependency-free .xlsx reader (ZIP plus XML through zlib, with per-part size caps).
- `presets.ts`: presets for the Shopify, Wix, Square and WooCommerce exports, plus generic mapping with header guessing.
- `classify.ts`: suggested classes. Rx-like items never get a suggestion.
- `staging.ts`: the pure dry run. Matches by external id, then SKU, then name, and works out conflicts and diffs.
- `safeHttp.ts`: the SSRF-guarded HTTPS client.
- `imageImport.ts`: re-hosts photos as `SiteAsset`s (`assetService.createAssetFromBytes`).
- `service.ts`: the jobs (fetch and apply), the `catalog-import` BullMQ queue with in-process fallback, and the public API.

**Store connections: `services/storeConnections/`**

- `state.ts`: the HMAC-signed OAuth state.
- `http.ts`: the provider fetch, with timeouts and retries on 429 and 5xx.
- One file per provider: `shopify.ts`, `square.ts`, `wooCommerce.ts`, `wix.ts`.
- `index.ts`: connect, complete, the WooCommerce key callback, disconnect with revoke, and the Shopify webhook handler.

**Routes**

- `routes/storeConnections.ts` (`/store-connections`), including the public WooCommerce key callback.
- `routes/catalogImports.ts` (`/catalog-imports`), with multipart upload through multer.
- `routes/webhooks.ts`: `POST /webhooks/shopify`, with an HMAC check on the raw body. `app.ts` skips the JSON parser for that path.

**Server and config**

- `server.ts`: starts and stops the import worker.
- `config/envValidation.ts`: warns on half-set Shopify or Square credentials and on a bad `SQUARE_ENV`.
- `config/usageFeatures.ts`: `catalog.store_connected` and `catalog.import_applied` (CTO-39 usage).
- `render.yaml` and `.env.example`: the new env vars, with the redirect and webhook URLs to register.

### 3.2 Frontend

- `app/dashboard/products/import/page.tsx`: the wizard. Source → preview → importing → done or failed (with Retry). The import id is kept in `?id=`.
- `components/catalogImport/SourcePicker.tsx`:
  - connected stores;
  - a connect card for each provider (OAuth redirect or key paste, with a "not set up on this server" state);
  - file upload with a preset picker.
- `components/catalogImport/ImportPreview.tsx`:
  - counts and warnings: Rx-like items, products missing upstream, item caps;
  - column mapper for generic files;
  - bulk class tools and the price and stock sync toggles;
  - filter tabs and a paged row table (class picker, skip, rename for conflicts);
  - the Import button.
- `app/dashboard/settings/integrations/page.tsx`: connected stores, Re-sync, and Disconnect with confirmation and the owner's follow-up step.
- `app/dashboard/settings/integrations/callback/[slug]/page.tsx`: the OAuth return page.
- `app/dashboard/products/page.tsx`: an "Import products" button, product photos, a "From Shopify / a file" badge, and the `ClassifyControl` picker on unclassified products.
- `lib/catalogImportApi.ts` (new). `lib/rxCartApi.ts`: `ProductClass` and `PRODUCT_CLASS_LABELS`. `lib/productApi.ts`: the new fields.
- `lib/routeGuards.ts`: the import and integrations pages are admin pages.
- `components/layout/AppSidebar.tsx`:
  - Settings gets an **Integrations** item;
  - the active item is now the longest matching link, so the integrations page doesn't also highlight "Security".

### 3.3 Docs and tests

- `docs/adr/0008-product-catalog-import.md`; the task list and development plan updated.
- **Backend unit:**
  - `catalogImport.test.ts` (27 tests): CSV, XLSX, values, presets, classes, staging;
  - `storeConnections.test.ts` (17 tests): state, Shopify HMACs, all four provider parsers, SSRF guard;
  - `rxMapping.test.ts` (+2 tests);
  - `bullmqIdleTuning.test.ts` (+1 worker).
- **Backend integration:** `catalogImport.int.test.ts` (14 tests).
- **Frontend:** `tests/components/catalogImport.test.tsx` (5 tests) and `e2e/catalog-import.spec.ts`.

## 4. Verification: commands and results

The local database was `mf-pg` in Docker on port 55432, with migrations applied using `prisma migrate deploy`.

```bash
cd backend
npm run typecheck                    # app + tests: clean
npm run lint                         # eslint src --max-warnings=0: clean
npx vitest run                       # 43 files, 683 tests passed
node scripts/check-synthetic-fixtures.js   # passed (112 files)
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it
npx vitest run --config vitest.integration.config.ts   # 29 files passed, 1 skipped; 385 tests passed, 1 skipped
cd .. && node scripts/check-no-em-dash.js backend && node scripts/check-no-em-dash.js frontend   # none
cd frontend
npx tsc --noEmit                      # clean
npm run lint                          # clean
npx vitest run                        # 53 files, 611 tests passed
npx playwright test e2e/catalog-import.spec.ts e2e/navigation.spec.ts e2e/layout-smoke.spec.ts e2e/rx-cart.spec.ts e2e/key-changes.spec.ts
# 39 passed (after navigation.spec.ts learned the new Settings > Integrations link)
```

Notes on the frontend run:

- One full vitest run made while a production build was using the CPU had one timing failure. The next two runs were all green (611 of 611).
- The full Playwright suite (every spec) was not run on this machine. Only the specs touched by this change were (above).
- For a manual build, Playwright expects `NEXT_PUBLIC_API_URL=http://127.0.0.1:3999` with no `/api/v1` suffix, so it can use `E2E_SKIP_BUILD=1`.

`catalogImport.int.test.ts` covers the following, against real Postgres with RLS on:

- **Connecting:**
  - a pasted WooCommerce key is tested, stored as `fle:v1:`, and never returned;
  - a private store address is refused;
  - providers get 403;
  - another clinic sees no connections.
- **Dry run:** writes rows only. Suggestions are given, and the GLP-1 vial gets none (rx-like).
- **Isolation:** another clinic gets 404 when it reads or applies the import.
- **Apply:** creates UNCLASSIFIED products with stock and a re-hosted PNG `SiteAsset`, and writes the `CATALOG_IMPORT_APPLIED` audit row.
- **The sale gate:**
  - an unclassified product gets 422 `PRODUCT_UNCLASSIFIED` from the cart;
  - it is absent from the public product list and the product page;
  - Rx to Cart routes it to `MANUAL`.
  - Classifying it through `PUT /products/:id` makes it sellable (cart 201, Rx to Cart `CART`).
- **Re-sync:**
  - the same data again gives all UNCHANGED;
  - a price and stock change updates both;
  - the clinic's rename and its class are kept.
- **Classes in the preview:** "use the suggested classes" imports Arnica as OTC.
- **File import:** a generic seller CSV is detected, previewed and applied.
- **Disconnecting:** wipes the credentials and keeps the products; a new import then gets 409.
- **Shopify webhook:** a bad HMAC gets 401; `app/uninstalled` disconnects the store.

The tenant guard caught one bug during the build: the stock upsert was not scoped by clinic. It was fixed before commit.

## 5. Design notes

- **Adapters to one item shape.** Each connector is about 150 lines and has a pure parser (`shopifyItems`, `squareItems`, `wooItems`, `wixV1Items`, `wixV3Items`) tested against synthetic responses shaped like the public API docs.
- **Staging rows** hold everything needed to re-match: a re-stage after any edit (rename, skip, class, options) re-runs matching, keeping row ids stable. Apply re-stages once more in case the catalog changed since the preview.
- **Photos are fetched after products** (4 at a time). A photo failure is a note on the row and never fails the product.
- **Limits:**
  - 5,000 items per import;
  - files up to 5 MB;
  - one fetch or apply running per connection;
  - Woo calls through the SSRF guard with a 15 s timeout and 8 MB bodies;
  - provider calls with a 10 s timeout and two retries.

## 6. What you must do manually

1. **Shopify app.**
   - Create the app in the Shopify Dev Dashboard (public distribution) with scopes `read_products,read_inventory`.
   - Set the redirect URL to `<FRONTEND_URL>/dashboard/settings/integrations/callback/shopify`.
   - Set the webhook URL for the privacy topics (`customers/data_request`, `customers/redact`, `shop/redact`) to `<BACKEND_URL>/api/v1/webhooks/shopify`; the app registers `app/uninstalled` itself on connect.
   - Put the client id and secret in Render: `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`.
   - Shopify reviews public apps before they can be installed widely. Until then, test on a development store.
2. **Square app.**
   - Create an application in the Square Developer dashboard.
   - Set the OAuth redirect URL to `<FRONTEND_URL>/dashboard/settings/integrations/callback/square`.
   - Set `SQUARE_APP_ID` and `SQUARE_APP_SECRET`, and `SQUARE_ENV=sandbox` until a production run.
3. **WooCommerce and Wix** need nothing on the server.
   - WooCommerce's key screen posts to `<BACKEND_URL>/api/v1/store-connections/woocommerce/callback`, which must be reachable over HTTPS. Locally, use "Paste a key instead".
4. **Deploy the migrations** (`prisma migrate deploy`). Both are additive.
5. **Real-store runs** (one each), recorded in the PR:
   - a Shopify development store;
   - a Square sandbox seller;
   - a WooCommerce test site;
   - a Wix site on catalog V3 and, if available, one on V1.

   Check names, prices, stock and photos against the store. Then classify and sell one item through the cart.

6. **Fullscript and India marketplaces:** decide whether to open a task for each (see ADR 0008).

## 7. HIPAA / review checklist

- **No PHI.** Catalogs carry no patient data, and the store scopes read products and stock only (no customers or orders).
- **Credentials** are field-encrypted at rest and wiped on disconnect, and never returned by the API or logged. Errors carry short, safe messages only.
- **Outbound requests to clinic-typed addresses** are SSRF-guarded (§3.1). The Shopify and Square hosts are fixed.
- **Access and isolation.** The new tables have RLS plus the tenant guard. Only owners and staff with `products.manage` can use them, and cross-clinic access gets 404 (tested).
- **Audit** rows hold ids and counts only. Usage events go through the CTO-39 catalog.

## 8. Known limits

- Adapter field shapes follow the providers' docs and need a real-store check, Wix V3 especially.
- Wix V3 imports carry no stock count (it lives in a separate inventory API).
- No scheduled re-sync: the owner presses Re-sync.
- Products the store no longer lists are reported, not deactivated.
- MedoFlow has no variants, so variants become separate products named "Product - Variant".
- Generic files can be re-mapped only while the browser still holds the file; after a refresh the owner uploads it again.

## 9. Manual local testing guide (macOS)

1. `docker start mf-pg`, then `cd backend && npx prisma migrate deploy` against your dev database, then `npm run dev`. Start the frontend with `npm run dev`.
2. Sign in as a clinic owner and open **Storefront > Import products**.
3. **File:** upload a CSV such as:

   ```
   SKU ID,Product Name,Pack Size,MRP,Selling Price,Quantity
   AB-101,Ashwagandha Tablets,60 tablets,450,399,40
   TS-1,Testosterone Cream,30 g,120,89,5
   ```

   Check that:
   - the preset detects as generic and the columns are guessed;
   - Testosterone is flagged as a prescription-like item;
   - "Use the suggested classes" sets Ashwagandha to Supplement;
   - Import completes, and the Storefront shows Testosterone with **Needs classification**.

4. **WooCommerce:** on a test site, make a read-only REST key, then use "Paste a key instead" with the store address. Import, then change a price in WooCommerce and press **Settings > Integrations > Re-sync products**. You should see one Update.
5. **Disconnect** from Integrations. Then confirm that the products stay and the key is gone from the database (the `accessToken` column is null).
