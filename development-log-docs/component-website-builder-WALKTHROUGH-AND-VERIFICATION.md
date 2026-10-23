# Component 8 — Website builder ("Shopify for clinics"): walkthrough and verification

**Date:** 2026-10-20, synced with `team/development` @ `e3e2233` on 2026-10-23 (Next.js 16, self-hosted fonts, C1, C3, C5) · **Branch:** `feat/c8-website-builder` · **Data:** synthetic only. The PHI gate stays closed.
**Plan reference:** `arh-agent-docs/development-plan.md` › Part B › Component 8 (B8.1–B8.8, F8.1–F8.6).
**Decisions:** ADR 0004 (site platform, templates, public data, enquiries), ADR 0005 (subdomains, custom dthe development branch on team remote has been updated and few merges have been made to the development branch. Pull those changes and review them and apply them to this branch feat/c-8-website builder branch.

After that also update the @.worktrees/c8/development-log-docs/component-website-builder-WALKTHROUGH-AND-VERIFICATION.md file. With the correct and updated manual guide for testing it locally. (see other local guides in other files in this folder )

Also update @arh-agent-docs\cloudflare-custom-domains-setup-guide.md if and whereever necessaary with the latest changesomains, host routing).
**DNS / Cloudflare setup:** `arh-agent-docs/cloudflare-custom-domains-setup-guide.md`.
**Want to check it yourself?** §9 is a step-by-step manual testing guide for the backend (curl + database) and the frontend (browser + curl).

---

## 1. Outcome

A clinic picks one of five templates and makes it its own: theme, logo, menus and 17 kinds of section. It edits pages in a visual editor (drag to reorder, undo, autosave) and previews the draft through a signed link. When it publishes, its site is live, server-rendered and indexable at `<clinic>.<root-domain>` or on its own verified domain. All of it is served by the one existing Worker: adding a clinic needs no deploy.

| Task                                        | AC (short)                                                                                                         | Status                          | Evidence                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B8.1** Pages CRUD, draft → publish        | CRUD tenant-scoped + audited; a draft (content, title, SEO) is never public until published                        | ✅ (re-done, 3 defects fixed)   | `siteBuilder.int.test.ts` › "B8.1 pages", "B8.1 drafts are never public"; §9 B-6 – B-14, D-3                                                                        |
| **B8.2** ⭐ Custom domains + subdomains     | app + API on own domains with TLS ≥ 1.2 + HSTS; a clinic subdomain or custom domain renders its site; env cut over | ✅ engineering · ⬜ DNS (owner) | `siteDomains.int.test.ts`; `siteRouting.test.ts` (both apps); `live-site.spec.ts` on `<slug>.localhost`; §9 B-15 – B-23, W-1 – W-6. Live hosts: owner step §6 #1–#4 |
| **B8.3** Templates + site settings          | 5 templates install (replace / styles-only); theme, brand, menus as draft → publish                                | ✅                              | `siteContent.test.ts` (every template validates); `siteBuilder.int.test.ts` › "B8.3 templates"; §9 B-2, B-5                                                         |
| **B8.4** Section library                    | 17 typed sections with variants; strict validation, no HTML, safe links; FE = BE                                   | ✅                              | `site-sections.json` parity cases run by both apps; §9 B-13                                                                                                         |
| **B8.5** Public render, images, enquiries   | one minimum-necessary render payload; public image store; enquiries sealed, audited, spam-protected                | ✅ (public API leaks fixed)     | `siteBuilder.int.test.ts` › B8.5 groups; `authzAndPublic.int.test.ts`; §9 B-24 – B-31, D-2 – D-4                                                                    |
| **B8.6** Revisions, preview, SEO, redirects | revision + restore; signed 30-min preview; sitemap/robots/canonical/JSON-LD; 301 on slug rename                    | ✅                              | `siteBuilder.int.test.ts` › "B8.6 preview links"; §9 B-7, B-10, B-12, B-29, W-1, W-4                                                                                |
| **B8.7** Plan limits                        | pages, custom domains, badge and images gated per plan                                                             | ✅                              | `siteBuilder.int.test.ts` › "B8.7 plan limits"; §9 B-1, B-16                                                                                                        |
| **B8.8** Tests                              | every AC above proven, happy + negative paths, both apps                                                           | ✅                              | §4                                                                                                                                                                  |
| **F8.1** Website overview                   | live URL, publish state, setup checklist, pages; publish all                                                       | ✅                              | `site-builder.spec.ts`; `live-site.spec.ts`; §9.5 F-1, F-7                                                                                                          |
| **F8.2** Visual editor                      | sections tree with drag-and-drop + keyboard reorder, inspector, theme/brand/menus, undo, autosave, device preview  | ✅                              | `site-builder.spec.ts` (install → edit → autosave; keyboard reorder + undo); `siteBuilder.test.tsx`; §9.5 F-3 – F-6                                                 |
| **F8.3** Template gallery + launch          | browse, preview per device, install; "Launch your website" from the admin dashboard                                | ✅                              | `site-builder.spec.ts` (gallery); `live-site.spec.ts`; §9.5 F-2                                                                                                     |
| **F8.4** Domains screen                     | subdomain shown; add domain → DNS records → Verify → primary; plan lock                                            | ✅                              | `siteBuilder.test.tsx` › Domains; `site-builder.spec.ts` (custom domain); §9.5 F-10                                                                                 |
| **F8.5** Media, redirects, enquiries        | presigned uploads with pre-checks; redirects + CSV import; enquiry inbox (audited read)                            | ✅                              | `site-builder.spec.ts`, `live-site.spec.ts` (upload, contact form → inbox); §9.5 F-8, F-9, F-11                                                                     |
| **F8.6** Public clinic site (SSR)           | every route kind server-rendered on the clinic host with SEO; real 404/308 statuses                                | ✅                              | `siteRenderer.test.tsx`; `site-builder.spec.ts` (SEO); `live-site.spec.ts`; §9 W-1 – W-6                                                                            |

**Exit criteria (Universal Acceptance Standard)**

| #   | Criterion                                                    | State                                                                                                                                         |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CI gate: typecheck, lint (0 warnings), tests, audit          | ✅ locally, all green (§4.1). CI runs on the PR.                                                                                              |
| 2   | Tests prove the behaviour, happy + negative paths            | ✅ 135 new backend unit, 48 new integration, 134 new frontend unit/component, 6 new mocked e2e, 4 live e2e                                    |
| 3   | No regressions                                               | ✅ every suite of `development` @ `e3e2233` still green (backend 229 → 364 unit, 173 → 221 integration; frontend 181 → 315 unit; e2e 19 → 25) |
| 4   | Peer review                                                  | ⬜ PR not opened yet (no commit made — waiting for your go-ahead)                                                                             |
| 5   | HIPAA §2 per-change gate                                     | ✅ §7                                                                                                                                         |
| 6   | Verified in a running environment                            | ✅ real API + real frontend (Next.js 16) on this machine with `*.localhost` host routing (§4.6, §9). Hosted: ⬜ owner step §6                 |
| 7   | No open defects / docs updated / no secrets / synthetic only | ✅ ADRs 0004 + 0005, plan statuses, Cloudflare guide, this doc; secret sweep clean (§4.7)                                                     |

**Not done here (needs you):**

- Set up the free Pages front door and cut the environment over (§6 #1–#3). MedoFlow owns no domain and has no budget, so the set-up uses only free Cloudflare/Render addresses (`medoflow.pages.dev`, `onrender.com`); clinic sites get their own `<label>.medoflow.pages.dev` address through one Pages branch deployment each (setup guide `arh-agent-docs/cloudflare-custom-domains-setup-guide.md`). A domain-based set-up can follow when there is budget. There was no Cloudflare/registrar access from this machine, so the TLS/HSTS AC for the **live** hosts is proven by `check-domain-posture` after the cut-over (§6 #4).
- Apply migration `20261020000000_clinic_site_platform` on Neon.
- Sign ADRs 0004 and 0005.
- Open the PR (§6 #7).

---

## 2. Problems found and fixed

1. **Drafts leaked.**
   - **Problem.** Title and SEO edits were written straight to the live columns, so they went public before Publish.
   - **Fixed:** all page fields have draft copies; only Publish copies them to the live fields (`siteBuilder.int.test.ts` › "drafts are never public"; §9 B-6, B-9).
2. **Page writes were not audited** (B8.1 was marked ✅ but its AC says "audited").
   - **Fixed:** every write is a `SITE_*` audit row with ids only (§9 D-3, D-4).
3. **The public site ignored the builder.**
   - **Problem.** `/clinic/<slug>` showed a hard-coded landing, and pages resolved by clinic id only, so the canonical `/clinic/<slug>/p/home` was a 404.
   - **Fixed:** one server-rendered site tree serves every page kind from the published data. Old URLs 308 to the new ones.
4. **Public API over-shared** (minimum necessary):
   - provider e-mail addresses were public;
   - products exposed supplier, batch and expiry data;
   - `/public/clinics` listed every tenant with its plan.
   - **Fixed** (§9 B-30, `authzAndPublic.int.test.ts`). `/public` now also has a general rate limit.
5. **Field-name mismatches.** The renderer read `durationMinutes`/`price`, but services carry `duration`/`defaultPrice`, so prices and durations never showed. Fixed in the render payload.
6. **CORS allowed any `*.vercel.app` origin** (a leftover). Removed; replaced by exact + single-label wildcard + verified-domain rules (§9 B-21).
7. **Logos as base64 in the database, images as free-text URLs.** Replaced by `SiteAsset` uploads to a separate public store, with type, size and magic-byte checks (§9 B-24 – B-26).
8. **Root `app/loading.tsx` turned every 404 and redirect into a 200.** It wrapped the whole app in a streaming boundary. Moved into each route group; clinic sites now return real 404 / 308.
9. **Found while writing §9:** legacy `/clinic/<id>` links still answered 200 + a client redirect, because of the `(public)` loading boundary. They are now 308s from `middleware.ts` (new unit test; §9 W-3, W-5).
10. **Found while fixing:** "Publish all" re-published pages the clinic had deliberately unpublished. It now publishes only never-published pages and pages with draft changes.

**Found while syncing with `development` (2026-10-23):**

11. **Prescription products on clinic websites.** C5 (ADR 0003) keeps `RX_*` products off every storefront, but the site renderer queried products without that rule. A clinic's site would have listed and linked Tramadol.
    - **Fixed:** one `PUBLIC_PRODUCT_WHERE` (active, and not `RX_NON_SCHEDULED` or `RX_SCHEDULED`) is used by all five product queries in `renderService.ts`: store list, count, product page, link resolution and sitemap (§9 B-31, W-7).
12. **Website fonts were downloaded from Google at build time.** `development` moved the app's fonts to self-hosted files because `next/font/google` crashed the Cloudflare build. The clinic-site themes still used it for 8 families.
    - **Fixed:** the same latin woff2 files Google serves, with their SIL OFL licences, are in `frontend/app/fonts/site/` and load with `next/font/local` (`components/site/fonts.ts`). Builds make no font requests.
13. **Next.js 16 deprecates `middleware.ts`** (renamed `proxy.ts`). A proxy always runs on the Node.js runtime, which OpenNext calls experimental and unsupported on Cloudflare Workers. `middleware.ts` (edge runtime) is kept, with the reason in its header comment. The build prints a deprecation warning; that is expected.
14. **Cart button label.** The site header said "Cart, N items"; the storefront it replaces said "Open cart — N items", which C5's manual guide refers to. It now uses the same wording.

---

## 3. What was built (files)

### Backend

| Area                      | Files                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration                 | `prisma/migrations/20261020000000_clinic_site_platform/migration.sql`. New tables: `Site`, `SiteDomain`, `SiteAsset`, `SitePageRevision`, `SiteRedirect`, `SiteLead`. `SitePage` draft fields; `slug` on Service/Provider/Product (backfilled). RLS policies + grants.                                                                                                                |
| Site module               | `src/site/`: `routing/` (route registry, path matcher, URL builder, hosts), `content/` (sections, settings, links), `templates/` (5 templates), `domainProvider/` (manual, cloudflare), `services/` (site, page, slug, redirect, asset, domain, host, lead, render, preview token, AI copy), `http/admin/*`, `http/public/sites.routes.ts`, `cors.ts`, `entitlements.ts`, `config.ts` |
| Wiring                    | `app.ts` (TRUST_PROXY, HSTS 1 y, new CORS), `routes/index.ts` (`/site`, legacy `/site-pages` with `Deprecation` header), `routes/public.ts` (`/public/sites`), `middleware/rateLimit.ts`, `config/envValidation.ts`, `config/prisma.ts` (guard + hard-delete protection), `utils/fieldCrypto.ts` (`SiteLead`)                                                                         |
| Existing services touched | slugs on create in product/service/provider/staff services; `tenantService` + `platformAdminService` create the clinic's subdomain at signup; `clinicService.generateWebsite`; `publicController` minimum-necessary; `emailService.sendSiteLeadNotification`                                                                                                                          |
| Removed                   | `routes/sitePages.ts`, `services/sitePageService.ts` (replaced by the module)                                                                                                                                                                                                                                                                                                         |
| Scripts                   | `scripts/check-domain-posture.ts` (TLS/HSTS/redirect/CORS probe); `scripts/seed-e2e-live.ts` also prints `clinicSlug`, `serviceId` (the seed is shared with C3 and C5)                                                                                                                                                                                                                |
| Tests                     | `src/tests/siteContent.test.ts` (30), `src/tests/siteRouting.test.ts` (105), `integration/siteBuilder.int.test.ts`, `integration/siteDomains.int.test.ts`, `authzAndPublic.int.test.ts` (extended)                                                                                                                                                                                    |

### Frontend

| Area                | Files                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Routing             | `middleware.ts`; `lib/site/{routes,host,edgeRouting,legacyRedirect}.ts` (mirror of the backend registry)                                                                                                                                                                                                           |
| Content + rendering | `lib/site/{types,sections,theme,links,markdown,seo,sitemap,renderApi,resolveClient}.ts`; `components/site/{SiteRenderer,SiteShell,routeViews,LiveSite,SiteContext,primitives,fonts}.tsx`, `sections/*`, `site.css` (container queries); `app/fonts/site/*.woff2` with their OFL licences (self-hosted theme fonts) |
| Public site (SSR)   | `app/clinic-site/[siteId]/{layout,not-found}.tsx`, `[[...slug]]/page.tsx`, `sitemap.xml`, `robots.txt`, `favicon.ico` route handlers                                                                                                                                                                               |
| Builder             | `app/dashboard/site/{page,templates,editor,media,domains,redirects,leads}`; `components/site/builder/*` (SectionTree with @dnd-kit, Inspector, fields, DeviceFrame, MediaLibrary, SettingsEditors, LaunchWebsiteModal); `lib/site/{siteApi,editorState}.ts`                                                        |
| Legacy              | `app/(public)/clinic/[id]/**` → 308 (now at the edge); old builder files removed                                                                                                                                                                                                                                   |
| App shell           | root `app/loading.tsx` removed (per-group loading files); AuthModal keeps patients on the clinic site; sidebar "Website" group; route guards for `/dashboard/site`                                                                                                                                                 |
| Config              | `.env.example` (`NEXT_PUBLIC_SITE_ROOT_DOMAIN`, `NEXT_PUBLIC_APP_HOSTS`, `NEXT_PUBLIC_APP_URL`), `wrangler.jsonc` (routes, commented), `.github/workflows/deploy.yml`, `playwright.config.ts` (`E2E_BASE_URL`)                                                                                                     |
| Dependencies        | `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2` (MIT)                                                                                                                                                                                                                                |
| Tests               | `tests/unit/siteRouting.test.ts`, `siteContent.test.ts`; `tests/components/siteRenderer.test.tsx`, `siteBuilder.test.tsx`; `e2e/site-builder.spec.ts` + `e2e/siteMock.ts`; `e2e/live-site.spec.ts`                                                                                                                 |

Shared: `shared/validation-cases/site-routes.json`, `site-sections.json`.

### API at a glance

| Method + path (`/api/v1`)                                                       | Who                       | Does                                                            |
| ------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------- | ------------------------------------ | ----- |
| `GET /site` · `GET /site/editor-data`                                           | owner, marketing          | site, URLs, entitlements · data for link pickers                |
| `PUT /site/settings` · `POST /site/publish` · `POST /site/preview-link`         | owner, marketing          | draft settings · publish (all or listed pages) · signed preview |
| `GET /site/templates[/:key]` · `POST /site/templates/:key/install`              | owner, marketing          | gallery · install (`replace` / `styles-only`)                   |
| `/site/pages` CRUD · `/:id/publish                                              | unpublish                 | duplicate`·`/:id/revisions[/:v/restore]`                        | owner, marketing                     | pages |
| `PUT /site/slugs/:entity/:id`                                                   | owner, marketing          | service/provider/product URL (+ automatic 301)                  |
| `/site/assets` (`uploads`, `/:id/complete`, list, alt, delete)                  | owner, marketing          | image library                                                   |
| `/site/redirects` (list, create, `import`, delete)                              | owner, marketing          | redirects                                                       |
| `/site/domains` (list, `subdomain`, add, `/:id/verify`, `/:id/primary`, delete) | owner                     | addresses                                                       |
| `/site/leads` (list, read, status)                                              | owner, front desk         | enquiries (read audited)                                        |
| `GET /public/sites/resolve?host=`                                               | anyone                    | host → site / alias / unknown                                   |
| `GET /public/sites/render?host=                                                 | clinic=&path=[&preview=]` | anyone                                                          | the page payload (or redirect / 404) |
| `GET /public/sites/sitemap` · `GET /public/sites/templates/:key/preview`        | anyone                    | sitemap entries · gallery preview                               |
| `POST /public/sites/leads`                                                      | anyone (rate-limited)     | contact form                                                    |
| `/site-pages/*`                                                                 | as before                 | deprecated alias for one release                                |

---

## 4. Verification: commands and results

All commands were re-run from Git Bash on 2026-10-23, after the sync with `development` @ `e3e2233`. Use `corepack pnpm` wherever `pnpm` is not on your PATH.

### 4.0 One-time local setup

```bash
docker start mf-pg                                   # postgres:18 on 55432, role medoflow_app
cd backend
docker exec mf-pg psql -U postgres -c "CREATE DATABASE mf_c8"
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_c8 corepack pnpm exec prisma migrate deploy
# → applied 20261020000000_clinic_site_platform
corepack pnpm exec prisma generate
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_c8
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_c8
```

### 4.1 Gate commands (what CI runs)

```bash
# backend/
corepack pnpm run typecheck                    # → clean
corepack pnpm run lint                         # → 0 problems
node scripts/check-synthetic-fixtures.js       # → ✓ passed
corepack pnpm run test:coverage                # → 22 files, 364 passed
corepack pnpm run test:integration:coverage    # → 14 files (+1 skipped), 221 passed, 1 skipped (coverage floor met)
node scripts/audit-backend.js                  # → ✓ no unaccepted high/critical advisories

# frontend/
corepack pnpm run typecheck                    # → clean
corepack pnpm run lint                         # → ✔ No ESLint warnings or errors
corepack pnpm run test:coverage                # → 23 files, 315 passed
node scripts/audit-frontend.js                 # → ✓ no unaccepted high/critical advisories
corepack pnpm run build                        # → exit 0 (next build --webpack)
```

> Since Next.js 16, lint is ESLint 9 with a flat config (`eslint.config.mjs`); `next lint` no longer exists. The build prints two expected warnings: the `middleware` deprecation (§2 #13) and Next's own `process.cwd` note for edge code.
>
> The audit scripts call `pnpm`. Where only corepack is available, a two-line shim in the gitignored `node_modules/.shim/` was put on PATH for the run and deleted afterwards.

### 4.2 Content and routing (both apps, shared cases)

```bash
# backend/
corepack pnpm exec vitest run src/tests/siteContent.test.ts src/tests/siteRouting.test.ts   # → 135 passed
# frontend/
corepack pnpm exec vitest run tests/unit/siteContent.test.ts tests/unit/siteRouting.test.ts tests/components/siteRenderer.test.tsx tests/components/siteBuilder.test.tsx
```

Proven:

- **Sections:**
  - The 17 types and their variants are identical in both apps.
  - Every valid case parses and every invalid one is refused, on both sides: unknown type/variant/field, missing headline, `javascript:` / `http:` links, unknown route, remote image, upload + sample together, non-allow-listed video, bad id, 31 FAQ items.
- **Templates:** all five templates validate against the schemas, have a HOME page and contain no PHI-like strings.
- **Routes:**
  - Every route key round-trips (build → match).
  - Case and trailing-slash variants redirect; reserved, deep and malformed paths are `none`.
- **Hosts:** 17 shared host cases, the same answer from both apps (app, api, subdomain, custom, invalid).
- **Edge routing:**
  - rewrites to the internal tree;
  - patient flows and static files pass through; staff paths 307 to the app host;
  - legacy `/clinic/*` 308s; `/clinic-site/*` 404s.
- **Unit level:** CORS matcher (rejects `evil-<root>`, `a.b.<root>`, http), preview token (expiry, tamper, wrong page), entitlements, domain providers (stubbed DNS; stubbed Cloudflare API: create, pending → active, error).

### 4.3 Backend against Postgres (RLS, enforce mode)

```bash
corepack pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/siteBuilder.int.test.ts src/tests/integration/siteDomains.int.test.ts src/tests/integration/authzAndPublic.int.test.ts
```

Proven:

- **B8.1:**
  - Clinic B gets 404 on every clinic-A page action. A provider or patient gets 403.
  - Every write leaves an audit row.
  - Content, title and SEO drafts are invisible by id, slug and host until Publish.
- **B8.3:**
  - Install in `replace` keeps the old pages as revisions.
  - `styles-only` changes only the theme.
  - The page limit is enforced.
- **B8.5:**
  - The render payload holds only what the sections need: no provider e-mail, no inventory internals.
  - Slug renames create 301s. Redirect chains collapse, and loops are refused.
  - Uploads with wrong bytes are rejected. An image in use cannot be deleted.
  - Enquiries are sealed at rest. Honeypot and too-fast submissions are dropped. The 6th message in the window is 429. A read is audited.
- **B8.6:**
  - Revisions are listed, and a restore goes to the draft.
  - Preview tokens: valid → draft; expired, tampered or for another page → 404.
- **B8.2:**
  - The subdomain is created at signup.
  - Rename: reserved labels and labels taken by another clinic are refused, and the old label is released.
  - Custom domain:
    - FREE plan → 403;
    - a domain another clinic already holds → 409;
    - root domain, IP or reserved host → 422;
    - failed check → `FAILED` with the reason;
    - verified → resolves;
    - primary → the subdomain becomes an alias.
  - CORS:
    - preflights pass for the subdomain and the verified https domain;
    - preflights are refused for unverified, http and look-alike origins;
    - HSTS is one year;
    - `trust proxy` honours `TRUST_PROXY`.
- **B8.7:** page, domain and image limits per plan; the badge is removable only on GROWTH and up.

### 4.4 Frontend e2e (mocked API)

```bash
# frontend/, terminal 1
NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 NEXT_PUBLIC_SITE_ROOT_DOMAIN=localhost corepack pnpm run build && node scripts/e2e-server.js 4310
# terminal 2
E2E_EXTERNAL_SERVER=1 corepack pnpm exec playwright test
# → 25 passed, 8 skipped (the opt-in live specs of C3, C5 and C8, which need a running API)
```

The 25 include C1, C3 and C5's suites (for example `rx-cart.spec.ts`). `e2e/site-builder.spec.ts` (6 tests) runs against a mock API built on the **real backend templates** (`e2e/siteMock.ts`):

1. **Gallery:** five templates, full-screen preview with page tabs and device widths.
2. **Install → edit → autosave:** the draft stays private until Publish, then goes live.
3. **Keyboard reorder, undo, and the draft preview link.** Reordering uses @dnd-kit's keyboard sensor.
4. **SEO** on the clinic host: title, canonical, JSON-LD and the sitemap.
5. **Custom domain:** DNS records, a failed check, then verified.
6. **Contact form** on the live site → the enquiries inbox.

### 4.5 Domain posture of today's hosts

```bash
cd backend
npx ts-node --transpile-only scripts/check-domain-posture.ts medoflow-web.advertout-medoflow.workers.dev medoflow-backend-6pd5.onrender.com
```

```
FAIL  workers.dev  TLSv1 / TLSv1.1 accepted          ← fixed by the custom domain + Minimum TLS 1.2 (owner step)
PASS  workers.dev  TLSv1.2 / 1.3 valid, HSTS 1 y, http → https 301
PASS  onrender.com TLSv1 / 1.1 refused, 1.2 / 1.3 valid, http → https 301
FAIL  onrender.com HSTS max-age=15552000 (180 days)  ← the deployed build predates this branch; helmet now sends 1 year
```

Measured on 2026-10-22: a `*.pages.dev` host (`cloudflare-docs.pages.dev`) refuses TLS 1.0/1.1 and accepts 1.2/1.3. That is why the hosting plan (`arh-agent-docs/cloudflare-custom-domains-setup-guide.md`) serves the app and every clinic from `medoflow.pages.dev` and `<clinic>.medoflow.pages.dev` through a Pages front door, then switches `workers.dev` off.

### 4.6 Live front-end ↔ back-end check (no mocks)

**Setup:**

- **Backend:** the real API on `:4302` against `mf_c8`.
  - Connected as `medoflow_app`, so RLS is enforced.
  - Field encryption is on, with a throwaway key.
  - `SITE_ROOT_DOMAIN=localhost`, `DOMAIN_PROVIDER=manual`.
- **Frontend:** the production build on `:4310`, `NEXT_PUBLIC_SITE_ROOT_DOMAIN=localhost`.
- **Host routing:** clinic sites are reached at **`http://<clinic-slug>.localhost:4310`**. Chromium resolves `*.localhost` to loopback, so this is the real middleware → API → SSR path, without DNS.

```bash
cd frontend
set -a; . ../backend/.env.live.local; set +a     # throwaway env, as in §9.2 (gitignored)
E2E_LIVE_API=http://127.0.0.1:4302 E2E_LIVE_SEED="$(cat <seed json>)" E2E_LIVE_PASSWORD=… E2E_EXTERNAL_SERVER=1 \
  corepack pnpm exec playwright test e2e/live-site.spec.ts
```

```
✓ template → edit → publish: the clinic subdomain serves the branded site (SSR, SEO)
✓ a draft edit stays private until it is published again
✓ contact form on the clinic host → sealed enquiry → audited read in the inbox
✓ images upload through a presigned URL; the free plan shows its subdomain and locks custom domains
4 passed
```

After the sync (Next.js 16), the same spec passed 4/4 (1.1 min) against the **dev server on `http://localhost:3000`** (Turbopack), started exactly as in §9.3 (`E2E_BASE_URL=http://localhost:3000`). That is the setup the manual guide uses.

What the first test asserts:

- Before publishing, `http://<slug>.localhost:4310/` is a real **404**.
- After install (Heritage), editing the hero and publishing, the page renders the new `<h1>`.
- `<link rel="canonical">` points at the subdomain, and the JSON-LD is `MedicalClinic`.
- The seeded service is listed.
- `/s/<slug>/team` on the app host **308s** to `http://<slug>.localhost:4310/team`.
- The sitemap lists the subdomain URLs.

### 4.7 No secrets in the change

- `gitleaks` is not installed on this machine. CI's "Secret scan (git history)" step runs it on the PR.
- A regex sweep (AWS/R2 keys, Cloudflare tokens, private keys, 64-hex strings, Stripe, Slack/GitHub tokens) over all changed and new files found nothing.
  - `CF_API_TOKEN`, `CF_ZONE_ID` and `SITE_PREVIEW_SECRET` appear only as empty placeholders in `.env.example` and as names in `render.yaml` comments.
- Fixtures use `example.test` / `*.test` hosts and synthetic names. `check-synthetic-fixtures.js` passes.
- Throwaway env and seed files lived in gitignored paths (`backend/.env.*.local`, `backend/uploads/`). The live-run password file was kept outside the repo.

### 4.8 What each screen looks like

| Screen          | Where                                                | What you should see                                                                                                                                                                                                                                             |
| --------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview        | Sidebar › **Website** › Overview (`/dashboard/site`) | Live/draft badge, the site URL with Copy/Open, a setup checklist, a pages table with status, **Publish site**                                                                                                                                                   |
| Templates       | `/dashboard/site/templates`                          | 5 cards (Clarity, Serenity, Vitality, Heritage, Botanica); **Preview** opens a full-screen preview with page tabs and Desktop/Tablet/Mobile; **Use this template** → "Replace my pages" or "Apply the look only" (the choice appears once the clinic has pages) |
| Editor          | `/dashboard/site/editor?page=…`                      | Left: page picker, sections (drag handle, eye, duplicate, delete, **Add section**), Theme / Brand / Menus tabs. Centre: the page in a device frame. Right: the inspector. Top: undo/redo, "All changes saved", Preview, Publish                                 |
| Media           | `/dashboard/site/media`                              | Drop zone, grid with alt text, "in use" badges                                                                                                                                                                                                                  |
| Domains         | `/dashboard/site/domains`                            | Your free address `<slug>.<root>`; custom domains with the CNAME and TXT records, Verify, Make primary; on FREE: "Custom domains are on paid plans"                                                                                                             |
| Redirects       | `/dashboard/site/redirects`                          | Automatic (from renames) and manual redirects; add; CSV import                                                                                                                                                                                                  |
| Enquiries       | `/dashboard/site/leads` (owner, front desk)          | List with unread count; opening one shows the message (audited); Archive                                                                                                                                                                                        |
| The clinic site | `http://<slug>.localhost:3000` (local)               | The template with the clinic's data, sticky header, booking CTA, footer with "Powered by MedoFlow" on FREE/STARTER                                                                                                                                              |

---

## 5. Design notes

The full decision records are ADR 0004 and ADR 0005. In short:

- **Drafts and published copies everywhere.**
  - Settings and pages each keep a draft and a live copy. The public renderer reads only the live one, and Publish is the only path between them.
  - Previews use a signed, page-bound, 30-minute token.
- **Templates are code, installed as data.** Reviewed and tested like code, then copied into the clinic's draft. Pages are never hard-deleted by an install.
- **A closed content model.**
  - 17 section types with strict schemas and no HTML.
  - Links are typed and resolved at render time. External links are https/mailto/tel only.
  - Embeds are allow-listed, and images are either our uploads or bundled samples.
- **One route registry, two mirrors, shared test cases.** Every URL is built from the registry. Renames create 301s, and paths are normalised.
- **One Worker for every clinic.**
  - A subdomain is a row; a custom domain is an API call (Cloudflare for SaaS).
  - The host decides the site, and only verified hosts count.
  - Each site has exactly one canonical origin.
- **Minimum necessary in public.** The render payload carries only what the page's sections show. Enquiries are PHI: sealed, read-audited, never e-mailed.
- **The C5 scope guard holds on websites too.** Prescription-only products never appear on a clinic site: not in the store, not as a product page, not in a link, not in the sitemap.

---

## 6. What you must do manually

| #   | Who                   | Step                                                                                                                                                                      | How to verify                                                                                                                   |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Owner                 | Give the Cloudflare token Pages access; add the front door (`frontend/cf-front-door/`) and its two workflows; create `https://medoflow.pages.dev` (setup guide Steps 2–5) | The run summary shows `https://medoflow.pages.dev`; _Settings › Bindings_ lists `APP → medoflow-web` for Production and Preview |
| 2   | Owner                 | Set the GitHub and Render variables, then re-run _CI / Deploy_ (setup guide Steps 6–7)                                                                                    | `https://medoflow.pages.dev` shows the app; sign-in survives a reload                                                           |
| 3   | Owner                 | Each clinic publishes; run _Front door (Pages)_ with its label (setup guide Step 8); then switch off `workers.dev` (Step 10)                                              | `https://<label>.medoflow.pages.dev` renders that clinic’s site                                                                 |
| 4   | Owner                 | `check-domain-posture` on `medoflow.pages.dev`, a clinic host and the API, plus the behaviour checks (setup guide Step 9)                                                 | Every line **PASS**; paste the output in the PR. Re-word the B8.2 AC: there is no own domain                                    |
| 5   | Owner                 | Apply `20261020000000_clinic_site_platform` on Neon (`prisma migrate deploy` with the owner URL)                                                                          | `prisma migrate status` → up to date; every clinic has a `SiteDomain` subdomain row after its first site visit                  |
| 6   | CTO, Security Officer | Sign ADR 0004 and ADR 0005                                                                                                                                                | Signature tables filled                                                                                                         |
| 7   | You                   | Say the word and I commit to `feat/c8-website-builder` and open the PR into `development` on `team`                                                                       | CI green on the PR                                                                                                              |

**Declare B8/F8 complete when** steps 1–6 are done and the PR is merged with CI green.

---

## 7. Review checklist and HIPAA §2 per-change gate

| Item                      | Answer                                                                                                                                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Correctness**           | Publish copies draft → live and writes a revision in one transaction. Restore goes to the draft. Slug renames create 301s, collapsing chains and refusing loops. Host cache is invalidated on every domain change.                                        |
| **AuthZ**                 | Website editing: SUPER_ADMIN + MARKETING. Domains: SUPER_ADMIN only. Enquiries: SUPER_ADMIN + FRONT_DESK. Every other role gets 403 (tests).                                                                                                              |
| **Tenant scoping**        | The 6 new models are in `CLINIC_SCOPED_MODELS` with RLS policies (`SiteLead` is also hard-delete protected). Public routes scope by the clinic resolved from the host. Cross-clinic access returns 404 in enforce mode.                                   |
| **Audit**                 | `SITE_*` actions for every write, domain check, publish and enquiry read. Ids and slugs only, never enquiry text (§9 D-4).                                                                                                                                |
| **PHI in logs**           | Enquiry fields are never logged. The notification e-mail carries no message. Public errors carry codes only.                                                                                                                                              |
| **PHI in URLs**           | None. Site URLs carry slugs and ids; enquiries are posted in the body.                                                                                                                                                                                    |
| **Minimum necessary**     | The render payload carries only what the page's sections show. No provider e-mail, no inventory internals, no plan in public responses (§9 B-30). Prescription-only products never reach a site (§9 B-31, W-7; ADR 0003 scope guard).                     |
| **Encryption at rest**    | `SiteLead` name, e-mail, phone and message are sealed with the ADR 0002 envelope (§9 D-2). Website images are public by design and are kept in a separate store from patient files; the API refuses to start if the two buckets are the same.             |
| **New vendor / PHI path** | **Cloudflare for SaaS** (same vendor as the Worker) terminates TLS for clinic domains. Clinic sites are marketing content, **but the contact form can carry PHI**: keep it off for real clinics until the PHI gate (ADR 0001) opens. No other new vendor. |
| **Fixtures**              | Synthetic only (`example.test`, `*.test`, `Synthetic …`).                                                                                                                                                                                                 |

---

## 8. Known limits and open items

- **No real DNS from this machine.** Everything domain-related is proven locally:
  - `*.localhost` host routing;
  - a manual-provider check that fails as expected without DNS;
  - a stubbed Cloudflare API in unit tests.
    The live TLS/HSTS evidence is owner step §6 #4.
- **Workers Free quota.** Clinic sites share 100k requests/day and 10 ms CPU per request; through the Pages front door every request (including JS/CSS) counts (setup guide, limits at the top). Move to Workers Paid, or buy a domain, before real traffic.
- **No own domain.** B8.2’s “own custom domain” wording can’t be met without buying one. `medoflow.pages.dev` and `onrender.com` do meet TLS ≥ 1.2 + HSTS; the AC needs re-wording.
- **Apex clinic domains** need CNAME flattening at the clinic's DNS provider; otherwise they use `www` (only relevant once clinic-owned domains are supported).
- **`DOMAIN_PROVIDER=manual` issues no certificates.** It is for local and staging use only.
- **Next.js dev-server quirk (local only).** On `localhost:3000`, `<clinic>.localhost:3000/dashboard` redirects to itself, because Next's dev server shortens a redirect to its own origin into a relative path. On real hosts the app (`app.<root>`) and clinic hosts differ, so the 307 is absolute. The rule is unit-tested.
- **The contact form is PHI** and stays synthetic-only until the PHI gate opens.
- **Signing in across hosts, locally.** On this machine `localhost` and `<clinic>.localhost` are different sites to the browser. A session started on the app host therefore does not follow a patient onto the clinic host; they sign in again with the site's account icon (§9.5 F-12). On `pages.dev`, `medoflow.pages.dev` and `<clinic>.medoflow.pages.dev` are one site, so the session should carry over; that is a post-deploy check (`arh-agent-docs/after-deploy-test.md`).
- **`middleware.ts` is deprecated in Next.js 16** (§2 #13). Move to `proxy.ts` once OpenNext supports the Node.js runtime on Workers.
- **Leftovers to delete:** `components/PatientHubModal.tsx` and `PatientWelcomeCard.tsx` are no longer used, but were left alone because a parallel branch (timezone work) edits them.
- **Old data-URL logos** still render through `legacyLogoUrl`. Moving them into `SiteAsset` is a follow-up ops script.

---

## 9. Manual local testing guide

Follow this guide to check by hand that every Component 8 function works on your machine, both backend and frontend.

**Time needed:** about 10 minutes for setup, 20 for the curl and database checks, and 20 for the browser.

- **Validated:** every terminal command below (§9.2–§9.4, §9.6, §9.8) was run verbatim on 2026-10-23 against this branch (synced with `development` @ `e3e2233`, Next.js 16), in Git Bash, starting from the §9.2 step 0 reset. The "Expect" values are the recorded results; slugs, ids and tokens differ per run.
  - The browser steps (§9.5) were driven with Playwright on the same dev setup (`localhost:3000` + the API from `.env.manual.local`) and passed.
- **Data:** synthetic only, in a dedicated local database (`mf_manual_site`).

Each check has an id: `B-…` backend API, `W-…` website over HTTP (curl), `F-…` frontend in the browser, `D-…` database. Tick them off in the **result sheet (§9.9)**; any ✗ is a defect. If something fails, look in **§9.10 Troubleshooting** first.

**What you will test**

| Function                                                            | Backend          | Website / browser | Database |
| ------------------------------------------------------------------- | ---------------- | ----------------- | -------- |
| Templates and site settings (B8.3, F8.3)                            | B-1, B-2, B-5    | F-1, F-2          | D-3      |
| Who may edit (roles, other clinics)                                 | B-4, B-14        | —                 | D-7      |
| Drafts never public; preview link; publish (B8.1, B8.6, F8.1, F8.2) | B-3, B-6 – B-9   | F-3 – F-7         | D-3      |
| Renames, unpublish, revisions, unsafe content (B8.4, B8.6)          | B-10 – B-13      | W-3               | D-5      |
| Subdomain + custom domain + CORS + HSTS (B8.2, F8.4)                | B-15 – B-23      | W-5, F-10         | D-1, D-6 |
| Images (B8.5, F8.5)                                                 | B-24 – B-26      | F-8               | —        |
| Enquiries (B8.5, F8.5)                                              | B-27, B-28, B-32 | F-9, F-11         | D-2, D-4 |
| SEO, sitemap, every route kind, real status codes (B8.6, F8.6)      | B-29             | W-1 – W-6         | —        |
| Public API minimum-necessary; no prescription products (B8.5, B5.5) | B-30, B-31       | W-7, F-12         | —        |
| A patient on the clinic site: sign in, cart, stay signed in         | —                | F-12              | —        |

### 9.1 Before you start

You need:

- Docker Desktop running, with the `mf-pg` Postgres container (B0 walkthrough §4.0 creates it);
- Node 20 or later;
- Git Bash;
- Chrome;
- this branch checked out with dependencies installed (`corepack pnpm install` at the repo root).

Ports used:

- `55432`: Postgres (`mf-pg` container)
- `4302`: API
- `3000`: frontend

> ⚠️ **Run every terminal command in Git Bash**, not PowerShell or Command Prompt. The commands use bash syntax (`VAR=value cmd`, `$( … )`, functions, heredocs).
>
> - **Three terminals.** You need three Git Bash windows or tabs, all started in the repo (`cd /e/advertout/MedoFlow`):
>   - **terminal 1:** backend;
>   - **terminal 2:** frontend;
>   - **terminal 3:** setup, the curl checks and the database checks.
> - **Pasting.** In the standalone Git Bash window, paste with **Shift+Insert** or right-click → **Paste**; Ctrl+V does not paste there. Paste each code block whole.

> **Git Bash on Windows: the commands call `node.exe`, not `node`, on purpose.**
>
> - In an interactive Git Bash window, `node` is an alias for `winpty node.exe`.
> - winpty refuses to run inside `$( … )` or a pipe. It prints `stdout is not a tty` and returns nothing, so the variables come out empty.
> - Keep `node.exe` when you copy these commands.

> **Clinic sites live at `http://<clinic-slug>.localhost:3000`.** Chrome and curl send every `*.localhost` name to your own machine, so no DNS or hosts-file change is needed. **Use `localhost` for the app and the API**, never `127.0.0.1`: the sign-in cookie only survives a reload when the page and the API share the host name.

> **Start the apps from an uppercase drive path** (`cd /e/advertout/MedoFlow/...`, as written below). If the terminal's directory is `e:\…` with a lowercase drive (common in VS Code), `next dev` bundles the router twice. Every page then fails with `invariant expected app router to be mounted` (§9.10).

### 9.2 One-time setup (terminal 3)

**0. Reset: start from a clean slate.** Run this every time you start the guide, including the first time.

- It stops anything left over from an earlier run.
- It deletes the previous run's throwaway files.
- It drops and recreates the dedicated manual-test database **`mf_manual_site`**, an empty copy just for this guide. Your dev data (`medoflow`), the integration-test databases and other components' manual databases (`mf_manual`) are never touched.

First stop any backend or frontend still running from a previous session: press Ctrl+C in terminals 1 and 2. Then, in terminal 3:

```bash
cd /e/advertout/MedoFlow/backend
# Stop anything still listening on the API / frontend ports (no output = nothing was running)
powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 4302,3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue; 'stopped process ' + \$_ }"
# Remove the previous run's throwaway files
rm -f .env.manual.local uploads/.manual-seed-*.json uploads/.manual-signin-c.txt uploads/.manual-pixel.png uploads/.manual-intent*.json
# Drop and recreate the manual-test database
docker start mf-pg
DB=mf_manual_site
case "$DB" in mf_manual|mf_manual_*) ;; *) echo "✗ refusing to drop $DB — the reset only drops mf_manual*"; DB=;; esac
[ -n "$DB" ] && docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
```

Expect:

- `stopped process <pid>` for each app that was still running; nothing if none was;
- `mf-pg`;
- `DROP DATABASE`, then `CREATE DATABASE`. On the very first run, a harmless `NOTICE: database "mf_manual_site" does not exist, skipping` comes in between.

**1. Apply the migrations and enable the app role.** Every later step uses the database chosen in step 0, through `MANUAL_DB` in the env file.

```bash
# same terminal as step 0 (uses $DB)
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB corepack pnpm exec prisma migrate deploy
docker exec mf-pg psql -U postgres -c "ALTER ROLE medoflow_app WITH LOGIN PASSWORD 'app_local_pw'"
```

Expect:

- `All migrations have been successfully applied.`, with `20261020000000_clinic_site_platform` the last one (after C5's `20261017000000_rx_to_cart`). Prisma may also print `Environment variables loaded from .env`; that is harmless, because the `DATABASE_URL` on the command line wins;
- `ALTER ROLE`.

**2. A throwaway env file for this test.**

- `backend/.env.manual.local` is gitignored (`.env.*.local`), so it can never be committed. Your normal `backend/.env` is not touched.
- `SITE_ROOT_DOMAIN=localhost` makes every clinic's site live at `<slug>.localhost`.
- `DOMAIN_PROVIDER=manual` checks DNS records itself; no Cloudflare token is needed.
- `REFRESH_COOKIE_SAMESITE=none` is what production uses. It lets a patient who signs in **on a clinic site** stay signed in after a reload (F-12).

```bash
# still in backend/, same terminal as steps 0–1 (uses $DB)
H() { node.exe -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"; }
cat > .env.manual.local <<ENV
# Local manual testing only (gitignored). Throwaway values.
PORT=4302
NODE_ENV=development
MANUAL_DB=${DB:?set DB first (step 0)}
DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/${DB}
CORS_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:4302
JWT_SECRET=$(H)
MFA_ENCRYPTION_KEY=$(H)
FIELD_ENCRYPTION_PROVIDER=env
FIELD_ENCRYPTION_KEYS=k1:$(H)
FIELD_ENCRYPTION_ACTIVE_KID=k1
FILE_BLOB_SIGNING_SECRET=$(H)
SITE_PREVIEW_SECRET=$(H)
SITE_ROOT_DOMAIN=localhost
SITE_PUBLIC_PORT=3000
DOMAIN_PROVIDER=manual
REFRESH_COOKIE_SAMESITE=none
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
REDIS_URL=
TENANT_ISOLATION_MODE=enforce
MANUAL_PASSWORD=Synthetic-Manual-$(node.exe -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
ENV
# Self-check: every required value must be present and non-empty.
bad=0; for re in '^MANUAL_DB=.' '^DATABASE_URL=.*/[A-Za-z_]+$' '^JWT_SECRET=.' '^MFA_ENCRYPTION_KEY=.' \
  '^FILE_BLOB_SIGNING_SECRET=.' '^FIELD_ENCRYPTION_KEYS=k1:.' '^SITE_PREVIEW_SECRET=.' '^MANUAL_PASSWORD=Synthetic-Manual-.'; do
  grep -qE "$re" .env.manual.local || { echo "✗ missing/empty: $re"; bad=1; }
done; [ $bad = 0 ] && echo "✓ env file OK" || echo "→ fix the cause above (DB set? node.exe?) and re-run this block"
grep -E '^(MANUAL_DB|MANUAL_PASSWORD)=' .env.manual.local
```

Expect:

- `✓ env file OK`;
- `MANUAL_DB=mf_manual_site`;
- a line like `MANUAL_PASSWORD=Synthetic-Manual-1a2b3c4d`. **This is the password of every seeded user**, browser included.

If you saw `stdout is not a tty` or `DB: set DB first`, the file is incomplete. Set `DB=mf_manual_site` (step 0) and re-run the whole block; it overwrites the file.

What these settings mean:

- **The API connects as `medoflow_app`**, so row-level security is enforced exactly as in production.
- **Field encryption is on** with a throwaway key, so enquiries are sealed.
- **No S3 keys:** website images go to the local driver and are served by the API.
- **No Redis:** the AI-scribe queue logs connection errors; nothing in this guide needs it.

**3. Three synthetic clinics.**

| Clinic | Used for                         |
| ------ | -------------------------------- |
| **A**  | the curl checks (§9.4)           |
| **B**  | "another tenant"                 |
| **C**  | everything in the browser (§9.5) |

```bash
set -a; . ./.env.manual.local; set +a
for c in a b c; do
  E2E_LIVE_PASSWORD=$MANUAL_PASSWORD DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$MANUAL_DB \
    corepack pnpm exec ts-node --transpile-only scripts/seed-e2e-live.ts > uploads/.manual-seed-$c.json
done
for c in a b c; do node.exe -e "const s=require('./uploads/.manual-seed-$c.json');console.log('clinic $c:', s.clinicSlug, s.clinicId, s.emails.admin)"; done
echo "seeded into: $MANUAL_DB"   # must match MANUAL_DB / DATABASE_URL in .env.manual.local
```

Expect three `clinic a|b|c: live-<6 hex> <id> admin.live-<6 hex>@example.test` lines, then `seeded into: mf_manual_site`.

Each clinic gets (the seed is shared with C3 and C5):

- **People**, all with the password `$MANUAL_PASSWORD`:

  | Role                | Name shown in the app      | Email pattern                        |
  | ------------------- | -------------------------- | ------------------------------------ |
  | Owner (SUPER_ADMIN) | Synthetic Admin            | `admin.live-<6 hex>@example.test`    |
  | Provider            | **Dr. Synthetic Provider** | `provider.live-<6 hex>@example.test` |
  | Patient             | **Quinn Marlowe**          | `patient.live-<6 hex>@example.test`  |

- one location, and one service **Consult**;
- five products: Magnesium Glycinate, Arnica Gel, Retinol Night Serum, Turmeric Curcumin, and **Tramadol**, classified _Prescription (scheduled)_. Tramadol must never appear on a website (B-31, W-7);
- the **FREE** plan.

**4. Print your browser sign-in sheet (clinic C).** It prints every login and URL that §9.5 uses, with clinic C's values filled in. Each **sign-in link** opens the login form and, after you sign in, goes straight to that page. Re-run this block whenever you need the sheet again.

```bash
set -a; . ./.env.manual.local; set +a
node.exe -e "
const s=require('./uploads/.manual-seed-c.json'), W='http://localhost:3000', P=process.env.MANUAL_PASSWORD;
const go=(p)=>W+'/?auth=login&returnUrl='+encodeURIComponent(p), SITE='http://'+s.clinicSlug+'.localhost:3000';
console.log('PASSWORD (every user)   '+P+'\n');
console.log('CLINIC C website        '+SITE+'   (subdomain label: '+s.clinicSlug+')\n');
console.log('OWNER     '+s.emails.admin+'\n  F-1  sign-in link:  '+go('/dashboard/site')+'\n');
console.log('PATIENT   '+s.emails.patient+'\n  F-12 clinic store:  '+SITE+'/store');
" | tee uploads/.manual-signin-c.txt
```

Expect output shaped like this; your slug, emails and password differ:

```
PASSWORD (every user)   Synthetic-Manual-1a2b3c4d

CLINIC C website        http://live-9f3c21.localhost:3000   (subdomain label: live-9f3c21)

OWNER     admin.live-9f3c21@example.test
  F-1  sign-in link:  http://localhost:3000/?auth=login&returnUrl=%2Fdashboard%2Fsite

PATIENT   patient.live-9f3c21@example.test
  F-12 clinic store:  http://live-9f3c21.localhost:3000/store
```

The sheet is also saved to `backend/uploads/.manual-signin-c.txt` (gitignored). Keep it open next to the browser.

### 9.3 Start the apps

**Terminal 1 — backend**

```bash
cd /e/advertout/MedoFlow/backend
set -a; . ./.env.manual.local; set +a
corepack pnpm exec ts-node --transpile-only src/server.ts
```

Wait for these lines (30–60 s):

```
[field-encryption] keys loaded (active "k1", 1 total)
[db] connected as "medoflow_app" — row-level security is enforced
Medoflow server running on port 4302 (development)
```

These are expected and harmless: `[WARN]` lines about S3, Stripe and alerts, and repeated `AggregateError … internalConnectMultiple` lines from the AI-scribe queue looking for Redis.

**Terminal 2 — frontend**

```bash
cd /e/advertout/MedoFlow/frontend
NEXT_PUBLIC_API_URL=http://localhost:4302 NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_PUBLIC_SITE_ROOT_DOMAIN=localhost corepack pnpm dev
```

- Expect `▲ Next.js 16.4.2 (Turbopack)` and `✓ Ready`, then open `http://localhost:3000`.
- A warning that the `middleware` file convention is deprecated is expected (§2 #13).
- The first page you open takes 10–30 s to compile; later pages are faster.
- `NEXT_PUBLIC_*` values are read when the dev server starts. If you change them, stop it (Ctrl+C) and run the block again.

### 9.4 Backend checks with curl (terminal 3)

Paste this helper block once into terminal 3. It loads the env, reads the seed files and signs three users in. If you open a new terminal later, paste it again there: the helpers only exist in the window where you pasted them.

```bash
cd /e/advertout/MedoFlow/backend
set -a; . ./.env.manual.local; set +a
API=http://localhost:4302/api/v1
A() { node.exe -p "require('./uploads/.manual-seed-a.json').$1"; }
B() { node.exe -p "require('./uploads/.manual-seed-b.json').$1"; }
j() { node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let o=JSON.parse(d);for(const k of process.argv[1].split('.'))o=o?.[k];console.log(typeof o==='object'?JSON.stringify(o):o)})" "$1"; }
call() { local t=$1; shift; curl -s -H 'Content-Type: application/json' -H 'x-medoflow-client: web' -H "Authorization: Bearer $t" "$@"; }
code() { local t=$1; shift; curl -s -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' -H 'x-medoflow-client: web' -H "Authorization: Bearer $t" "$@"; }
login() { curl -s $API/auth/login -H 'Content-Type: application/json' -H 'x-medoflow-client: web' -d "{\"email\":\"$1\",\"password\":\"$MANUAL_PASSWORD\"}" | j data.accessToken; }
HOST=$(A clinicSlug).localhost
render() { curl -s "$API/public/sites/render?host=${H:-$HOST}&path=$1${2:+&preview=$2}"; }
rcode() { curl -s -o /dev/null -w '%{http_code}\n' "$API/public/sites/render?host=${H:-$HOST}&path=$1${2:+&preview=$2}"; }
hero() { render "$@" | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.data?.page?.sections?.find(x=>x.type==='hero')?.settings.headline ?? o.data?.route?.key)})"; }
page() { call $ADM $API/site/pages | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.items.find(p=>p.slug===process.argv[1]).id))" "$1"; }
headline() { call $ADM $API/site/pages/$1 | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d).data.sections;s.find(x=>x.type==='hero').settings.headline=process.argv[1];console.log(JSON.stringify({sections:s}))})" "$2" | call $ADM -X PUT $API/site/pages/$1 -d @- | j data.hasUnpublishedChanges; }
doms() { call $ADM $API/site/domains | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{for(const x of JSON.parse(d).data.domains)console.log([x.kind,x.hostname,x.status,x.isPrimary?'primary':'-'].join(' | '))})"; }
domid() { call $ADM $API/site/domains | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.domains.find(x=>x.kind===process.argv[1]).id))" "$1"; }
PSQL="docker exec mf-pg psql -U postgres -d $MANUAL_DB -At -c"
ADM=$(login "$(A emails.admin)"); PROV=$(login "$(A emails.provider)"); BADM=$(login "$(B emails.admin)")
echo "${#ADM} ${#PROV} ${#BADM}"     # three numbers around 300 = three tokens
```

Expect three numbers around 300. A `0` means that login failed; see §9.10.

`render /path` asks the API for clinic A's page exactly as its website would (`?host=<slug>.localhost`). `rcode` prints only the status code.

**Site and templates (B8.3, B8.7)**

```bash
# B-1  the site exists from the first request, on the free plan, at its subdomain
call $ADM $API/site | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d).data;console.log(s.urls.canonical, s.urls.appPath, JSON.stringify(s.entitlements), s.pages.length)})"
# B-2  the template gallery
call $ADM $API/site/templates | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.items.map(t=>t.key+'('+t.pages.length+')').join(' ')))"
# B-3  nothing is published yet: the clinic host is a real 404
rcode /
# B-4  a provider is not a website editor
code $PROV $API/site
code $PROV -X POST $API/site/templates/heritage/install -d '{"mode":"replace"}'
# B-5  install the Heritage template (replace mode)
call $ADM -X POST $API/site/templates/heritage/install -d '{"mode":"replace"}' | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d).data;console.log(s.templateKey, s.pages.map(p=>p.kind+':'+p.slug+':'+p.status).join(' '))})"
HOME_ID=$(page home); NEWP=$(page new-patients)
```

| Check | Expect                                                                                                                                    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| B-1   | `http://<slug>.localhost:3000 http://localhost:3000/s/<slug> {"maxPages":8,"maxCustomDomains":0,"canRemoveBadge":false,"maxAssets":40} 0` |
| B-2   | `clarity(6) serenity(7) vitality(6) heritage(6) botanica(6)`                                                                              |
| B-3   | `404`                                                                                                                                     |
| B-4   | `403` `403`                                                                                                                               |
| B-5   | `heritage HOME:home:DRAFT SERVICES:services:DRAFT TEAM:team:DRAFT STANDARD:new-patients:DRAFT CONTACT:contact:DRAFT LEGAL:privacy:DRAFT`  |

**Drafts, preview and publish (B8.1, B8.6)**

```bash
# B-6  edit the home page draft: still not public
headline $HOME_ID "Synthetic family care, version one"
rcode /
# B-7  a signed preview link shows the draft; a tampered token does not
TOKEN=$(call $ADM $API/site/preview-link -d "{\"pageId\":\"$HOME_ID\"}" | j data.token)
hero /preview/$HOME_ID $TOKEN
rcode /preview/$HOME_ID ${TOKEN}x
# B-8  publish the whole site
call $ADM -X POST $API/site/publish -d '{"pageIds":"all"}' | j data.version
rcode /; hero /; rcode /services; rcode /team; rcode /new-patients; rcode /contact; rcode /legal/privacy
# B-9  a later draft edit stays private
headline $HOME_ID "Synthetic family care, version two"
hero /
```

| Check | Expect                                                                       |
| ----- | ---------------------------------------------------------------------------- |
| B-6   | `true` (unpublished changes), then `404`                                     |
| B-7   | `Synthetic family care, version one`, then `404`                             |
| B-8   | `1`, then `200`, `Synthetic family care, version one`, then `200` five times |
| B-9   | `true`, then still `Synthetic family care, version one`                      |

**Renames, unpublish, revisions, unsafe content, other tenants (B8.1, B8.4, B8.6)**

```bash
# B-10 rename a page: the old URL 301s to the new one
call $ADM -X PUT $API/site/pages/$NEWP -d '{"slug":"new-patient-guide"}' | j data.path
call $ADM -X POST $API/site/pages/$NEWP/publish | j data.status
render /new-patients | j data.redirect
rcode /new-patient-guide
# B-11 unpublish hides it
call $ADM -X POST $API/site/pages/$NEWP/unpublish | j data.status
rcode /new-patient-guide
# B-12 publish v2, list revisions, restore v1 into the draft (the live page keeps v2)
call $ADM -X POST $API/site/pages/$HOME_ID/publish | j data.version
call $ADM $API/site/pages/$HOME_ID/revisions | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.items.map(r=>'v'+r.version).join(' ')))"
call $ADM -X POST $API/site/pages/$HOME_ID/revisions/1/restore | j data.hasUnpublishedChanges
hero /
# B-13 unsafe content is refused: a javascript: link, a reserved slug
call $ADM $API/site/pages/$HOME_ID | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d).data.sections;s.find(x=>x.type==='hero').settings.primaryCta={label:'Go',link:{kind:'external',href:'javascript:alert(1)'}};console.log(JSON.stringify({sections:s}))})" | call $ADM -X PUT $API/site/pages/$HOME_ID -d @- | j code
call $ADM $API/site/pages -d '{"title":"Dash","slug":"dashboard"}' | j code
# B-14 another clinic's admin cannot read or publish clinic A's page
code $BADM $API/site/pages/$HOME_ID
code $BADM -X POST $API/site/pages/$HOME_ID/publish
```

| Check | Expect                                                                                               |
| ----- | ---------------------------------------------------------------------------------------------------- |
| B-10  | `/new-patient-guide`, `PUBLISHED`, `{"type":"redirect","to":"/new-patient-guide","code":301}`, `200` |
| B-11  | `DRAFT`, then `404`                                                                                  |
| B-12  | `2`, then `v2 v1`, then `true`, then `Synthetic family care, version two` (live is unchanged)        |
| B-13  | `site_invalid_section`, then `site_reserved_slug`                                                    |
| B-14  | `404` `404`                                                                                          |

**Addresses: subdomain and custom domain (B8.2, B8.7)**

```bash
# B-15 the subdomain was created automatically and is primary
doms
# B-16 custom domains are a paid-plan feature; on STARTER the domain is added with its DNS records
call $ADM $API/site/domains -d '{"hostname":"www.everwell-synthetic.example"}' | j code
$PSQL "UPDATE \"Tenant\" SET plan='STARTER' WHERE id=(SELECT \"tenantId\" FROM \"Clinic\" WHERE id='$(A clinicId)')"
call $ADM $API/site/domains -d '{"hostname":"WWW.Everwell-Synthetic.example."}' | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const x=JSON.parse(d).data;console.log(x.hostname, x.status);for(const r of x.records)console.log('  '+[r.type,r.name,r.value].join(' '))})"
# B-17 refused: another clinic's domain, the root domain, an IP, a reserved host
$PSQL "UPDATE \"Tenant\" SET plan='STARTER' WHERE id=(SELECT \"tenantId\" FROM \"Clinic\" WHERE id='$(B clinicId)')"
call $BADM $API/site/domains -d '{"hostname":"www.everwell-synthetic.example"}' | j code
for h in localhost 10.0.0.5 api.localhost; do call $ADM $API/site/domains -d "{\"hostname\":\"$h\"}" | j code; done
# B-18 Verify: the TXT record does not exist, so the domain stays unverified
DOM=$(domid CUSTOM)
call $ADM -X POST $API/site/domains/$DOM/verify | j data.lastError
```

| Check | Expect                                                                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-15  | `SUBDOMAIN \| <slug>.localhost \| VERIFIED \| primary`                                                                                                                                                                                                  |
| B-16  | `site_domain_plan`, `UPDATE 1`, then `www.everwell-synthetic.example PENDING` (normalised) and the two records `CNAME www.everwell-synthetic.example sites.localhost` and `TXT _medoflow-verify.www.everwell-synthetic.example medoflow-verify=<token>` |
| B-17  | `UPDATE 1`, `site_domain_taken`, then `site_invalid_domain` three times                                                                                                                                                                                 |
| B-18  | `TXT record _medoflow-verify.www.everwell-synthetic.example not found yet (DNS changes can take up to an hour)`                                                                                                                                         |

`.example` domains can't have real DNS records, so D-1 marks the domain verified directly in the database, as a successful check would. With a domain you own, you could instead create the two records and press Verify.

```bash
# D-1  stand in for DNS: mark the domain verified, as a successful check would
$PSQL "UPDATE \"SiteDomain\" SET status='VERIFIED', \"verifiedAt\"=now(), \"lastError\"=NULL WHERE hostname='www.everwell-synthetic.example'"
# B-19 a verified, non-primary domain is an alias of the primary
curl -s "$API/public/sites/resolve?host=www.everwell-synthetic.example" | j data
# B-20 make it primary: it becomes the canonical origin, and the subdomain the alias
call $ADM -X POST $API/site/domains/$DOM/primary | j message
curl -s "$API/public/sites/resolve?host=www.everwell-synthetic.example" | j data
curl -s "$API/public/sites/resolve?host=$HOST" | j data
H=www.everwell-synthetic.example hero /
# B-21 CORS: app, the subdomain and the verified domain (https) are allowed; nothing else
for o in http://localhost:3000 http://$HOST:3000 https://www.everwell-synthetic.example http://www.everwell-synthetic.example https://www.not-verified.example http://evil-localhost http://a.b.localhost:3000; do
  printf '%-45s %s\n' "$o" "$(curl -s -o /dev/null -D - -X OPTIONS $API/site -H "Origin: $o" -H 'Access-Control-Request-Method: GET' | tr -d '\r' | grep -i '^access-control-allow-origin' | cut -d' ' -f2)"
done
# B-22 HSTS on the API
curl -s -D - -o /dev/null $API/health | tr -d '\r' | grep -i strict-transport
# B-23 back to the subdomain as primary (the website checks below use it)
call $ADM -X POST $API/site/domains/$(domid SUBDOMAIN)/primary | j message
```

| Check | Expect                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1   | `UPDATE 1`                                                                                                                                                                                                                                                                      |
| B-19  | `{"kind":"alias","origin":"http://<slug>.localhost:3000"}`                                                                                                                                                                                                                      |
| B-20  | `Primary domain set`, then `{"kind":"site","clinicSlug":"<slug>","origin":"http://www.everwell-synthetic.example:3000"}`, `{"kind":"alias","origin":"http://www.everwell-synthetic.example:3000"}`, `Synthetic family care, version two`                                        |
| B-21  | an origin echoed back for the first three only: `http://localhost:3000`, `http://<slug>.localhost:3000`, `https://www.everwell-synthetic.example`. The other four lines are empty (refused): plain http on a custom domain, an unverified domain, a look-alike, two labels deep |
| B-22  | `Strict-Transport-Security: max-age=31536000; includeSubDomains`                                                                                                                                                                                                                |
| B-23  | `Primary domain set`                                                                                                                                                                                                                                                            |

> Host lookups are cached for 60 s, and the cache is cleared on every domain change. If you ran `resolve` for the domain **before** D-1, wait a minute before B-19.

**Images, enquiries, sitemap, public data (B8.5, B8.6)**

```bash
# B-24 images: SVG and oversized files are refused before upload
call $ADM $API/site/assets/uploads -d '{"mimeType":"image/svg+xml","size":100}' | j code
call $ADM $API/site/assets/uploads -d '{"mimeType":"image/png","size":99000000}' | j code
# B-25 a real PNG: presigned PUT → complete (dimensions read) → served from the public site-asset store
node.exe -e "process.stdout.write(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'))" > uploads/.manual-pixel.png
call $ADM $API/site/assets/uploads -d "{\"mimeType\":\"image/png\",\"size\":$(wc -c < uploads/.manual-pixel.png),\"alt\":\"Synthetic pixel\"}" > uploads/.manual-intent.json
curl -s -o /dev/null -w '%{http_code}\n' -X PUT "$(j data.upload.url < uploads/.manual-intent.json)" -H 'Content-Type: image/png' --data-binary @uploads/.manual-pixel.png
call $ADM -X POST $API/site/assets/$(j data.assetId < uploads/.manual-intent.json)/complete | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d).data;console.log(a.status, a.width+'x'+a.height, a.url)})"
curl -s -o /dev/null -D - "$(call $ADM $API/site/assets | j data.items.0.url)" | tr -d '\r' | grep -iE '^HTTP|^content-type|^cache-control'
# B-26 bytes that are not a PNG are rejected at "complete"
call $ADM $API/site/assets/uploads -d '{"mimeType":"image/png","size":11}' > uploads/.manual-intent2.json
printf 'not a png!!' | curl -s -o /dev/null -w '%{http_code}\n' -X PUT "$(j data.upload.url < uploads/.manual-intent2.json)" -H 'Content-Type: image/png' --data-binary @-
call $ADM -X POST $API/site/assets/$(j data.assetId < uploads/.manual-intent2.json)/complete | j code
# B-27 contact form: a bot-filled honeypot and a 0.1-second submit are silently dropped; a real one is stored
lead() { curl -s -o /dev/null -w '%{http_code}\n' $API/public/sites/leads -H 'Content-Type: application/json' -d "{\"host\":\"$HOST\",\"name\":\"Synthetic Visitor\",\"email\":\"visitor@example.test\",\"message\":\"Synthetic question about knee pain\",\"startedAt\":$(( $(date +%s%3N) - ${1:-5000} ))${2:+,\"website\":\"$2\"}}"; }
lead 5000 https://spam.example; lead 100; lead 5000
$PSQL "SELECT count(*) FROM \"SiteLead\" WHERE \"clinicId\"='$(A clinicId)'"
# B-28 the inbox: the owner reads the message; a provider and another clinic cannot
LEAD=$(call $ADM $API/site/leads | j data.items.0.id)
call $ADM $API/site/leads | j data.unread
call $ADM $API/site/leads/$LEAD | j data.message
code $PROV $API/site/leads
code $BADM $API/site/leads/$LEAD
# B-29 sitemap: published, indexable pages only, on the canonical origin
curl -s "$API/public/sites/sitemap?host=$HOST" | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.entries.map(e=>e.loc).sort().join('\n')))"
# B-30 the public API is minimum-necessary: no provider e-mail, no plan, no inventory internals
curl -s $API/public/clinics/$(A clinicId)/providers | grep -c '"email"'
curl -s $API/public/clinics | grep -ciE 'subscriptionPlan|"plan"'
curl -s $API/public/clinics/$(A clinicId)/products | grep -ciE 'supplier|batch|expir'
# B-31 the website's store never shows a prescription product (C5 scope guard)
render /store | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.data.products.map(p=>p.name).join(', ')))"
rcode /store/tramadol
```

| Check | Expect                                                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-24  | `site_asset_type`, `site_asset_size`                                                                                                                                                                                                                                                                                                        |
| B-25  | `200`; `AVAILABLE 1x1 http://localhost:4302/api/v1/public/sites/assets/<clinicId>/<assetId>.png`; then `HTTP/1.1 200 OK`, `Content-Type: image/png`, `Cache-Control: public, max-age=31536000, immutable`                                                                                                                                   |
| B-26  | `200` (the upload itself), then `site_asset_rejected`                                                                                                                                                                                                                                                                                       |
| B-27  | `201` `201` `201` (bots learn nothing), then `1`: only the real message was stored                                                                                                                                                                                                                                                          |
| B-28  | `1` (unread), `Synthetic question about knee pain`, then `403`, `404`                                                                                                                                                                                                                                                                       |
| B-29  | 12 URLs on `http://<slug>.localhost:3000`: `/`, `/contact`, `/legal/privacy`, `/services`, `/services/consult`, `/store`, `/store/arnica-gel`, `/store/magnesium-glycinate`, `/store/retinol-night-serum`, `/store/turmeric-curcumin`, `/team`, `/team/synthetic-provider`. Not `/new-patient-guide` (unpublished in B-11), and no Tramadol |
| B-30  | `0` `0` `0`                                                                                                                                                                                                                                                                                                                                 |
| B-31  | `Arnica Gel, Magnesium Glycinate, Retinol Night Serum, Turmeric Curcumin` (no Tramadol), then `404`                                                                                                                                                                                                                                         |

> B-32 (the enquiry rate limit) is in §9.6, **after** the browser checks. It blocks your IP from sending enquiries for 10 minutes.

### 9.5 Website and browser checks

**Website over HTTP (W-…, terminal 3, helpers from §9.4 loaded)**

```bash
SITE=http://$HOST:3000
st() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$@"; }
# W-1 the clinic subdomain is server-rendered with its SEO tags
curl -s $SITE/ | grep -oE '<title>[^<]*|<link rel="canonical"[^>]*>|<meta property="og:url"[^>]*>|"@type":"MedicalClinic"|<h1[^>]*>[^<]*' | head -5
# W-2 every route kind on the clinic host
for p in / /services /services/consult /team /team/synthetic-provider /contact /legal/privacy /store /store/arnica-gel; do printf '%-28s ' $p; st $SITE$p; done
# W-3 URL rules: unknown page 404; trailing slash, upper case and renamed slug redirect; staff routes leave the site
for p in /nope /services/ /About-Us /new-patients /clinic/$(A clinicSlug)/p/team /dashboard/site; do printf '%-28s ' $p; st $SITE$p; done
# W-4 sitemap.xml and robots.txt on the clinic host
curl -s $SITE/sitemap.xml | grep -c '<loc>'
curl -s $SITE/robots.txt
# W-5 the app host: /s/<slug> 308s to the canonical subdomain; the legacy /clinic/<slug> URL too; an unknown clinic host is a 404
st http://localhost:3000/s/$(A clinicSlug)/team
st http://localhost:3000/clinic/$(A clinicSlug)
st http://nobody-here.localhost:3000/
# W-6 the internal render tree is never reachable directly
st http://localhost:3000/clinic-site/$HOST
# W-7 no prescription product page on the website
st $SITE/store/tramadol
```

| Check | Expect                                                                                                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-1   | `<title>Live Clinic <6 hex>`, `<link rel="canonical" href="http://<slug>.localhost:3000/"/>`, the same `og:url`, `"@type":"MedicalClinic"`, `<h1 class="mf-hero-title">Synthetic family care, version two` |
| W-2   | `200` for all nine                                                                                                                                                                                         |
| W-3   | `/nope 404`; `/services/ 308 …/services`; `/About-Us 308 …/about-us`; `/new-patients 308 …/new-patient-guide`; `/clinic/<slug>/p/team 308 …/team`; `/dashboard/site 307 …` (see the note)                  |
| W-4   | `12`, then robots with `Disallow: /preview/`, `/checkout`, `/account`, `/payment` and `Sitemap: http://<slug>.localhost:3000/sitemap.xml`                                                                  |
| W-5   | `308 http://<slug>.localhost:3000/team`; `308 http://localhost:3000/s/<slug>`; `404`                                                                                                                       |
| W-6   | `404`                                                                                                                                                                                                      |
| W-7   | `404`                                                                                                                                                                                                      |

> **W-3 `/dashboard/site` note:** on hosted addresses this is `307 https://medoflow.pages.dev/dashboard/site`. Locally the app is also on `localhost:3000`, and Next's dev server shortens a redirect to its own origin into `/dashboard/site`. You therefore see `307 http://<slug>.localhost:3000/dashboard/site`, which a browser would follow in a loop. This is local-only (§8). The rule itself is unit-tested in `tests/unit/siteRouting.test.ts`.

**Browser (clinic C)**

Use **Chrome, normal window**, for the owner (F-1 – F-11), and a **Chrome Incognito window** (Ctrl+Shift+N) for the patient (F-12). Keep **DevTools (F12) → Network** open with **Preserve log** ticked; if a step fails, the failing request is right there.

**How to sign in:** copy the **sign-in link** from the sheet (§9.2 step 4) into the window and press Enter. The MedoFlow home page opens with a **Sign in** dialog: enter the email and the `PASSWORD (every user)` value, click **Sign in**, and you land on the page named in the link.

| #    | Do                                                                                                                                                                  | Expect                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1  | Open the **OWNER** sign-in link and sign in. You land on **Website › Overview**. In a second tab, open the **CLINIC C website** address from the sheet              | Overview: badge **Not published yet**, the address `<slug>.localhost:3000`, a checklist. The site tab: "There’s no website here" (a real 404)                                               |
| F-2  | **Browse templates** → **Preview** on _Vitality_ (try Desktop/Tablet/Mobile and the page tabs) → close → **Use this template** on _Heritage_ → **Install template** | The preview resizes per device and switches pages. After install you are in the editor with the Heritage home page                                                                          |
| F-3  | In the left panel, click the _Hero_ row (its name); in the inspector on the right change **Headline** to _Browser family care_                                      | The canvas updates as you type; the top bar shows "Saving…", then **All changes saved**                                                                                                     |
| F-4  | Reload the site tab                                                                                                                                                 | Still a 404: nothing is published                                                                                                                                                           |
| F-5  | Tab to a section's drag handle ("Reorder … (position 1 of …)"), press **Space**, **↓**, **Space**; then **Undo** (top bar)                                          | The section moves down one place, then moves back                                                                                                                                           |
| F-6  | **Preview** (top bar)                                                                                                                                               | A new tab on `<slug>.localhost:3000/preview/<id>?token=…` with the draft headline and the banner "Draft preview — visitors don’t see these changes until you publish."                      |
| F-7  | Back to **Overview** › **Publish site**; reload the site tab                                                                                                        | Toast "Your website is live"; the site shows _Browser family care_, the Heritage theme, the menu (Services, Meet us, …) and the **Consult** service. View source: canonical = the subdomain |
| F-8  | **Website** › **Media** › upload a PNG/JPEG under 5 MB; then try an SVG                                                                                             | "Image uploaded" and the thumbnail appear; the SVG is refused before upload: "Use a JPEG, PNG, WebP or GIF image"                                                                           |
| F-9  | On the site tab, open **Contact**, fill name / e-mail / message, wait 3 s, **Send message**                                                                         | "Thank you — a member of our team will reply within one business day."                                                                                                                      |
| F-10 | **Website** › **Domains**                                                                                                                                           | "Your free address" shows `<slug>.localhost`; custom domains show **Custom domains are on paid plans** (FREE plan)                                                                          |
| F-11 | **Website** › **Enquiries** › open the message                                                                                                                      | The full message is shown (the read is audited as `SITE_LEAD_READ`)                                                                                                                         |

**A patient on the clinic site (F-12)** — Chrome Incognito window

| #    | Do                                                                                                                                                                                           | Expect                                                                                                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-12 | Open the **PATIENT › F-12 clinic store** address. Click the **person icon** (top right, "Sign in"), sign in as the patient. Click **Add to cart** on _Arnica Gel_. Then reload the page (F5) | The **Shop** lists Arnica Gel, Magnesium Glycinate, Retinol Night Serum and Turmeric Curcumin, and **no Tramadol**. After **Add to cart**, the cart dialog shows _Arnica Gel_ ($12.50) and **Review order**. After the reload you are still signed in (the person icon goes to **My account**) and the cart icon reads "Open cart — 1 item" |

> Sign in **on the clinic site** for F-12. Locally, a session started on `localhost:3000` does not follow you to `<slug>.localhost:3000`, because the browser treats them as different sites (§8). On the hosted `*.medoflow.pages.dev` addresses it does; that is checked after deployment.

Optional: on clinic C, set the plan to STARTER (as in B-16, with clinic C's id). Then on **Domains**, add `www.<anything>.example`. You see the CNAME and TXT records with Copy buttons, and **Verify** reports the missing TXT record.

### 9.6 Database checks and the rate limit (terminal 3)

```bash
CA=$(A clinicId)
# D-2 the enquiry is sealed at rest
$PSQL "SELECT left(name, 30), left(email, 30), left(message, 30) FROM \"SiteLead\" WHERE \"clinicId\"='$CA'"
# D-3 the audit trail (ids only)
$PSQL "SELECT action, count(*) FROM \"AuditLog\" WHERE \"clinicId\"='$CA' AND action LIKE 'SITE_%' GROUP BY action ORDER BY action"
# D-4 no enquiry text in audit rows
$PSQL "SELECT count(*) FROM \"AuditLog\" WHERE \"clinicId\"='$CA' AND (\"newValue\"::text ILIKE '%knee%' OR \"newValue\"::text ILIKE '%visitor@%')"
# D-5 revisions written on publish; the automatic redirect from the rename
$PSQL "SELECT p.slug, r.version FROM \"SitePageRevision\" r JOIN \"SitePage\" p ON p.id=r.\"pageId\" WHERE r.\"clinicId\"='$CA' AND p.kind='HOME' ORDER BY r.version"
$PSQL "SELECT \"fromPath\", \"toPath\", code, auto FROM \"SiteRedirect\" WHERE \"clinicId\"='$CA'"
# D-6 domains
$PSQL "SELECT kind, hostname, status, \"isPrimary\" FROM \"SiteDomain\" WHERE \"clinicId\"='$CA' ORDER BY kind"
# D-7 row-level security: the app role without a clinic context sees no site rows
docker exec mf-pg psql -U medoflow_app -d $MANUAL_DB -At -c 'SELECT count(*) FROM "Site"' -c 'SELECT count(*) FROM "SiteLead"'
docker exec mf-pg psql -U postgres -d $MANUAL_DB -At -c 'SELECT count(*) FROM "Site"'
# B-32 (run last) the contact form allows 5 messages per 10 minutes per visitor
lead() { curl -s -o /dev/null -w '%{http_code}\n' $API/public/sites/leads -H 'Content-Type: application/json' -d "{\"host\":\"$HOST\",\"name\":\"Synthetic Visitor\",\"email\":\"visitor@example.test\",\"message\":\"Synthetic question\",\"startedAt\":$(( $(date +%s%3N) - 5000 ))}"; }
for i in 1 2 3 4 5 6; do lead; done | sort | uniq -c
```

| Check | Expect                                                                                                                                                                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-2   | `fle:v1:k1:SiteLead.name:s:…\|fle:v1:k1:SiteLead.email:s:…\|fle:v1:k1:SiteLead.message:s:…`                                                                                                                                                                                                  |
| D-3   | `SITE_ASSET_UPLOADED\|1`, `SITE_DOMAIN_ADDED\|1`, `SITE_DOMAIN_CHECK_FAILED\|1`, `SITE_DOMAIN_PRIMARY\|2`, `SITE_LEAD_READ\|1`, `SITE_PAGE_DRAFT_SAVED\|3`, `SITE_PAGE_PUBLISHED\|8`, `SITE_PAGE_RESTORED\|1`, `SITE_PAGE_UNPUBLISHED\|1`, `SITE_PUBLISHED\|1`, `SITE_TEMPLATE_INSTALLED\|1` |
| D-4   | `0`                                                                                                                                                                                                                                                                                          |
| D-5   | `home\|1`, `home\|2`, then `/new-patients\|/new-patient-guide\|301\|t`                                                                                                                                                                                                                       |
| D-6   | `SUBDOMAIN\|<slug>\|VERIFIED\|t` and `CUSTOM\|www.everwell-synthetic.example\|VERIFIED\|f`                                                                                                                                                                                                   |
| D-7   | `0`, `0` as the app role; `2` as the owner role (clinics A and C have opened their website; a site row is created on first use)                                                                                                                                                              |
| B-32  | two counted lines such as `1 201` and `5 429`: at most 5 messages are accepted per visitor in a 10-minute window, counting the ones from B-27 and F-9, so most or all of these six get `429`                                                                                                 |

> D-3 counts are for exactly the steps above. Extra clicks in the builder add more rows; what matters is that every action appears and that D-4 stays `0`.

### 9.7 Optional extra checks

- **Path fallback without subdomains** (how C5's guide and the hosted app work before `SITE_ROOT_DOMAIN` is set):
  1. Stop terminal 1. Remove the `SITE_ROOT_DOMAIN=` and `SITE_PUBLIC_PORT=` lines from `backend/.env.manual.local`, then start terminal 1 again.
  2. Stop terminal 2 and start it again **without** `NEXT_PUBLIC_SITE_ROOT_DOMAIN=localhost`.
  3. Open `http://localhost:3000/s/<slug>`: every clinic site is served under the app at `/s/<slug>`. `/clinic/<id>/store` (old links) 308s to `/s/<id>/store` on the same host, so a patient signed in on the app stays signed in there.
- **The live browser suite on this setup** (needs a freshly seeded clinic; re-run §9.2 step 3 with `for c in c; do …` first if you already used clinic C by hand):

  ```bash
  cd /e/advertout/MedoFlow/frontend
  set -a; . ../backend/.env.manual.local; set +a
  E2E_LIVE_PASSWORD=$MANUAL_PASSWORD E2E_LIVE_API=http://localhost:4302 E2E_LIVE_SEED="$(cat ../backend/uploads/.manual-seed-c.json)" \
    E2E_BASE_URL=http://localhost:3000 E2E_EXTERNAL_SERVER=1 corepack pnpm exec playwright test e2e/live-site.spec.ts
  # → 4 passed
  ```

- **Domain posture of the deployed hosts:** §4.5. After the hosting cut-over: walkthrough §6 #4 and `arh-agent-docs/after-deploy-test.md`.

### 9.8 Clean up

1. Stop terminals 1 and 2 with Ctrl+C.
   - If a port stays busy, run the `powershell.exe … Stop-Process …` line from §9.2 step 0.
2. Remove the throwaway files and drop the manual-test database (terminal 3):

```bash
cd /e/advertout/MedoFlow/backend
rm -f .env.manual.local uploads/.manual-seed-*.json uploads/.manual-signin-c.txt uploads/.manual-pixel.png uploads/.manual-intent*.json
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS mf_manual_site WITH (FORCE)"
unset MANUAL_PASSWORD
```

Uploaded test images are under `backend/uploads/site-assets/` (gitignored); delete them if you like. Next time you start, §9.2 step 0 does all of this anyway.

### 9.9 Result sheet

| Area                                          | Checks                                  | Pass? |
| --------------------------------------------- | --------------------------------------- | ----- |
| Templates and site settings                   | B-1, B-2, B-5 · F-1, F-2 · D-3          | ☐     |
| Roles and tenant isolation                    | B-4, B-14, B-28 · D-7                   | ☐     |
| Drafts never public; preview; publish         | B-3, B-6 – B-9 · F-3 – F-7              | ☐     |
| Renames, unpublish, revisions, unsafe content | B-10 – B-13 · W-3 · D-5                 | ☐     |
| Subdomain, custom domain, CORS, HSTS          | B-15 – B-23 · D-1, D-6 · W-5 · F-10     | ☐     |
| Images                                        | B-24 – B-26 · F-8                       | ☐     |
| Enquiries (PHI)                               | B-27, B-28, B-32 · F-9, F-11 · D-2, D-4 | ☐     |
| SEO, sitemap, route kinds, status codes       | B-29 · W-1 – W-6                        | ☐     |
| Minimum-necessary public data; no Rx products | B-30, B-31 · W-7 · F-12                 | ☐     |
| Patient on the clinic site                    | F-12                                    | ☐     |

Tested by: **\_\_\_\_\_\_** · Date: **\_\_\_\_\_\_** · Branch / commit: `feat/c8-website-builder` @ **\_\_\_\_**

### 9.10 Troubleshooting

| Symptom                                                                       | Cause                                                                                               | Fix                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The Sign in dialog says **`Invalid email or password`**, or §9.4 prints a `0` | The users were seeded into another database, or with an older `MANUAL_PASSWORD`                     | Check that `grep MANUAL_DB backend/.env.manual.local` names the database seeded in §9.2 step 3. Restart terminal 1 after any env change. If you re-ran step 2, re-run steps 3 and 4. |
| `Too many attempts. Please try again in 15 minutes.`                          | Login rate limit after repeated failures                                                            | Restart terminal 1 (the counter is in memory)                                                                                                                                        |
| Commands print nothing, `stdout is not a tty`, or ids are empty               | `node` instead of `node.exe` inside `$( … )` or a pipe in Git Bash                                  | Use the blocks as written (`node.exe`)                                                                                                                                               |
| A curl check returns `401` or `undefined` after a while                       | The access token expired (15 idle minutes)                                                          | Re-run the `ADM=$(login …)` line from §9.4                                                                                                                                           |
| Every page shows **`invariant expected app router to be mounted`**            | `next dev` was started from a lowercase-drive path (`e:\…`)                                         | Stop terminal 2, run `cd /e/advertout/MedoFlow/frontend && rm -rf .next`, and start it again as in §9.3                                                                              |
| The clinic site says **"There’s no website here"**                            | Nothing published yet, a mistyped `<slug>`, or `SITE_ROOT_DOMAIN` missing from either app           | Publish (F-7); compare the address with **Website › Domains**; check `SITE_ROOT_DOMAIN=localhost` in `.env.manual.local` and `NEXT_PUBLIC_SITE_ROOT_DOMAIN=localhost` in terminal 2  |
| `http://<slug>.localhost:3000` doesn't open at all                            | A browser or curl that doesn't map `*.localhost` to your machine                                    | Use Chrome (or Edge); for curl, use the version that ships with Git for Windows                                                                                                      |
| Opening `/dashboard/…` on the clinic host keeps redirecting                   | The local dev-server redirect quirk (W-3 note)                                                      | Open the dashboard on `http://localhost:3000` instead                                                                                                                                |
| F-12: signed out after the reload on the clinic site                          | `REFRESH_COOKIE_SAMESITE=none` missing, or you signed in on `localhost:3000` instead of on the site | Re-run §9.2 step 2 (it writes the line), restart terminal 1, and sign in with the site's person icon                                                                                 |
| F-9 or B-32: `Too many messages. Please try again later or call the clinic.`  | The enquiry rate limit (5 per 10 minutes per visitor)                                               | Wait 10 minutes, or restart terminal 1 (the counter is in memory)                                                                                                                    |
| B-19 still says `unknown`                                                     | Host lookup cached for 60 s from an earlier `resolve`                                               | Wait a minute and run B-19 again                                                                                                                                                     |
| Backend won't start: `EADDRINUSE :::4302`                                     | Another process is on 4302                                                                          | Run the `powershell.exe … Stop-Process …` line from §9.2 step 0, then start terminal 1 again                                                                                         |
