# ADR 0004 — Clinic website platform: templates, sections, drafts, public data and enquiries (B8.1, B8.3–B8.7)

**Status:** Accepted by engineering, implemented · 2026-10-20 · **Deciders:** CTO (Khush), Security Officer, Product · **Signature:** pending (below) · **Related:** [ADR 0001](0001-phi-hosting.md), [ADR 0002](0002-field-level-encryption.md), [ADR 0005](0005-custom-domains-and-host-routing.md), PRD §8 (website builder), HIPAA checklist §3

## Context

Component 8 is the clinic website builder: "Shopify for clinics". A clinic picks a template, brands it, edits pages visually, publishes, and is live on its own address. The first version had pages, but it was a prototype:

- title and SEO edits went live without publishing;
- page writes were not audited;
- the public site was a client-rendered page with a hard-coded landing (no SEO);
- images were URL text boxes, and logos were base64 strings in the database;
- the public API exposed provider e-mail addresses, inventory supplier/batch/expiry data, and every clinic's plan.

Five risks shape the design:

| Risk                                                                              | Consequence if ignored                                                             |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Unpublished edits (or a half-finished template) become public                     | A clinic's draft copy, prices or a placeholder page appear on its live site        |
| Content can carry script (`javascript:` links, raw HTML, arbitrary embeds)        | Stored XSS on every visitor of a clinic site, across tenants                       |
| Public endpoints return more than a website needs                                 | Staff e-mails, inventory internals or plan data leak to anyone (minimum necessary) |
| Contact-form messages ("my knee has hurt since…") are handled like marketing data | PHI stored or e-mailed in plain text, read without an audit trail                  |
| Website images are stored with patient files                                      | A public URL scheme meets the PHI bucket; one mistake publishes patient files      |

## Decision

### 1. One site per clinic, everything draft → publish (B8.1, B8.3)

- `Site` (one per clinic) holds the site-wide settings as **draft** and **published** JSON:
  - theme: 7 colours, font pair, radius, button style, density;
  - brand (logo, favicon), header and footer menus, announcement bar, social links, SEO defaults.
- `SitePage` holds `draft*` and published copies of its sections, title and SEO fields. Saving touches the draft only.
- **Publishing** copies draft → published in one transaction and writes a `SitePageRevision` (the last 25 are kept).
  - "Restore" copies a revision into the **draft**. The live page changes only when that draft is published.
  - "Unpublish" clears the live copy; the page 404s.
- The public renderer reads published fields only. A draft is visible only through a **signed preview link** (HMAC, bound to page and clinic, 30 minutes). Preview responses are `no-store` and `noindex`.
- Every write is audited as `SITE_*` (`SITE_PAGE_DRAFT_SAVED`, `SITE_PAGE_PUBLISHED`, `SITE_TEMPLATE_INSTALLED`, `SITE_DOMAIN_ADDED`, `SITE_LEAD_READ`, …), with ids and slugs only.
- Roles:
  - **SUPER_ADMIN** (clinic owner) and **MARKETING** edit the website;
  - only the owner manages domains;
  - owner and **FRONT_DESK** read enquiries.

### 2. Templates are code, installed as data (B8.3)

- Five templates ship in `backend/src/site/templates/`: **Clarity** (primary care), **Serenity** (med-spa), **Vitality** (physio/sports), **Heritage** (family/dental), **Botanica** (integrative).
  - Each has a theme, menus and 6–7 pages of finished copy with sample images (`/site-samples/*.svg`).
- **Install** writes the template's settings and pages into the clinic's _draft_:
  - `replace` mode: pages not in the template are unpublished and kept as revisions, never hard-deleted;
  - `styles-only` mode: only the theme changes.
- Templates are validated by the same section schemas at test time, so a broken template cannot ship.
- Code-defined templates were chosen over database-stored ones: they are reviewed, versioned and tested like code. A theme store can come later on the same format.

### 3. A closed section library with typed links (B8.4)

- 17 section types (hero, trust bar, service grid, provider bios, image with text, gallery, testimonials, FAQ, pricing, featured products, locations and hours, contact form, booking CTA, video, rich text, steps, spacer). Each has fixed variants and a **strict** zod schema: unknown fields are refused, and every list and string has a size limit.
- **No HTML.** Rich text is a small Markdown subset rendered by our own renderer.
- **Links are typed** (`SiteLink`: page, route, service, provider, product, booking, anchor, external) and resolved to URLs at render time, so renaming a page never breaks a menu.
  - External links must be `https:`, `mailto:` or `tel:`.
- Images are either an uploaded asset id or a bundled `/site-samples/` path. Remote URLs are refused.
- Video is limited to YouTube/Vimeo.
- The frontend has a field-for-field mirror (`frontend/lib/site/sections.ts`). Both sides run the same cases (`shared/validation-cases/site-sections.json`), so the editor and the API can't disagree.

### 4. A route registry, slugs and redirects (B8.5, B8.6)

- Public paths come from one registry, mirrored in the backend and frontend and tested against shared cases (`site-routes.json`):
  - `/`, `/<page>`, `/services[/<slug>]`, `/team[/<slug>]`, `/store[/<slug>]`, `/book[/<slug>]`, `/contact`, `/legal/<slug>`, `/preview/<pageId>`, `/sitemap.xml`, `/robots.txt`, `/favicon.ico`.
- Services, providers and products got per-clinic `slug`s, backfilled by the migration.
- Renaming any slug creates an automatic **301** `SiteRedirect`. Clinics can add their own redirects or import them as CSV. Chains are collapsed and loops are refused.
- Paths are normalised (lower case, no trailing slash, at most 3 segments) with a 308.

### 5. Public data is minimum-necessary (B8.5)

- `GET /public/sites/render` returns one payload per page: published settings, the page, and only the data its sections need.
- The payload is cacheable (`ETag`, `s-maxage=60`).
- Fixed in the old public API:
  - providers carry no e-mail;
  - products carry no inventory internals (stock count only);
  - `/public/clinics` carries no plan and is capped at 200;
  - a general rate limit sits on `/public` (stricter limits for render and enquiries).
- The site is **server-rendered**, with per-page title, canonical URL, OpenGraph tags, JSON-LD (`MedicalClinic`, `Physician`, `Product`, `Service`), sitemap and robots.

### 6. Website images live in their own public store (B8.5)

- `SiteAsset` uploads use the existing presigned-PUT driver, but into **`SITE_ASSETS_BUCKET`**. The API refuses to start if that bucket is the patient-file bucket.
- Upload checks:
  - JPEG/PNG/WebP/GIF only (no SVG), 5 MB maximum;
  - the bytes are checked against the declared type (magic numbers) and dimensions are read before the asset becomes `AVAILABLE`.
- Every new image gets a new id, so its URL is immutable (`Cache-Control: immutable`).
- An asset used by a page or the site settings cannot be deleted.

### 7. Contact-form enquiries are PHI (B8.5)

- `SiteLead` name, e-mail, phone and message are sealed with field-level encryption (ADR 0002).
- Spam protection, all silent so bots learn nothing:
  - a honeypot field;
  - a minimum fill time of 2.5 s;
  - a rate limit of 5 messages per 10 minutes per visitor.
- Reading a message is audited (`SITE_LEAD_READ`). Only the owner and front desk can list or read enquiries.
- The notification e-mail to the clinic says "you have a new enquiry" and links to the inbox. It never contains the message.
- **PHI gate:** until ADR 0001 is resolved, the contact form must stay off for real clinics, or post to a BAA-covered host (see `docs/PHI_GATE.md`).

### 8. Plan limits in one place (B8.7)

`siteEntitlements(plan)` gates pages, custom domains, the "Powered by MedoFlow" badge and the image count:

| Plan       | Pages | Custom domains | Hide badge | Images |
| ---------- | ----- | -------------- | ---------- | ------ |
| FREE       | 8     | 0              | no         | 40     |
| STARTER    | 20    | 1              | no         | 200    |
| GROWTH     | 50    | 3              | yes        | 1000   |
| ENTERPRISE | 200   | 20             | yes        | 5000   |

This is temporary until the platform entitlements engine (B12) absorbs it.

## Consequences

- **+** Nothing a clinic types is public until it presses Publish, and every publish can be rolled back from its revision.
- **+** Clinic content cannot carry script: no HTML, closed section types, typed links, allow-listed embeds.
- **+** New templates and section types are code changes with parity tests on both sides. The renderer, editor and API cannot drift.
- **+** Clinic sites are indexable: SSR, canonical URLs, sitemaps, and 301s that survive renames.
- **−** Templates are not user-shareable yet (no theme marketplace).
- **−** Enquiries are PHI. Until the PHI gate opens, they are synthetic-only, like the rest of the platform.
- **−** Logos stored as data URLs by the first builder still render (`legacyLogoUrl`). An ops script to move them into `SiteAsset` is a follow-up.
- **Follow-ups:**
  - B12 absorbs `siteEntitlements`;
  - an AI copy rewrite per template beyond the home page;
  - delete the unused `PatientHubModal` / `PatientWelcomeCard` components;
  - translations.

## Evidence

- Unit:
  - `backend/src/tests/siteContent.test.ts`: sections, links, templates, settings, markdown;
  - `backend/src/tests/siteRouting.test.ts`: route registry, hosts, CORS matcher, preview tokens, entitlements.
- Integration (Postgres, RLS, enforce mode): `backend/src/tests/integration/siteBuilder.int.test.ts`; the extended `authzAndPublic.int.test.ts`.
- Frontend:
  - `frontend/tests/unit/siteContent.test.ts` and `siteRouting.test.ts`;
  - `frontend/tests/components/siteRenderer.test.tsx` and `siteBuilder.test.tsx`;
  - `frontend/e2e/site-builder.spec.ts` (mocked API);
  - `frontend/e2e/live-site.spec.ts` (real API).
- Walkthrough and manual guide: `development-log-docs/component-website-builder-WALKTHROUGH-AND-VERIFICATION.md`.

## Sign-off

| Role             | Name | Date | Signature |
| ---------------- | ---- | ---- | --------- |
| CTO              |      |      |           |
| Security Officer |      |      |           |
| Product          |      |      |           |
