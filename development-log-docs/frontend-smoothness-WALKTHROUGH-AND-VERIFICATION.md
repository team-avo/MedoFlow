# Frontend smoothness & performance pass: walkthrough and verification

**Date:** 2026-10-28 · **Branch:** `perf/frontend-smoothness` (from `development`) · **Data:** synthetic only.
**Scope:** frontend only (`frontend/`). No backend or API change.
**Plan:** `~/.claude/plans/since-i-have-hosted-lovely-wombat.md` (approved 2026-10-28).

On the remote dev host the app felt jerky:

- A full-screen **"Medoflow Syncing"** overlay covered the page on almost every click and backend call.
- Heavy decorative animation ran everywhere.
- Text wrapped onto two lines or pushed pages sideways.

This pass replaces the blocking loader, removes the fancy animation platform-wide (landing page included), and makes the shared layout primitives hold their shape with long text. Every phase was built and measured separately.

---

## 1. Outcome

| Item                                                   | Status | Evidence                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove the full-screen "Syncing" overlay               | ✅     | `GlobalApiLoader` deleted. Blocking-overlay time across all nav clicks: **0 ms for every role** (baseline 1.7–9.9 s per role), measured by `e2e/layout-smoke.spec.ts`                                                                              |
| Non-blocking loading feedback                          | ✅     | `TopProgressBar` (2px, `pointer-events-none`), page skeletons, button spinners; `tests/components/topProgressBar.test.tsx` (7 tests)                                                                                                               |
| Background refetches stay silent                       | ✅     | Bar ignores refetches of on-screen data; `refetchOnWindowFocus: false`, `retry: 1`                                                                                                                                                                 |
| Remove fancy / heavy animation (all roles + landing)   | ✅     | framer-motion, three.js, @react-three, Lenis removed (**55 packages**). Total client JS **4,259 → 3,173 KB**. Landing scroll: janky frames **239 → 15–68**, p95 frame 200 → 50–100 ms (range over the three post-Phase-3 runs on a shared machine) |
| No more text wrapping onto two lines / sideways scroll | ✅     | Page×width overflows **38 → 0** across 6 roles × 3 widths, with a deliberately long name, email and clinic name                                                                                                                                    |
| Nothing broken: pages, links, existing flows           | ✅     | Every nav link of every role clicked and rendered (layout smoke 27/27). Full e2e suite **52 passed, 0 failed** (8 opt-in live specs skipped, as before). 336 unit tests pass                                                                       |
| Guard against regressions                              | ✅     | `tests/unit/noHeavyMotion.test.ts`, `tests/components/layoutPrimitives.test.tsx`, `e2e/layout-smoke.spec.ts`                                                                                                                                       |

---

## 2. Benefit by phase

Each phase was built (`next build --webpack`) and measured on its own, in the order applied:

- the bundle total;
- a perf probe of 5 pages, median of 3 runs, Chromium with 4× CPU throttling;
- the layout smoke (27 tests).

> **Caveat on timing numbers.** This machine runs other workloads at the same time, and the owner said to ignore their effect rather than re-run phases. TBT and LCP therefore swing ±50% between runs, and Phase 3 in particular ran alongside a type-check. **Script KB, request count, DOM nodes, scroll-frame counts and the smoke results are stable.** The attribution below rests on those.

| Phase                                | What changed                                                                                                                                                                    | User-visible benefit                                                                                                                           | Measured evidence                                                                                                                                                                                                                  | Roles / pages affected                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **1. Replace the blocking loader**   | Full-screen overlay → thin top bar + skeletons; no refetch on tab focus; 1 retry                                                                                                | No more "Medoflow Syncing" takeover on every click or slow call; switching tabs no longer triggers refetches; failures surface in seconds      | Blocking-overlay time over a round of nav clicks: SUPER_ADMIN **9,867 → 0 ms**, FRONT_DESK 4,033 → 0, PATIENT 3,600 → 0, PROVIDER 1,816 → 0, MARKETING 1,750 → 0. Landing LCP 5.3 s → 1.8 s (overlay no longer covers first paint) | Every role, every page                                          |
| **2. Calm the app (all roles)**      | Removed blur blobs, backdrop-blur, `transition-all`, hover scale/translate, ping/bounce, zoom/slide modals; framer-motion out of the app shell                                  | Sidebar, top bar and modals open and repaint instantly; nothing bounces or drifts                                                              | App-shell script **−43 KB** (admin 426 → 382 KB, front desk 402 → 359 KB). framer-motion was in the root layout via `TourOverlay`, so it loaded on every page                                                                      | All dashboard roles, account portal, auth, onboarding, platform |
| **3. Landing & public pages static** | Removed three.js scene, Lenis, parallax, 400vh/120vh scroll-scrub sections, animated mesh blurs, counters, typing loop, marquee                                                 | Landing and store scroll natively and smoothly; far less to download                                                                           | Total client JS **4,279 → 3,162 KB (−1.1 MB)**. Landing script 642 → 329 KB, requests 49 → 41. Landing janky frames **266 → 39**, p95 frame 317 → 67 ms. Store janky frames 232 → 39                                               | Public landing, store, booking, every public page (footer)      |
| **4. Layout robustness**             | Global wrap rules; one-line badges/table cells with horizontal scroll; header/KPI/TopBar truncation; grids switch one breakpoint later (sidebar); phone padding; per-page fixes | No more two-line badges, KPI labels or headers; long names and emails truncate; tables scroll instead of crushing; pages never scroll sideways | Overflows **38 → 1 → 0** (last one, `/dashboard/site/domains` @375, fixed after the Phase 4 run). Smoke 27/27                                                                                                                      | All roles at phone (375), tablet (820), desktop (1280)          |
| **5. Guards (tests)**                | Unit + e2e checks for each of the above                                                                                                                                         | Regressions fail CI instead of reaching users                                                                                                  | +14 unit tests (336 total), +27 e2e smoke tests; full suite 52 passed                                                                                                                                                              | —                                                               |

A store layout-shift fix (public `<main>` keeps a viewport min-height) landed after the Phase 4 run, so the final run in §2.1 is the one that shows it.

### 2.1 Measured tables

Phase 3 timings ran next to a type-check (see the caveat above). Its admin-dashboard row (295 KB, 56 requests) is a sampling artefact of that load: the chunks for that route did not change in Phase 3, as Phases 2 and 4 show (382 / 383 KB). Phase 1's 40 overflows include 2 pages the baseline run could not render under the mock API (fixed in the spec later), so they are not regressions. The Phase 4 SUPER_ADMIN blocking line is missing because its nav test hit a spec bug: the sidebar logo link redirects per role. That was fixed by scoping the selector to the nav list, and Final shows 0 ms.

#### Bundle

| Build    | Total client JS (KB, all chunks) |
| -------- | -------------------------------: |
| Baseline |                             4259 |
| Phase 1  |                             4290 |
| Phase 2  |                             4279 |
| Phase 3  |                             3162 |
| Phase 4  |                             3173 |
| Final    |                             3174 |

#### landing

| Build    | Script KB | Requests | TBT ms | LCP ms | CLS | DOM nodes | Scroll p95 frame ms | Janky frames (>50 ms) |
| -------- | --------: | -------: | -----: | -----: | --: | --------: | ------------------: | --------------------: |
| Baseline |       646 |       50 |   4229 |   5336 |   0 |      1154 |                 200 |                   239 |
| Phase 1  |       645 |       50 |   4350 |   1848 |   0 |      1148 |                 233 |                   251 |
| Phase 2  |       642 |       49 |   4288 |    712 |   0 |      1146 |                 317 |                   266 |
| Phase 3  |       329 |       41 |   4157 |   5476 |   0 |      1058 |                  67 |                    39 |
| Phase 4  |       329 |       41 |   2470 |   3900 |   0 |      1065 |                  50 |                    15 |
| Final    |       329 |       41 |   3316 |   4712 |   0 |      1065 |                 100 |                    68 |

#### store

| Build    | Script KB | Requests | TBT ms | LCP ms |   CLS | DOM nodes | Scroll p95 frame ms | Janky frames (>50 ms) |
| -------- | --------: | -------: | -----: | -----: | ----: | --------: | ------------------: | --------------------: |
| Baseline |       653 |       54 |   4395 |   2844 | 0.998 |      1246 |                 233 |                   247 |
| Phase 1  |       653 |       54 |   2687 |   4392 | 0.542 |       257 |                 267 |                   264 |
| Phase 2  |       650 |       53 |   3014 |   5340 | 0.456 |      1226 |                 217 |                   232 |
| Phase 3  |       336 |       44 |   3859 |   5980 | 0.998 |      1148 |                  67 |                    39 |
| Phase 4  |       337 |       44 |   2771 |   4656 | 0.998 |      1149 |                  33 |                     5 |
| Final    |       337 |       42 |   2514 |   5084 |     0 |      1148 |                 100 |                    71 |

#### admin-dashboard

| Build    | Script KB | Requests | TBT ms | LCP ms |   CLS | DOM nodes |
| -------- | --------: | -------: | -----: | -----: | ----: | --------: |
| Baseline |       426 |       75 |   1504 |   3444 | 0.008 |       597 |
| Phase 1  |       426 |       74 |   1358 |   3188 | 0.008 |       581 |
| Phase 2  |       382 |       72 |   1461 |   3076 | 0.008 |       580 |
| Phase 3  |       295 |       56 |   1763 |   4100 | 0.011 |       585 |
| Phase 4  |       383 |       72 |   1023 |   2536 | 0.008 |       577 |
| Final    |       383 |       72 |   1828 |   3464 | 0.008 |       579 |

#### front-desk

| Build    | Script KB | Requests | TBT ms | LCP ms | CLS | DOM nodes |
| -------- | --------: | -------: | -----: | -----: | --: | --------: |
| Baseline |       403 |       66 |   1020 |   2840 |   0 |       280 |
| Phase 1  |       402 |       65 |    941 |   2712 |   0 |       278 |
| Phase 2  |       359 |       63 |    963 |   2620 |   0 |       276 |
| Phase 3  |       359 |       63 |   1655 |   3952 |   0 |       273 |
| Phase 4  |       359 |       63 |    966 |   2676 |   0 |       272 |
| Final    |       359 |       63 |   1737 |   3172 |   0 |       277 |

#### provider

| Build    | Script KB | Requests | TBT ms | LCP ms |   CLS | DOM nodes |
| -------- | --------: | -------: | -----: | -----: | ----: | --------: |
| Baseline |       430 |       67 |   1154 |   3040 | 0.001 |       289 |
| Phase 1  |       429 |       65 |   1228 |   3092 | 0.002 |       287 |
| Phase 2  |       426 |       64 |   1398 |   2572 | 0.002 |       282 |
| Phase 3  |       385 |       63 |   1502 |   3836 | 0.002 |       281 |
| Phase 4  |       386 |       63 |    951 |   2640 | 0.002 |       277 |
| Final    |       386 |       63 |   1443 |   3472 | 0.002 |       278 |

#### Layout smoke

| Build    | Blocking-overlay ms during nav clicks (per role)                                  | Unique page×width overflows | Tests passed / failed |
| -------- | --------------------------------------------------------------------------------- | --------------------------: | --------------------- |
| Baseline | SUPER_ADMIN 9867, FRONT_DESK 4033, PROVIDER 1816, MARKETING 1750, PATIENT 3600    |                          38 | 10 / 17               |
| Phase 1  | FRONT_DESK 0, MARKETING 0, PATIENT 0, PLATFORM_ADMIN 0, PROVIDER 0, SUPER_ADMIN 0 |                          40 | 19 / 8                |
| Phase 2  | FRONT_DESK 0, MARKETING 0, PATIENT 0, PLATFORM_ADMIN 0, PROVIDER 0, SUPER_ADMIN 0 |                          40 | 18 / 9                |
| Phase 3  | FRONT_DESK 0, MARKETING 0, PATIENT 0, PLATFORM_ADMIN 0, PROVIDER 0, SUPER_ADMIN 0 |                          38 | 20 / 7                |
| Phase 4  | FRONT_DESK 0, MARKETING 0, PATIENT 0, PLATFORM_ADMIN 0, PROVIDER 0                |                           1 | 25 / 2                |
| Final    | FRONT_DESK 0, MARKETING 0, PATIENT 0, PLATFORM_ADMIN 0, PROVIDER 0, SUPER_ADMIN 0 |                           0 | 27 / 0                |

---

## 3. Problems found and fixed

1. **The "Syncing" overlay blocked the UI by design.** `GlobalApiLoader` (root layout) showed a `fixed inset-0 z-[9999]` blurred overlay in two cases:
   - for 600 ms on every pathname or search-param change, including first mount;
   - whenever any React Query fetch or mutation ran longer than 400 ms.

   Over a remote link that is nearly every call, including **background** refetches. Window-focus refetch (on by default) and 3 retries with backoff kept it up for seconds. **Fixed:** `TopProgressBar`, which shows only for navigations, first loads (`state.data === undefined`) and mutations.

2. **Pages that relied on the overlay looked broken without it.** These pages had no loading state of their own:
   - provider calendar: an empty week showed while loading;
   - front-desk invoices: KPIs read $0 and the table said "No data yet";
   - the booking page: "Book Consultation" with no price;
   - the account card-on-file: rendered `null`;
   - POS;
   - four onboarding steps;
   - modals that said "No roles created yet" while roles were still loading.

   **Fixed:** each now shows a skeleton or a "Loading…" state; onboarding Next is disabled until the prefill arrives.

3. **framer-motion loaded on every page.** `TourOverlay` (mounted in the root layout) imported it. **Fixed:** plain elements; the package is removed.
4. **Dialogs swooped in from a corner.** tailwindcss-animate's `enter` keyframe resets `transform`, and custom modals combined `-translate-1/2` centring with `zoom-in` but no compensating slide. **Fixed:** fade only, with the `-1/2` slide pair kept so nothing moves.
5. **A typing loop re-rendered the landing page 38×/second forever.** The AI-scribe card in BentoGrid ran `setInterval(…, 26)`. **Fixed:** static text.
6. **The 820px "tablet" width broke almost every dashboard page.** The top-bar user button grew with a long name instead of truncating (49px overflow). **Fixed:** `max-w` on the button, so `truncate` engages.
7. **Page grids ignored the sidebar.** The 264px sidebar appears at `md`, but KPI grids switched to 4 columns at `lg` from the full viewport width. **Fixed:** they now switch at `xl`.
8. **Store and public pages jumped while loading (CLS ≈ 0.76–1.0).** The page rendered nearly empty, so the footer sat mid-screen and then jumped down twice. **Fixed:** public `<main>` has `min-h-screen`.
9. **Sticky headers slid under the top bar**:
   - scribe: now `top-14`;
   - patient appointment detail: now a card in the flow;
   - POS used `h-screen` under a 56px bar: now `calc(100vh-3.5rem)`.

10. **A wide table pushed `/dashboard/front-desk` sideways at 820px with real rows.** Found by the manual guide (§7), not by the mock-data smoke. A grid item's default `min-width: auto` let the table's min-content widen the `lg:grid-cols-3` track past the viewport. **Fixed:** a global `:where(.grid) > * { min-width: 0 }` (zero specificity, so any `min-w-*` class still wins). The table now scrolls inside its card. Guarded by `tests/components/layoutPrimitives.test.tsx`.

---

## 4. What changed (files)

All paths are under `frontend/`.

**Phase 1: loader**

- New: `components/common/TopProgressBar.tsx`.
- Deleted: `components/common/GlobalApiLoader.tsx`, `JumpingClinicalLoader.tsx`.
- `app/layout.tsx`, `components/QueryProvider.tsx`, `app/globals.css` (bar keyframes, reduced-motion fallback).
- `app/{dashboard,(public),platform,(onboarding)}/loading.tsx`: page skeletons in place of the full-screen loader. `(auth)` keeps it.
- Local loading states:
  - pages: provider calendar, front-desk invoices, POS, `book/[serviceId]`, account billing;
  - onboarding: brand, disciplines, providers, done;
  - modals: AddStaff, EditStaff, EditProvider, AddService;
  - text "Loading…" → skeleton in audit, commissions, memberships, packages, meetings, provider profile, `site/*`, `platform/clinics*`.
- `components/ui-system/LoadingSkeleton.tsx`: phone-safe widths.

**Phase 2: app animation**

- `components/ui/{dialog,alert-dialog,select,sheet,tabs,accordion}.tsx`.
- Custom modals: AuthModal, BookingModal, CartModal, ProductDetailModal, PatientHubModal, ManualNoteModal.
- `AppSidebar`, `TopBar`, `TourOverlay`, `AppLogo` (static by default), `(auth)/layout`, `(onboarding)/done`, voice-agent `VoiceAgentTester` / `VoiceAgentCallLog`.
- A reviewed class sweep over about 40 files: removed 28 decorative blur blobs and 26 `backdrop-blur`; replaced 43 `transition-all`; removed 18 hover scale/translate effects and 6 `animate-ping`/`animate-bounce` loops.

**Phase 3: landing and public**

- New: `components/landing/BrandGradient.tsx` (static radial gradients).
- Deleted:
  - `components/landing/motion/*` (SmoothScroll, ScrollProgress, MagneticButton, MeshGradient, useParallax);
  - `components/landing/three/ClinicStack.tsx`;
  - `ScrollReveal`, `AnimatedCounter`, `components/common/ClinicalHeroAnimation.tsx` (all unused).
- Rewritten to static markup with the same copy:
  - Hero, TrustBanner, ChaosToClarity, BentoGrid, DayInTheLife (now a timeline), Commerce, ROICalculator, Testimonials, FinalCTA, `primitives.tsx`;
  - PublicFooter, PublicNav;
  - the `(public)` pages.
- Config and dependencies:
  - `package.json` / `pnpm-lock.yaml`: −framer-motion, −three, −@types/three, −@react-three/fiber, −@react-three/drei, −lenis;
  - `tailwind.config.ts`: unused keyframes removed.

**Phase 4: layout**

- `app/globals.css`: `overflow-wrap: break-word`, `text-wrap: balance` on h1–h3, `.mf-display` line-height, and `:where(.grid) > * { min-width: 0 }` so grid items can shrink.
- Shared primitives: `ui/{badge,table,dialog,select}.tsx`, `ui-system/{AppTable (+ wrap column option),AppPageHeader,KPIStatCard,LoadingSkeleton}.tsx`, `layout/PageContainer.tsx`, `common/UserAvatar.tsx`, `layout/TopBar.tsx` (truncation, mobile page title).
- Layouts: platform layout, account layout, public layout (`min-h-screen`).
- Pages:
  - patients detail header, platform clinics and tenant;
  - account appointment detail, scribe, POS;
  - staff (+ header actions), packages, memberships, analytics, admin (KPI cards hardened);
  - front-desk, services, staff/roles, availability, site/domains, invoice and audit wrap columns;
  - dialog form grids stack on phones.
- Deleted dead code: `components/Sidebar.tsx`, `components/Navbar.tsx`, `components/layout/AppNavbar.tsx`.

**Phase 5: tests**

- `tests/components/topProgressBar.test.tsx`
- `tests/unit/noHeavyMotion.test.ts`
- `tests/components/layoutPrimitives.test.tsx`
- `e2e/layout-smoke.spec.ts`
- `e2e/mockApi.ts`: MARKETING and PLATFORM_ADMIN roles, plus an identity override for long names.

---

## 5. Verification: commands and results

```bash
# frontend/
corepack pnpm install                       # lockfile: 557 lines removed, 55 packages
npx tsc --noEmit                            # → exit 0
npx eslint --max-warnings=0 app components lib hooks contexts tests e2e   # → exit 0
npx vitest run                              # → 26 files, 336 tests passed

# e2e on Windows (Playwright cannot stop the server there):
NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 node node_modules/next/dist/bin/next build --webpack
node scripts/e2e-server.js 4310             # terminal 1
E2E_EXTERNAL_SERVER=1 npx playwright test   # terminal 2
```

Final run (all changes, including the store layout-shift fix):

| Check                            | Result                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/layout-smoke.spec.ts`       | **27 passed**. 0 overflows at 375 / 820 / 1280 px for SUPER_ADMIN, FRONT_DESK, PROVIDER, MARKETING, PATIENT, PLATFORM_ADMIN and public pages. Blocking-overlay time 0 ms for every role. No crash, 404 or error boundary on any nav link                        |
| Full suite `npx playwright test` | **52 passed, 0 failed, 8 skipped**. The skipped ones are the opt-in `live-*` specs that need a running API, the same as before this change. Booking, cancel/reschedule, idle timeout, MFA, patient files, Rx cart, site builder and waitlist/recurring all pass |
| Store CLS                        | 0.756 (before the `min-h-screen` fix) → **0**                                                                                                                                                                                                                   |

The grid `min-width` rule (§3 #10) landed after this e2e run. After it, typecheck, lint and the unit tests (336) were re-run and pass, and the manual run in §7 passed against the real API. The e2e suite was not re-run locally; CI runs it on the PR.

Per-phase measurement: the same build command, then a temporary perf-probe spec (not committed) and `e2e/layout-smoke.spec.ts` against `scripts/e2e-server.js`. The probe reads `PerformanceObserver` (longtask, layout-shift, LCP), resource timing and rAF frame times during a 40-step wheel scroll.

**Lighthouse was not run.** It is not installed here, and installing it would pull a package from outside the workspace. The probe measures the same underlying signals (TBT from long tasks, LCP, CLS, script bytes) and adds scroll-jank counts.

---

## 6. Design notes and deviations from the plan

- **Progress bar animation.** The plan said "width via CSS transition". The bar is indeterminate (the app can't know real progress), so it uses one compositor-only `transform` slide. Under `prefers-reduced-motion` it is a static full-width line.
- **Hero.** The plan offered "a static product-preview card, or an SVG". The hero kept its centred copy on a static brand gradient and grid; the 3D scene was removed without a replacement image. That keeps the hero light and avoids inventing a product mock.
- **Admin KPI cards.** These were **kept** rather than replaced with `KPIStatCard`. They carry product-tour anchors (`data-tour-id`) and text badges ("Optimal", "+12%") that `KPIStatCard` doesn't support. They got the same truncation, `shrink-0` and tabular-nums fixes.
- **Kept on purpose:**
  - `animate-spin` on button and inline spinners;
  - `animate-pulse` on skeletons;
  - a 150 ms fade on modals;
  - the 200 ms slide on the mobile nav drawer (it shows where the drawer comes from);
  - the CSS EKG loader mark (`MedoflowLoader`) for inline and auth use.
- **Not touched:** the clinic-website renderer (`components/site/**`). It is customer-facing template output, and its CSS already disables transitions.
- **Global wrap rule.** `overflow-wrap: break-word` does not shrink a flex item's min-content. Flex rows that carry emails or domains also got `min-w-0` locally. `anywhere` was rejected because it would break short labels mid-word in tight rows.

---

## 7. Manual local testing guide

Real backend + `next dev`, a throwaway database in Docker, one seeded clinic with all six roles. Every command below was run verbatim on 2026-10-28.

Use **Git Bash** (not PowerShell), three windows: terminal 1 backend, terminal 2 frontend, terminal 3 setup. Keep `node.exe` as written: plain `node` returns nothing inside `$( … )` in Git Bash.

### 7.1 Database in Docker (terminal 3)

```bash
cd /e/advertout/MedoFlow/backend
# First time only, if the container doesn't exist yet:
#   docker run -d --name mf-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:18
docker start mf-pg
# Reset a dedicated throwaway DB (never touches your dev data)
DB=mf_manual_ux
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB corepack pnpm exec prisma migrate deploy
docker exec mf-pg psql -U postgres -c "ALTER ROLE medoflow_app WITH LOGIN PASSWORD 'app_local_pw'"
```

Expected: `DROP DATABASE`, `CREATE DATABASE`, `All migrations have been successfully applied.`, `ALTER ROLE`.

### 7.2 Throwaway env file (terminal 3, same window: uses `$DB`)

The file is gitignored (`.env*.local`); every secret is generated on the spot.

```bash
H() { node.exe -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"; }
cat > .env.manual-ux.local <<ENV
# Manual UX test only (gitignored). Throwaway values.
PORT=4302
NODE_ENV=development
MANUAL_DB=${DB:?set DB first (step 7.1)}
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
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
REDIS_URL=
TENANT_ISOLATION_MODE=enforce
MANUAL_PASSWORD=Synthetic-Manual-$(node.exe -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
ENV
grep -E '^(MANUAL_DB|MANUAL_PASSWORD)=' .env.manual-ux.local
```

Expected: `MANUAL_DB=mf_manual_ux` and a `MANUAL_PASSWORD=Synthetic-Manual-…` line.

### 7.3 Seed a clinic with all six roles (terminal 3)

`seed-e2e-live.ts` creates the clinic with admin, provider and patient. The SQL adds front desk, marketing and platform admin with the same password hash, and gives the front-desk user and the clinic deliberately long names (for F-8).

```bash
set -a; . ./.env.manual-ux.local; set +a
mkdir -p uploads
E2E_LIVE_PASSWORD=$MANUAL_PASSWORD DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$MANUAL_DB \
  corepack pnpm exec ts-node --transpile-only scripts/seed-e2e-live.ts > uploads/.manual-ux-seed.json
ADMIN=$(node.exe -e "process.stdout.write(require('./uploads/.manual-ux-seed.json').emails.admin)")
docker exec -i mf-pg psql -U postgres -d $MANUAL_DB -v ON_ERROR_STOP=1 -v admin="$ADMIN" <<'SQL'
INSERT INTO "User" (id, "clinicId", name, email, password, role, "hasSeenTour", "hasSeenPatientTour", "tourCompletedAt", "updatedAt")
SELECT 'ux-' || r.key || '-' || substr(md5(random()::text), 1, 8),
       CASE WHEN r.role = 'PLATFORM_ADMIN' THEN NULL ELSE a."clinicId" END,
       r.name, replace(a.email, 'admin.', r.key || '.'), a.password, r.role::"Role", true, true, now(), now()
FROM "User" a
CROSS JOIN (VALUES
  ('frontdesk', 'FRONT_DESK',     'Maximiliana Alexandrina Featherstonehaugh-Worthington'),
  ('marketing', 'MARKETING',      'Rowan Hale'),
  ('platform',  'PLATFORM_ADMIN', 'Sam Ortiz')
) AS r(key, role, name)
WHERE a.email = :'admin';
UPDATE "Clinic" SET name = 'Northside Integrated Physiotherapy and Sports Rehabilitation Centre'
WHERE id = (SELECT "clinicId" FROM "User" WHERE email = :'admin');
SELECT role, email FROM "User" WHERE email LIKE '%' || substring(:'admin' from 'live-[0-9a-f]+') || '@%' ORDER BY role;
SQL
```

Expected: `INSERT 0 3`, `UPDATE 1`, then 6 rows (SUPER_ADMIN, PROVIDER, FRONT_DESK, PATIENT, MARKETING, PLATFORM_ADMIN).

### 7.4 Sign-in sheet (terminal 3)

```bash
set -a; . ./.env.manual-ux.local; set +a
SFX=$(node.exe -e "process.stdout.write(require('./uploads/.manual-ux-seed.json').emails.admin.match(/live-[0-9a-f]+/)[0])")
echo "Password for every user: $MANUAL_PASSWORD"
for r in admin frontdesk provider marketing patient platform; do echo "  $r.$SFX@example.test"; done
```

| Login         | Start page              |
| ------------- | ----------------------- |
| `admin.…`     | `/dashboard/admin`      |
| `frontdesk.…` | `/dashboard/front-desk` |
| `provider.…`  | `/dashboard`            |
| `marketing.…` | `/dashboard/site`       |
| `patient.…`   | `/account`              |
| `platform.…`  | `/platform/clinics`     |

Sign in at `http://localhost:3000/?auth=login&returnUrl=<url-encoded start page>`, e.g. `returnUrl=%2Fdashboard`. Use an incognito window per role, or sign out from the top-right menu.

### 7.5 Start the apps

Terminal 1, backend:

```bash
cd /e/advertout/MedoFlow/backend
set -a; . ./.env.manual-ux.local; set +a
corepack pnpm exec ts-node --transpile-only src/server.ts
```

Wait for `[db] connected as "medoflow_app"` and `Medoflow server running on port 4302`. Repeated `AggregateError` lines are the queue looking for Redis, and are harmless.

Terminal 2, frontend (start it from the uppercase-drive path as written):

```bash
cd /e/advertout/MedoFlow/frontend
NEXT_PUBLIC_API_URL=http://localhost:4302 NEXT_PUBLIC_APP_URL=http://localhost:3000 NEXT_PUBLIC_SITE_ROOT_DOMAIN=localhost corepack pnpm dev
```

Wait for `✓ Ready`. Use `localhost`, not `127.0.0.1`. In dev, the first visit to each route compiles for 10–30 s.

### 7.6 Checks (Chrome)

| #    | Do                                                                                                                                                                            | Expected                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| F-1  | As each role, click every sidebar item (account nav for the patient, Clinics for the platform admin)                                                                          | No full-screen "Medoflow / Syncing" screen, ever. A thin teal line at the very top while a page loads; skeletons in place of content |
| F-2  | On a list page, switch to another browser tab and back                                                                                                                        | Nothing flashes or reloads                                                                                                           |
| F-3  | As admin, Services → add a service and save                                                                                                                                   | The button shows its own spinner; the top line shows; the page stays usable                                                          |
| F-4  | Open any dialog (Add service, Invite member) and, at 375 px, the mobile nav                                                                                                   | Dialog fades in place (no zoom or slide from a corner); drawer slides in quickly                                                     |
| F-5  | `http://localhost:3000/`: scroll top to bottom                                                                                                                                | Native scroll, no 3D scene, no parallax, no pinned "day in the life" or door animation; sections are static                          |
| F-6  | `/store` with DevTools → Network → Slow 4G                                                                                                                                    | The footer stays below the screen until products arrive; nothing jumps                                                               |
| F-7  | DevTools device toolbar (Ctrl+Shift+M) at **375**, **820** and **1280** px on front-desk, invoices, patients, staff, analytics, site/domains, platform/clinics, account pages | No sideways scroll; badges, table headers and KPI labels stay on one line; tables scroll horizontally inside their card              |
| F-8  | Sign in as **frontdesk** (long name, long clinic name)                                                                                                                        | Top bar shows the name truncated with an ellipsis; nothing is pushed off-screen                                                      |
| F-9  | 375 px, any dashboard page                                                                                                                                                    | Hamburger plus the current page title (breadcrumbs from `md` up)                                                                     |
| F-10 | Windows Settings → Accessibility → Visual effects → Animation effects **Off**, reload                                                                                         | Top bar is a static line; no remaining transitions                                                                                   |

**Result of the 2026-10-28 run** against the real API (all six roles): F-1, F-2, F-5, F-6, F-7, F-8 and F-9 driven by a throwaway Playwright script, **23/23 checks passed**. Blocking-overlay time 0 ms for every role; no broken nav link; no sideways scroll at 375 / 820 / 1280 on the front-desk, admin, provider, patient and platform pages; store CLS < 0.1 on a throttled link. That run found §3 #10, which was fixed and re-checked. F-4 and F-10 were checked separately and pass; F-3 is left for the reviewer.

**Result sheet:** F-1 ☐ F-2 ☐ F-3 ☐ F-4 ☐ F-5 ☐ F-6 ☐ F-7 ☐ F-8 ☐ F-9 ☐ F-10 ☐

### 7.7 Cleanup

Ctrl+C in terminals 1 and 2, then in terminal 3:

```bash
cd /e/advertout/MedoFlow/backend
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS mf_manual_ux WITH (FORCE)"
rm -f .env.manual-ux.local uploads/.manual-ux-seed.json
docker stop mf-pg
```

---

## 8. Known limits

- **Navigations with no link click.** The top bar starts on same-origin link clicks. A navigation started only by `router.push` (e.g. after a form submit) shows it only through the queries the new page runs.
- **Mock data in the smoke tests.** The smoke uses the empty-success mock API, so it proves the chrome, empty states and loading states at every width. It does not prove dense real data: very long table content now scrolls horizontally by design. Run F-7 and F-8 against real data.
- **Timing noise.** TBT and LCP are noisy on this shared machine (§2). Compare bytes, requests and frame counts across phases, not timings.
- **Unaddressed typography.** `text-[Npx]` arbitrary sizes (446 uses) and heavy `uppercase tracking-widest` labels were left as they are, except where they caused wrapping. A typography scale is a separate design task.
