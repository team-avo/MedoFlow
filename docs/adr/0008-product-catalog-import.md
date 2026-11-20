# ADR 0008: Product catalog import from outside stores (CTO-40)

- **Status:** accepted (code on `feat/cto-40-catalog-import`, 2026-11-18)
- **Context owner:** Commerce (C5) and the website (C8)
- **Related:** ADR 0003 (prescription to cart; fulfillment classes), ADR 0002 (field-level encryption), CTO-43 (India variant)

## Context

Clinics that already sell supplements, skincare and OTC products online shouldn't have to type their catalog into MedoFlow. AI Scribe's Rx to Cart only works on products in the MedoFlow Storefront. CTO-40 first named Shopify and Wix. The brief was then widened to cover the other places clinics sell, including Indian pharmacy marketplaces such as Tata 1mg.

### Research summary (November 2026)

| Source                                                                | Where clinics use it                                                               | API for reading a catalog                                                                                                                                                                                        | Decision                                                                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Shopify**                                                           | The largest US store platform (about 28–30% of US stores)                          | GraphQL Admin API, OAuth (`read_products`, `read_inventory`). Admin-created custom apps cannot be made since 2026-01-01. Public apps must handle the app-uninstalled webhook and three privacy webhooks.         | Live connector                                                                                                                |
| **Wix Stores**                                                        | Second in the US (about 15–19%), and common for small clinic websites              | Catalog V1 and V3 both exist; an integration must read both, and the Catalog Versioning API says which one a site uses. OAuth needs a Wix App Market app. An account API key plus the site id works without one. | Live connector (API key); the App Market OAuth app comes later                                                                |
| **WooCommerce**                                                       | About 14–18% of US stores, WordPress clinic sites                                  | REST v3 with a read-only key, minted by WooCommerce's own `/wc-auth/v1/authorize` screen or made by hand                                                                                                         | Live connector                                                                                                                |
| **Square**                                                            | Square Online is small (1–2%), but Square POS is widely used for front-desk retail | Catalog and Inventory APIs, OAuth (`ITEMS_READ`, `INVENTORY_READ`, `MERCHANT_PROFILE_READ`), tokens last about 30 days and refresh                                                                               | Live connector                                                                                                                |
| **Med-spa and clinic systems** (Boulevard, Zenoti, Vagaro, Mangomint) | Retail inventory alongside bookings                                                | Partner-gated or no public catalog API                                                                                                                                                                           | File import (their CSV or Excel export)                                                                                       |
| **Fullscript**                                                        | The leading practitioner supplement dispensary                                     | Partner API (catalog search, treatment plans)                                                                                                                                                                    | Not an import. The clinic doesn't hold the stock; this is a "recommend through Fullscript" integration and needs its own task |
| **Tata 1mg, PharmEasy, Netmeds** (India)                              | Online pharmacy marketplaces                                                       | No public seller catalog-read API. 1mg sellers manage listings through Excel templates in the seller panel, and 1mg runs on Unicommerce.                                                                         | File import now (generic mapping). Live connectors, for example through Unicommerce or EasyEcom, belong to CTO-43             |

## Decision

### One pipeline, many sources

Every source is turned into the same `NormalizedItem` list (external id, name, SKU, price, description, image URL, stock, category, tags). Variants are flattened into separate products ("Collagen - 300 g"), because MedoFlow has no variants. The list then goes through one pipeline:

1. **Fetch.** A store connection is read by a `catalog-import` BullMQ job (in-process without Redis, 3 attempts with backoff). A file is parsed in the request.
2. **Stage (the dry run).** One `CatalogImportRow` per item, with an action: `CREATE`, `UPDATE`, `UNCHANGED`, `CONFLICT` or `ERROR`. Nothing touches the catalog yet.
3. **Edit.** The owner chooses classes (one by one, all at once, or "use the suggested classes"), renames clashing items, skips rows, and turns the price and stock sync on or off. Every edit re-runs matching.
4. **Apply.** Products and stock are written row by row. Each row records the product it wrote, so a retry carries on where it stopped. Photos are fetched afterwards.

Matching order: same source and external id, then a single product with the same SKU, then the same name (normalised like the Rx to Cart mapper, so import matching and scribe matching agree).

### Classification gate (B5.5)

The fulfillment-class enum gets a new value, **`UNCLASSIFIED`**. Every imported product is stored as `UNCLASSIFIED` unless a person picked a class in the preview. `UNCLASSIFIED` is:

- refused by the cart (422 `PRODUCT_UNCLASSIFIED`) and at checkout;
- left off every public storefront (`fulfillmentClass in SELLABLE_CLASSES`);
- matched by Rx to Cart but routed to `MANUAL`, so the provider sees it and it is never sold silently.

Suggestions come from the product type, tags and name, and are only suggestions. Anything that looks like a prescription product (a GLP-1, testosterone, peptides, toxins, "Rx", "vial" and so on) never gets a suggestion: a person must decide, and `RX_*` goes to e-prescribing.

### Re-sync rules

A re-sync can update price, description, photo and (if `syncStock` is on) stock. It never renames a product (the clinic's name drives scribe matching), never changes a class once set, and never reactivates a product the clinic removed. Products the store no longer lists are reported, not deleted.

### Security

- **Credentials** (`StoreConnection.accessToken`, `refreshToken`) are field-encrypted with `fle:v1` (ADR 0002). Disconnecting wipes them and calls the provider's revoke where one exists (Shopify uninstall, Square revoke). WooCommerce and Wix keys can only be deleted by their owner, and the UI says so.
- **OAuth state** is an HMAC-signed, 10-minute token bound to the clinic, the user and the provider. The Shopify callback HMAC and the webhook HMAC are verified.
- **SSRF.** The WooCommerce store URL is typed by the clinic, and image URLs come from imported data. Both go through `catalogImport/safeHttp`:
  - https only, on the default port;
  - every resolved address must be public, checked inside the socket's own DNS lookup so there is no rebinding gap;
  - redirects are re-checked, and credentials never go to another origin;
  - response size is capped and the whole request has a timeout.
- **Photos** are re-hosted as `SiteAsset`s (their type is checked from the bytes, and the plan's image limit applies). Storefronts never hot-link a third party.
- **Files.** CSV is parsed with an RFC 4180 reader of our own. `.xlsx` is read with a small ZIP and XML reader built on Node's zlib: no new dependencies, per-part size caps against ZIP bombs, and legacy `.xls` refused.
- **Access.** Owners, plus staff with `products.manage`. All new tables are clinic-scoped (RLS plus the tenant guard). Audit actions are `STORE_CONNECTED`, `STORE_DISCONNECTED` and `CATALOG_IMPORT_APPLIED`, with ids and counts only. These also feed the CTO-39 usage catalog.
- **No PHI.** Store catalogs hold no patient data, and the store connections don't read customers or orders.

## Consequences

- Clinics can bring a catalog in from four live stores and any spreadsheet, including marketplace seller sheets, without re-keying.
- Owners must classify imported products before they sell. This is deliberate friction that keeps prescription items off the cart.
- The owner and platform team still have to set things up:
  - register a Shopify app (redirect URL and webhooks; App Store review before wide distribution);
  - register a Square app;
  - set the env vars in `render.yaml`;
  - do a real-store run for each provider. Adapter field mapping was built against the providers' public docs and synthetic fixtures; Wix V3 especially should be confirmed on a real site.
- Deferred:
  - a Wix App Market OAuth app;
  - V3 stock through the Wix inventory API;
  - scheduled re-syncs;
  - a Fullscript recommendation integration;
  - live India marketplace connectors (CTO-43).
