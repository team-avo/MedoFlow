# Demo feedback WS2–WS4 — live consult transcript, site Products & menus, clinic sign-up: walkthrough and verification

**Date:** 2026-11-04 · **Branch:** `feat/booking-simplify` (one branch for all four workstreams, by the owner's choice; WS1 has its own walkthrough: [booking-simplify-WALKTHROUGH-AND-VERIFICATION.md](booking-simplify-WALKTHROUGH-AND-VERIFICATION.md)) · **Data:** synthetic only.

**Trigger:** the demo notes asked for five things.

- **Live transcription and video (WS2):** show the transcription live as the doctor speaks, add video on top of it, and fix the video-call button being shadowed by the manual recording button.
- **Products and menus (WS3, 19:58–21:00):**
  - Products in the site navigation, and a Products section right below Treatments.
  - A homepage section showing a medicine store. The owner chose OTC and supplements only; prescription items stay off.
  - Configurable homepage / header / footer menus.
- **Clinic sign-up (WS4, 11:16–11:33):** landing → choose plan → dashboard or onboarding.
- **Marketing homepage (WS4, 13:17):** "Start free trial" must stop being a placeholder.
- **Billing (WS4):** the owner's decision is a 14-day trial with no card; on the demo, plans don't matter and nothing expires.

---

## 1. Outcome

| Item                                                                                                                     | Status | Evidence                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **WS2** Live transcript on the provider's screen while recording                                                         | ✅     | `consultation-room.spec.ts` (fake mic → captions appear). Real run: 2 live calls, all 200, lines shown (§4.6)                         |
| **WS2** Captions during a video call: a strip under the video plus the side panel                                        | ✅     | e2e: the caption strip shows the line during the stubbed call                                                                         |
| **WS2** Video and recording controls always both visible, side by side, never overlapping                                | ✅     | `consultControls.test.tsx` state matrix (12 states). e2e checks bounding boxes and viewport before, during and after a call           |
| **WS2** Recording works during a call; when blocked it says why; the scribe explains a silent no-start                   | ✅     | e2e "consent pending"                                                                                                                 |
| **WS2** Live captions: same consent gate and provider; nothing stored, nothing logged                                    | ✅     | `consultationLive.int.test.ts` (6)                                                                                                    |
| **WS3** Products in the header and footer of every template; hidden while the clinic has no products                     | ✅     | `siteContent.test.ts` template rule; renderer test; real render                                                                       |
| **WS3** Homepage: Treatments → Products (no medicines) → Medicine store (OTC and supplements only, never Rx)             | ✅     | Template test; `siteBuilder.int.test.ts` WS3 (3); real run                                                                            |
| **WS3** Store filter All / Medicines / Other; `?type=medicines` opens on Medicines                                       | ✅     | Renderer test; real run                                                                                                               |
| **WS3** Menus screen: Header (with one-level dropdowns), Footer, Homepage tabs; homepage quick-links section             | ✅     | `siteBuilder.test.tsx` WS3 (2); renderer tests (dropdown, keyboard, quick links)                                                      |
| **WS3** Existing sites upgraded (drafts only), idempotently                                                              | ✅     | `productsNavUpgrade.test.ts` (5). Script dry-run on the integration DB: 24 of 26 sites would change; on a fresh template: "no change" |
| **WS4** Landing "Start free trial" → `/pricing` → `/get-started?plan=…` → signed in → onboarding agreement               | ✅     | `clinic-signup.spec.ts` (3). Real run: tenant `GROWTH / TRIAL / 14 days`                                                              |
| **WS4** `BILLING_MODE=demo`: plan display-only, ACTIVE, no trial end, top limits; demo banner                            | ✅     | `tenantSignup.int.test.ts` (4), `billingMode.test.ts` (3), e2e demo banner                                                            |
| **WS4** Landing: pricing section `#pricing`, `#features` anchor, nav Pricing / Start free trial, footer dead links fixed | ✅     | e2e landing → pricing; §3                                                                                                             |

## 2. Problems found (root causes)

- **WS2 — "video call shadowed".** It wasn't CSS. The causes were all in `consultation/page.tsx`:
  - The Start Video Call pill hid itself during a call.
  - Manual recording required `!hasVideoRoom`, so the two buttons never showed together.
  - The record button vanished for good after STOPPED/STORED.
  - Auto-record silently did nothing when consent wasn't granted.
  - The 640 px call frame pushed the scribe controls below the fold.
  - There was no live transcript at all: transcription ran only after the whole recording was uploaded.
- **WS3:**
  - Menus were flat.
  - No template linked to the store except Serenity's "Shop".
  - There was no homepage menu.
  - Products and medicines were one undifferentiated list.
  - A menu link to an empty target (e.g. Products with no products) rendered as a bare label.
- **WS4:**
  - `POST /tenants/signup` existed, but no page called it.
  - "Start free trial" opened the _login_ modal, and the footer opened _patient_ sign-up.
  - `#pricing`, `#features` and `#demo` had no target, and there was no plan UI.

## 3. What changed (files)

**WS2 — live transcript and controls**

| Area                                               | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint `POST /consultations/:id/live-transcript` | [consultationService.ts](../backend/src/services/consultationService.ts) `transcribeLiveSegment`, [consultationController.ts](../backend/src/controllers/consultationController.ts), [routes/consultations.ts](../backend/src/routes/consultations.ts), [audioUpload.ts](../backend/src/config/audioUpload.ts) (2 MB `liveSegmentUpload`, shared filter), [rateLimit.ts](../backend/src/middleware/rateLimit.ts) (`liveTranscriptRateLimit`: 60/min per user)                                                        |
| Provider abstraction                               | [ai/types.ts](../backend/src/services/ai/types.ts) (`segment` hint), [ai/mock.ts](../backend/src/services/ai/mock.ts) (one line per segment), [ai/registry.ts](../backend/src/services/ai/registry.ts) (`liveTranscription` capability)                                                                                                                                                                                                                                                                              |
| Hooks                                              | [useLiveTranscription.ts](../frontend/hooks/useLiveTranscription.ts) (new): a second `MediaRecorder` restarted every 6 s; at most 2 in flight; backlog dropped; ordered lines. [useAudioRecorder.ts](../frontend/hooks/useAudioRecorder.ts) exposes `stream`                                                                                                                                                                                                                                                         |
| UI                                                 | [ConsultControls.tsx](../frontend/components/consultation/ConsultControls.tsx), [LiveTranscriptPanel.tsx](../frontend/components/consultation/LiveTranscriptPanel.tsx) (new); [consultation/page.tsx](../frontend/app/dashboard/provider/appointments/%5Bid%5D/consultation/page.tsx) (sticky controls bar, call height `clamp(320px, 60vh, 640px)`, caption strip, toasts when auto-record can't start); [consultationApi.ts](../frontend/lib/consultationApi.ts), [aiScribeApi.ts](../frontend/lib/aiScribeApi.ts) |
| Tests                                              | `consultationLive.int.test.ts` (6), `useLiveTranscription.test.ts` (6), `consultControls.test.tsx` (19), `consultation-room.spec.ts` (3); `scribeMock.ts` caps                                                                                                                                                                                                                                                                                                                                                       |

**WS3 — site Products, Medicine store, menus**

| Area           | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schemas        | [settings.ts](../backend/src/site/content/settings.ts): nav items take optional `children` (one level, ≤ 8); `homeMenu.items` (≤ 12); `DEFAULT_HOME_MENU`; Products in the default header. [sections.ts](../backend/src/site/content/sections.ts): `featured-products.excludeMedicines`, new `medicine-store` and `quick-links`. Mirrors: [lib/site/sections.ts](../frontend/lib/site/sections.ts), [lib/site/types.ts](../frontend/lib/site/types.ts). Parity cases: [site-sections.json](../shared/validation-cases/site-sections.json) (+3 valid, +3 invalid) |
| Render data    | [renderService.ts](../backend/src/site/services/renderService.ts): `PublicProduct.medicine` = OTC/SUPPLEMENT (Rx was already excluded); data loaded for `medicine-store`. [templatePreview.ts](../backend/src/site/services/templatePreview.ts) samples                                                                                                                                                                                                                                                                                                          |
| Templates      | [clarity / serenity / vitality / heritage / botanica](../backend/src/site/templates): Products link (Serenity / Botanica "Shop" → "Products") in the header and first footer column; `homeMenu`; HOME = … hero → quick-links … service-grid → featured-products (no medicines) → medicine-store …                                                                                                                                                                                                                                                                |
| Renderer       | [sections/clinic.tsx](../frontend/components/site/sections/clinic.tsx) (`MedicineStoreSection`; empty product sections are left off the live site), [sections/quickLinks.tsx](../frontend/components/site/sections/quickLinks.tsx) (new), [SiteShell.tsx](../frontend/components/site/SiteShell.tsx) (accessible dropdowns; `visibleNavItems` drops dead links on live), [routeViews.tsx](../frontend/components/site/routeViews.tsx) (store tabs)                                                                                                               |
| Builder        | [SettingsEditors.tsx](../frontend/components/site/builder/SettingsEditors.tsx) (Menus → Header / Footer / Homepage tabs; "Add sub-item"; "Add the menu to this page"), [editor/page.tsx](../frontend/app/dashboard/site/editor/page.tsx)                                                                                                                                                                                                                                                                                                                         |
| Existing sites | [productsNavUpgrade.ts](../backend/src/site/services/productsNavUpgrade.ts) (pure, tested) + [scripts/site-add-products-nav.ts](../backend/scripts/site-add-products-nav.ts) (drafts only; dry run unless `--apply`)                                                                                                                                                                                                                                                                                                                                             |
| Tests          | Template rule (5), `productsNavUpgrade.test.ts` (5), `siteBuilder.int.test.ts` WS3 (3), `siteRenderer.test.tsx` WS3 (5), `siteBuilder.test.tsx` WS3 (2); `site-builder.spec.ts` updated (Clarity's 2nd section is now the homepage menu); the deleted-page test now expects dead menu links to be dropped                                                                                                                                                                                                                                                        |

**WS4 — sign-up, plans, landing**

| Area         | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Billing mode | [config/billingMode.ts](../backend/src/config/billingMode.ts) (new): `trial` (default) / `demo`. Used by [entitlements.ts](../backend/src/site/entitlements.ts), [tenantService.ts](../backend/src/services/tenantService.ts), [platformAdminService.ts](../backend/src/services/platformAdminService.ts). `BILLING_MODE` in [.env.example](../backend/.env.example) and `demo` in [render.yaml](../render.yaml)                                       |
| Plans        | [config/plans.ts](../backend/src/config/plans.ts) (new), `GET /tenants/plans`; sign-up takes `plan` (FREE / STARTER / GROWTH; ENTERPRISE → 400 "contact sales") in [routes/tenants.ts](../backend/src/routes/tenants.ts)                                                                                                                                                                                                                               |
| Pages        | [pricing/page.tsx](../frontend/app/%28public%29/pricing/page.tsx), [get-started/page.tsx](../frontend/app/%28public%29/get-started/page.tsx) (plan picker, suggested + live-checked web address, sign-up → sign-in → `/agreement`), [PlanCards.tsx](../frontend/components/marketing/PlanCards.tsx), [tenantApi.ts](../frontend/lib/tenantApi.ts)                                                                                                      |
| Landing      | [page.tsx](../frontend/app/%28public%29/page.tsx) (`#features` anchor, `#pricing` section), [HeroSection](../frontend/components/landing/HeroSection.tsx) / [FinalCTASection](../frontend/components/landing/FinalCTASection.tsx) (→ `/pricing`; "Book a demo" → sales mailto), [PublicNav](../frontend/components/layout/PublicNav.tsx) (guests: Features, Pricing, Start free trial), [PublicFooter](../frontend/components/layout/PublicFooter.tsx) |
| Routing      | `/get-started` and `/auth` are reserved page slugs ([routeKeys.ts](../backend/src/site/routing/routeKeys.ts), [routes.ts](../frontend/lib/site/routes.ts)); `/get-started` is app-only ([edgeRouting.ts](../frontend/lib/site/edgeRouting.ts))                                                                                                                                                                                                         |
| CI           | [deploy.yml](../.github/workflows/deploy.yml): the e2e build gets `NEXT_PUBLIC_APP_URL=http://127.0.0.1:4310` (needed by the WS1 handoff spec)                                                                                                                                                                                                                                                                                                         |
| Tests        | `tenantSignup.int.test.ts` (4), `billingMode.test.ts` (3), `planCards.test.tsx` (4), `clinic-signup.spec.ts` (3); `mockApi.ts` `newClinic` option                                                                                                                                                                                                                                                                                                      |

## 4. Verification: commands and results

Run on 2026-11-04. Integration database: `mf-pg` on 55432.

### 4.1 Gates

```bash
cd backend
corepack pnpm exec tsc --noEmit -p .  &&  corepack pnpm exec tsc --noEmit -p tsconfig.test.json   # → no output
corepack pnpm exec vitest run                                                                     # → 30 files · 463 passed
cd ../frontend
corepack pnpm exec tsc --noEmit -p .                                                              # → no output
corepack pnpm exec eslint <changed files>                                                         # → no output
corepack pnpm exec vitest run                                                                     # → see §4.4
```

### 4.2 Backend integration (real Postgres, `medoflow_app`, RLS on)

```bash
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it
corepack pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/consultationLive.int.test.ts  # → 6 passed
corepack pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/siteBuilder.int.test.ts      # → 30 passed
corepack pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/tenantSignup.int.test.ts     # → 4 passed
corepack pnpm exec vitest run --config vitest.integration.config.ts                                                   # → 19 files · 287 passed, 1 skipped (pre-existing)
```

What the new integration suites prove:

- **`consultationLive`:**
  - **The gate:** no consent → 400 `consent_required`; not recording → 409 `not_recording`; the provider is never called.
  - **Captions:** while recording, each segment returns its caption line, the provider sees `audio/webm`, and `transcriptText` and `aiScribeSessionId` stay null.
  - **Who may ask:** patient, other provider and other clinic → 403/404.
  - **Bad input:** missing file / non-audio → 400; a 3 MB segment → 413 `file_too_large`.
  - **Provider failures:** an outage → 503 `ai_unavailable`; a rejection → 502 `ai_rejected`.
  - **No logging:** no caption text appears in any log line.
- **`siteBuilder` WS3:**
  - `/store` flags Arnica (OTC) and Magnesium (SUPPLEMENT) as medicines and Retinol as not, and both Rx products are absent.
  - After installing the template and publishing, HOME runs `service-grid → featured-products → medicine-store`; the Products link resolves to `/store`; `homeMenu` includes Products.
  - One-level dropdowns save; a nested sub-item → 422.
- **`tenantSignup`:**
  - The catalogue lists 4 plans, with Enterprise sales-led, `billingMode: trial` and 14 trial days.
  - A GROWTH sign-up gets TRIAL with +14 days; the owner signs in as SUPER_ADMIN with onboarding not complete.
  - No plan → FREE; ENTERPRISE → 400 "contact sales"; an unknown plan → 400.
  - **Demo:** ACTIVE, `trialEndsAt` null, and FREE gets the ENTERPRISE site entitlements.

### 4.3 Upgrading existing sites

```bash
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it corepack pnpm exec ts-node --transpile-only scripts/site-add-products-nav.ts
#   → … "<clinicId>: header: added Products; homeMenu: added the default quick links; home: added Products after Treatments; home: added Medicine store (dry run)"
#   → "26 site(s) checked, 24 would change (run with --apply)"
```

On a freshly installed template, in the real run of §4.6, it reports `no change`. The unit tests cover apply-twice idempotency, keeping a clinic's own Products section, a full header, and legacy (first-builder) home content. For legacy content, only the menus are upgraded, and the home page is reported as skipped.

### 4.4 Frontend unit / component

```bash
cd frontend
corepack pnpm exec vitest run tests/components/consultControls.test.tsx tests/unit/useLiveTranscription.test.ts   # → 25 passed
corepack pnpm exec vitest run tests/unit/siteContent.test.ts tests/components/siteRenderer.test.tsx tests/components/siteBuilder.test.tsx  # → 67 passed
corepack pnpm exec vitest run tests/components/planCards.test.tsx                                                 # → 4 passed
```

### 4.5 Playwright (production build, mocked API)

```bash
cd frontend
NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 NEXT_PUBLIC_APP_URL=http://127.0.0.1:4310 node node_modules/next/dist/bin/next build --webpack
node scripts/e2e-server.js 4310        # Windows: start it yourself; stop only this PID afterwards
E2E_EXTERNAL_SERVER=1 npx playwright test e2e/consultation-room.spec.ts e2e/video-consultation.spec.ts e2e/scribe-review.spec.ts   # → 13 passed
E2E_EXTERNAL_SERVER=1 npx playwright test e2e/clinic-signup.spec.ts e2e/site-builder.spec.ts                                     # → 10 passed
E2E_EXTERNAL_SERVER=1 npx playwright test                                                                                        # → full suite: see §4.7
```

`consultation-room.spec.ts` runs Chrome with a fake microphone and a stubbed 8x8 `external_api.js` that joins straight away. It covers three paths:

1. **Consent granted:** joining starts recording. Both controls are visible, side by side, the same height and not overlapping. The first caption appears in the panel and in the strip under the call. Stopping during the call keeps the call and offers Upload & transcribe.
2. **Consent pending:** recording stays visible but disabled, with its reason; joining shows "Not recording yet: waiting for the patient's consent". When the patient consents, recording unlocks during the call.
3. **Ending the call from our controls:** this stops, uploads and transcribes with no click, and both controls stay on screen.

### 4.6 Real front end ↔ back end (no mocks)

**Setup:**

- Real API on `:4312`: `medoflow_app`, RLS enforced, field encryption on, mock AI scribe, no JaaS, no Redis.
- Real `next dev` on `:3010`.
- A fresh database `mf_manual_demo`, seeded with `scripts/seed-e2e-live.ts` (5 products: OTC, 2 × SUPPLEMENT, AESTHETIC, RX_SCHEDULED) plus a verified subdomain.
- The clinic admin installed Clarity and published it through the API.
- A scratchpad Playwright script drove three browsers (fake mic for the provider).

```
[real] ok - WS3 header has a Products link
[real] ok - WS3 Medicine store lists the OTC / supplement products
[real] ok - WS3 Medicine store has no aesthetic or Rx product
[real] ok - WS3 no prescription product anywhere on the page
[real] ok - WS3 Products section shows only non-medicines
[real] section order: quick-links | How we can help | Products from the practice | medicine-store | Getting care is easy | …
[real] ok - WS3 homepage menu (quick links) is shown
[real] ok - WS3 store opens on the Medicines tab
[real] ok - WS3 Medicines tab filters the store
[real] ok - WS2 video control visible
[real] ok - WS2 recording control visible next to it
[real] consent pending → granting it in the DB (as the patient would)
[real] ok - WS2 video control still visible while recording
[real] ok - WS2 live transcript line appeared (real API, mock STT)
[real] ok - WS2 2 live-transcript calls, all 200
[real] ok - WS2 recording control unaffected by a video error (no JaaS here)
[real] ok - WS2 stop → Upload & transcribe offered
[real] ok - WS4 live subdomain check says Available (real API)
[real] ok - WS4 signed up, signed in, landed on the onboarding agreement
[real] ok - WS4 tenant in DB: GROWTH|TRIAL|14
[real] ALL PASSED
```

The §9.4 curl checks were run against the same server, with the results shown there.

### 4.7 Full Playwright suite and secrets

- **Full Playwright suite:** see the summary at the end (§10).
- **gitleaks** (Docker `zricethezav/gitleaks:v8.21.2`) over the changed source trees: **no new findings** (§10).

## 5. Design notes

- **Near-live, not streaming.**
  - Each ~6 s segment is a complete webm file from a second recorder on the same microphone stream. It goes to the **same** speech-to-text provider as the final transcript, so ADR 0006's PHI-egress and BAA gate applies unchanged, and no new vendor or websocket is needed.
  - Lag is roughly segment length plus provider latency: 3–8 s with Groq.
  - The final clinical transcript and note are still produced from the full recording; the captions are a preview, labelled as such, never stored or logged.
  - With 2 requests in flight and 3 queued, captions stay near "now" instead of falling minutes behind.
  - About 10 calls/min per consult; the limiter allows 60/min per user. Groq's free tier allows 20 RPM for Whisper, so one live consult fits.
- **Microphone only, as before.** In a video call the patient is heard through the provider's speakers (`useAudioRecorder` turns echo cancellation off for exactly this). With headphones, the captions and the recording contain only the provider. That limit isn't new; it's now visible.
- **Captions never cover the call.** Jitsi draws its toolbar inside its iframe, so captions sit in a strip _under_ the frame, and the full log is in the side column.
- **Medicine = OTC or SUPPLEMENT.** This is decided server-side from `fulfillmentClass`. Rx products never reach a public payload (ADR 0003 scope guard), so neither section can show them.
- **Dead links are dropped on live menus.** This covers Products before any product exists, and a deleted page. The builder canvas still shows them so they can be edited. One existing renderer test asserted "renders as text"; it now asserts "left out", which is deliberate.
- **Billing mode is one helper** (`config/billingMode.ts`). Everything gated (site entitlements) goes through `effectivePlan`, so the demo is fully unlocked with no scattered checks. Nothing enforces the trial end in either mode; enforcement belongs to B12.2 (Stripe billing).
- **Demo side effect:** with ENTERPRISE limits, the "Powered by MedoFlow" badge disappears from demo clinic sites. Set `BILLING_MODE=trial` to see the plan-driven badge.

## 6. What you must do manually

1. **Hosted demo:**
   - Deploy `render.yaml` (it sets `BILLING_MODE=demo`); for a real deployment, remove it or set `trial`.
   - Run the site upgrade there: `DATABASE_URL=<owner url> npx ts-node --transpile-only scripts/site-add-products-nav.ts`, then `--apply`.
   - Publish each clinic's site in the builder to make the changes live.
2. **Confirm the marketing copy:** the plan prices (`backend/src/config/plans.ts`: $0 / $49 / $149 / custom) and the sales address (`NEXT_PUBLIC_SALES_EMAIL`, default `sales@medoflow.com`). Both are placeholders.
3. **Real Groq run of live captions:** §9.5 G-1 – G-11 (your own words appear within ~10 s; nothing stored or logged). Also a real 8x8 call with captions under the video.
4. **Legal pages:** the footer's Privacy / Terms / HIPAA notice / Security / Status links still point at `#`. Those pages don't exist yet.

## 7. HIPAA / review checklist

- **Live captions:** same consent gate, same provider gate, tenant- and provider-scoped. The text exists only in the response and the provider's browser memory; it is never written to the database or logs (tested), and the request log never includes bodies.
- **Sign-up:** no PHI; the owner password is hashed with argon2id, as before.
- **Medicine store:** Rx never public (enforced server-side, tested).

## 8. Known limits

- **Live captions** run in the consultation room only. The separate scribe console (`/dashboard/provider/visits/:id/scribe`) uses a different session type and would need its own endpoint. The patient's side shows no captions.
- **No speaker labels in live captions** (the final transcript has them).
- **Menus:**
  - Dropdowns are one level.
  - Footer columns have no dropdowns.
  - The Menus screen is covered by component tests, not its own end-to-end browser test.
- **Trial expiry and payment** are not enforced or collected (B12.2). Plans gate only website limits today.
- **The landing page** keeps its existing nine sections. "Real homepage" was taken to mean working CTAs, pricing and links.

## 9. Manual local testing guide

Three terminals in Git Bash, from the repo root. The API is on **4312** and the frontend on **3010**.

### 9.1 Before you start

- Docker Desktop is running and `mf-pg` is up: `docker start mf-pg`.
- Ports 4312 and 3010 are free. These commands print `free`:

  ```powershell
  foreach ($p in 4312,3010) { try { "$p busy: " + (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop).OwningProcess } catch { "$p free" } }
  ```

### 9.2 One-time setup (terminal 3)

```bash
cd /e/advertout/MedoFlow/backend
DB=mf_manual_demo
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB corepack pnpm exec prisma migrate deploy
H() { node.exe -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"; }
cat > .env.manual-demo.local <<EOF
# Local manual testing only (gitignored). Throwaway values.
PORT=4312
NODE_ENV=development
MANUAL_DB=mf_manual_demo
DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_manual_demo
CORS_ORIGIN=http://localhost:3010
FRONTEND_URL=http://localhost:3010
SITE_ROOT_DOMAIN=localhost
SITE_PUBLIC_PORT=3010
APP_HOSTS=localhost,127.0.0.1
JWT_SECRET=$(H)
MFA_ENCRYPTION_KEY=$(H)
FIELD_ENCRYPTION_PROVIDER=env
FIELD_ENCRYPTION_KEYS=k1:$(H)
FIELD_ENCRYPTION_ACTIVE_KID=k1
FILE_BLOB_SIGNING_SECRET=$(H)
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
REDIS_URL=
TENANT_ISOLATION_MODE=enforce
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
AI_SCRIBE_LLM_PROVIDER=mock
AI_SCRIBE_STT_PROVIDER=mock
MANUAL_PASSWORD=Synthetic-Manual-$(node.exe -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
EOF
set -a; . ./.env.manual-demo.local; set +a
mkdir -p uploads
E2E_LIVE_PASSWORD=$MANUAL_PASSWORD DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB \
  corepack pnpm exec ts-node --transpile-only scripts/seed-e2e-live.ts > uploads/.manual-demo-seed.json
S=uploads/.manual-demo-seed.json; J() { node.exe -p "require('./$S').$1"; }
docker exec mf-pg psql -U postgres -d $DB -c "INSERT INTO \"SiteDomain\" (id,\"clinicId\",hostname,kind,status,\"isPrimary\",\"verifiedAt\",\"updatedAt\") VALUES ('sd-manual-demo','$(J clinicId)','$(J clinicSlug)','SUBDOMAIN','VERIFIED',true,now(),now());"
echo "PASSWORD  $MANUAL_PASSWORD"
echo "ADMIN     $(J emails.admin)"
echo "PROVIDER  $(J emails.provider)"
echo "SITE      http://$(J clinicSlug).localhost:3010/"
echo "CONSULT   http://localhost:3010/dashboard/provider/appointments/$(J scribeAppointmentId)/consultation"
```

Keep the printed lines.

### 9.3 Start the apps

```bash
# Terminal 1 — backend
cd /e/advertout/MedoFlow/backend && set -a && . ./.env.manual-demo.local && set +a && corepack pnpm exec ts-node --transpile-only src/server.ts
#   wait for: Medoflow server running on port 4312 (development)
# Terminal 2 — frontend
cd /e/advertout/MedoFlow/frontend && NEXT_PUBLIC_API_URL=http://localhost:4312 NEXT_PUBLIC_APP_URL=http://localhost:3010 \
  NEXT_PUBLIC_SITE_ROOT_DOMAIN=localhost node node_modules/next/dist/bin/next dev -p 3010
#   wait for: ✓ Ready
```

### 9.4 Backend checks (terminal 3)

```bash
cd /e/advertout/MedoFlow/backend
set -a; . ./.env.manual-demo.local; set +a
API=http://localhost:4312/api/v1; S=uploads/.manual-demo-seed.json; J() { node.exe -p "require('./$S').$1"; }
CL="X-MedoFlow-Client: web"; P() { node.exe -p "const d=JSON.parse(require('fs').readFileSync(0));$1"; }
AT=$(curl -s -H "$CL" -H 'content-type: application/json' -d "{\"email\":\"$(J emails.admin)\",\"password\":\"$MANUAL_PASSWORD\"}" $API/auth/login | P "d.data.accessToken")
echo "S-1 install: $(curl -s -o /dev/null -w '%{http_code}' -H "$CL" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{"mode":"replace"}' $API/site/templates/clarity/install)"
echo "S-2 publish: $(curl -s -o /dev/null -w '%{http_code}' -H "$CL" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{"pageIds":"all"}' $API/site/publish)"
curl -s "$API/public/sites/render?host=$(J clinicSlug).localhost&path=/" | node.exe -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;console.log('S-3 home:',d.page.sections.map(x=>x.type).join(' > '));console.log('S-4 products:',d.data.products.map(p=>p.name+(p.medicine?' [med]':'')).join(', '));console.log('S-5 header:',d.site.settings.header.links.map(l=>l.label+'='+l.link.href).join(', '))})"
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_manual_demo corepack pnpm exec ts-node --transpile-only scripts/site-add-products-nav.ts | tail -1
echo "P-1 plans: $(curl -s $API/tenants/plans | P "d.data.billingMode+' '+d.data.plans.map(p=>p.key+(p.selfServe?'':'(sales)')).join(',')")"
echo "P-2 enterprise signup: $(curl -s -o /dev/null -w '%{http_code}' -H "$CL" -H 'content-type: application/json' -d "{\"clinicName\":\"Ent Clinic\",\"clinicEmail\":\"e@example.test\",\"subdomain\":\"entclinic1\",\"ownerName\":\"Ent Owner\",\"ownerEmail\":\"ent.owner@example.test\",\"password\":\"$MANUAL_PASSWORD\",\"plan\":\"ENTERPRISE\"}" $API/tenants/signup)"
PT=$(curl -s -H "$CL" -H 'content-type: application/json' -d "{\"email\":\"$(J emails.provider)\",\"password\":\"$MANUAL_PASSWORD\"}" $API/auth/login | P "d.data.accessToken")
echo "L-1 caps.liveTranscription: $(curl -s -H "authorization: Bearer $PT" $API/ai-scribe/capabilities | P 'd.data.capabilities.liveTranscription')"
```

Expected (recorded on 2026-11-04):

```
S-1 install: 200
S-2 publish: 200
S-3 home: hero > quick-links > trust-bar > service-grid > featured-products > medicine-store > steps > provider-bios > testimonials > faq > booking-cta
S-4 products: Arnica Gel [med], Magnesium Glycinate [med], Retinol Night Serum, Turmeric Curcumin [med]      (no Tramadol)
S-5 header: Services=/services, Products=/store, Our doctors=/team, About=/about, Contact=/contact
1 site(s) checked, 0 would change (run with --apply)
P-1 plans: trial FREE,STARTER,GROWTH,ENTERPRISE(sales)
P-2 enterprise signup: 400
L-1 caps.liveTranscription: true
```

**Live-caption checks** need a consultation session, so run F-6 in the browser first. Then, in terminal 3 (same helpers):

```bash
CID=$(docker exec mf-pg psql -U postgres -d mf_manual_demo -tAc "SELECT id FROM \"ConsultationSession\" WHERE \"appointmentId\"='$(J scribeAppointmentId)'")
head -c 4096 /dev/urandom > uploads/.manual-demo-seg.webm
docker exec mf-pg psql -U postgres -d mf_manual_demo -c "UPDATE \"ConsultationSession\" SET \"consentStatus\"='GRANTED', \"recordingStatus\"='NOT_STARTED', status='READY' WHERE id='$CID'" >/dev/null
echo "L-2 not recording: $(curl -s -H "$CL" -H "authorization: Bearer $PT" -F segment=0 -F "audio=@uploads/.manual-demo-seg.webm;type=audio/webm" $API/consultations/$CID/live-transcript | P 'd.code')"
docker exec mf-pg psql -U postgres -d mf_manual_demo -c "UPDATE \"ConsultationSession\" SET \"recordingStatus\"='RECORDING', status='RECORDING' WHERE id='$CID'" >/dev/null
echo "L-3 recording, segment 1: $(curl -s -H "$CL" -H "authorization: Bearer $PT" -F segment=1 -F "audio=@uploads/.manual-demo-seg.webm;type=audio/webm" $API/consultations/$CID/live-transcript | P 'd.data.text')"
PAT=$(curl -s -H "$CL" -H 'content-type: application/json' -d "{\"email\":\"$(J emails.patient)\",\"password\":\"$MANUAL_PASSWORD\"}" $API/auth/login | P "d.data.accessToken")
echo "L-4 as the patient: $(curl -s -o /dev/null -w '%{http_code}' -H "$CL" -H "authorization: Bearer $PAT" -F segment=0 -F "audio=@uploads/.manual-demo-seg.webm;type=audio/webm" $API/consultations/$CID/live-transcript)"
echo "L-5 stored transcript: '$(docker exec mf-pg psql -U postgres -d mf_manual_demo -tAc "SELECT coalesce(\"transcriptText\",'') FROM \"ConsultationSession\" WHERE id='$CID'")'"
rm -f uploads/.manual-demo-seg.webm
```

Expected:

```
L-2 not recording: not_recording
L-3 recording, segment 1: Patient: Better. The fatigue is easing, but I still feel low on energy by mid-afternoon.
L-4 as the patient: 403
L-5 stored transcript: ''
```

### 9.5 Browser checks

| #    | Do                                                                                                                                                                                | Expect                                                                                                                                                                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-1  | Open **SITE**                                                                                                                                                                     | The header has **Products**. Under the Treatments section ("How we can help") comes **Products from the practice** (Retinol only), then **Medicine store** (Arnica, Magnesium, Turmeric). No Tramadol anywhere. Quick-link pills appear under the hero |
| F-2  | **Visit the medicine store →**                                                                                                                                                    | `/store?type=medicines`, with the **Medicines** tab selected and only the three medicines. **Other products** shows Retinol                                                                                                                            |
| F-3  | Sign in as **ADMIN** at `http://localhost:3010/?auth=login` → Website → Editor → **Menus**                                                                                        | Header / Footer / Homepage tabs                                                                                                                                                                                                                        |
| F-4  | Header tab: on Services, **Add sub-item** → set it to Products → back on the canvas, hover Services                                                                               | A dropdown with Services and the new item; Esc closes it                                                                                                                                                                                               |
| F-5  | Homepage tab: add "Book a visit" → Booking                                                                                                                                        | It appears in the pills section on the canvas                                                                                                                                                                                                          |
| F-6  | In a new window, sign in as **PROVIDER** (Chrome: allow the microphone) → open **CONSULT**                                                                                        | A bar at the top with **Start video call** and **Start recording**. Recording is disabled with "Waiting for the patient's consent…"                                                                                                                    |
| F-7  | Grant consent: `docker exec mf-pg psql -U postgres -d mf_manual_demo -c "UPDATE \"ConsultationSession\" SET \"consentStatus\"='GRANTED' WHERE \"recordingStatus\"='NOT_STARTED'"` | Within 3 s, **Start recording** becomes active                                                                                                                                                                                                         |
| F-8  | **Start recording**, then speak                                                                                                                                                   | The **Live transcript** panel shows "Live", and within ~6–10 s a line appears. The mock AI returns a synthetic conversation line per segment, not your words                                                                                           |
| F-9  | **Start video call** (no JaaS here)                                                                                                                                               | "Video calls are not set up on this server". **Stop recording** is still there and working                                                                                                                                                             |
| F-10 | **Stop recording**                                                                                                                                                                | **Upload & transcribe** appears. With no Redis it can't finish; that's expected here                                                                                                                                                                   |
| F-11 | Open `http://localhost:3010/` in a private window → **Start free trial**                                                                                                          | `/pricing`, with four plans; Enterprise says **Contact sales**                                                                                                                                                                                         |
| F-12 | **Start free trial — Growth** → fill in the form                                                                                                                                  | The web address is suggested from the clinic name and shows **Available**                                                                                                                                                                              |
| F-13 | **Create my clinic**                                                                                                                                                              | You land on **Service agreement for <clinic>** (onboarding)                                                                                                                                                                                            |

#### Live captions with a real AI: Groq (G-1 – G-11)

F-8 proves the wiring with the mock, which returns canned lines. These checks run the same screen against Groq's hosted Whisper (`whisper-large-v3-turbo`, the Groq preset's default), so the captions show **your own words**.

> **Not yet run with a real key.** These steps were written from the code and from the Groq run of the AI scribe guide ([component-ai-scribe §9.9](component-ai-scribe-WALKTHROUGH-AND-VERIFICATION.md), run by the owner on 2026-10-30). This machine has no Groq key. What Whisper writes varies per run, so the expected results describe what to look for, not exact text.

**Before you start:**

- **Steps done first:** §9.3 and §9.4 are finished, and F-6 has opened **CONSULT** at least once, so the consultation session exists.
- **A Groq key:** free from <https://console.groq.com> → **API Keys**, no card needed. It starts with `gsk_`.
- **A real microphone:** Chrome must use your real microphone, not a fake one.
- **Synthetic data only.** Groq's free tier comes with no BAA. From G-3 on, everything the microphone picks up goes to Groq. Read only the script in G-5, and never say anything about a real person.
- **Free-tier limit:** Whisper allows 20 requests a minute. Live captions send one request every ~6 s, about 10 a minute. Don't run a second live consult, or the AI scribe guide's drafts, on the same key at the same time.

**G-1. Put the key into the throwaway env file** (terminal 3).

The key goes into a hidden prompt, so it never appears on screen, in the terminal history or in a command line. The block replaces the two mock lines with the Groq settings.

```bash
cd /e/advertout/MedoFlow/backend
read -rsp "Paste your Groq key (nothing is shown), then press Enter: " GK; echo
case "$GK" in gsk_?*) sed -i '/^AI_SCRIBE_/d' .env.manual-demo.local
  printf 'AI_SCRIBE_LLM_PRESET=groq\nAI_SCRIBE_LLM_API_KEY=%s\nAI_SCRIBE_STT_PRESET=groq\n' "$GK" >> .env.manual-demo.local
  echo "✓ key saved";; *) echo "✗ not saved: a Groq key starts with gsk_";; esac
unset GK
grep -E '^AI_SCRIBE_' .env.manual-demo.local | sed -E 's/(API_KEY=gsk_).*/\1…(hidden)/'
```

Paste with **Shift+Insert** or right-click → **Paste**. Expect:

```
✓ key saved
AI_SCRIBE_LLM_PRESET=groq
AI_SCRIBE_LLM_API_KEY=gsk_…(hidden)
AI_SCRIBE_STT_PRESET=groq
```

Transcription has no key of its own: when both presets name the same vendor, it reuses the LLM key. The file is gitignored, and §9.7 deletes it, key included.

**G-2. Check that the key is valid.** One request goes straight to Groq. The key reaches curl on stdin, never on the command line.

```bash
set -a; . ./.env.manual-demo.local; set +a
P() { node.exe -p "const d=JSON.parse(require('fs').readFileSync(0));$1"; }
printf 'authorization: Bearer %s\n' "$AI_SCRIBE_LLM_API_KEY" | curl -s -H @- https://api.groq.com/openai/v1/models \
  | P "d.error ? '✗ '+d.error.message : 'key OK · whisper-large-v3-turbo '+(d.data.some(m=>m.id==='whisper-large-v3-turbo') ? '✓' : '✗')"
```

Expect `key OK · whisper-large-v3-turbo ✓`. If you see `✗ Invalid API Key`, the key was pasted incompletely: copy it again and repeat G-1.

**G-3. Restart the backend on Groq.** In terminal 1, press Ctrl+C, then:

```bash
cd /e/advertout/MedoFlow/backend
unset ${!AI_SCRIBE_@}
set -a; . ./.env.manual-demo.local; set +a
corepack pnpm exec ts-node --transpile-only src/server.ts 2>&1 | tee -a uploads/.manual-demo-backend.log
```

- `unset ${!AI_SCRIBE_@}` is needed. Without it, the `AI_SCRIBE_*_PROVIDER=mock` values this terminal loaded in §9.3 stay set and win over the new file.
- `tee -a` keeps a log for G-10.

Expect `Medoflow server running on port 4312`, plus two warnings that Groq has no BAA on record (`AI_SCRIBE_LLM sends PHI to api.groq.com …` and the same for `AI_SCRIBE_STT`). These are warnings in development and acceptable for synthetic data. In production, the same check refuses to start.

**G-4. Check that the backend now transcribes with Groq** (terminal 3):

```bash
API=http://localhost:4312/api/v1; S=uploads/.manual-demo-seed.json; J() { node.exe -p "require('./$S').$1"; }; CL="X-MedoFlow-Client: web"
PT=$(curl -s -H "$CL" -H 'content-type: application/json' -d "{\"email\":\"$(J emails.provider)\",\"password\":\"$MANUAL_PASSWORD\"}" $API/auth/login | P "d.data.accessToken")
curl -s -H "authorization: Bearer $PT" $API/ai-scribe/capabilities \
  | P "const c=d.data.capabilities; 'live='+c.liveTranscription+' · stt='+c.stt.preset+'/'+c.stt.model+' · '+c.stt.location+' · key in answer: '+/gsk_/.test(JSON.stringify(d))"
```

Expect `live=true · stt=groq/whisper-large-v3-turbo · external · key in answer: false`.

**G-5. Reset the session and speak** (terminal 3, then the PROVIDER window).

The L-checks and F-10 left the session recording or stopped. This puts it back to "consent given, not started":

```bash
docker exec mf-pg psql -U postgres -d mf_manual_demo -c "UPDATE \"ConsultationSession\" SET \"consentStatus\"='GRANTED', \"recordingStatus\"='NOT_STARTED', status='READY' WHERE \"appointmentId\"='$(J scribeAppointmentId)'"
```

Reload **CONSULT** in the PROVIDER window, then click **Start recording**. Read this synthetic script aloud at a normal pace, both parts in your own voice:

> "Good morning. What brings you in today?"
> "I've had a dry cough for about two weeks. It's worse at night."
> "Any fever or shortness of breath?"
> "No fever. I take loratadine, ten milligrams, for my allergies."
> "Let's listen to your chest and check your oxygen level."

| #   | Look at                                          | Expect                                                                                                                                                                                                                 |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-5 | The **Live transcript** panel                    | The badge says **Live**. The first line appears about 6–10 s after you start speaking. It is **what you said**, not the mock's "Provider: How have you been…". There are no speaker labels (§8)                        |
| G-6 | The panel as you keep reading                    | A new line roughly every 6 s, in order, with timestamps `0:00`, `0:06`, `0:12` and so on. A word cut at a 6 s boundary may be split or garbled; the final transcript, made from the whole recording, doesn't have this |
| G-7 | DevTools → **Network**, filter `live-transcript` | One `POST` about every 6 s, each **200**, each taking a few seconds or less. The response is `{"data":{"text":"…","segment":N}}`. No error or "running behind" note under the panel                                    |
| G-8 | Stay silent for ~20 s                            | No new lines, because empty results are dropped. Whisper occasionally invents a short phrase such as "Thank you." on silence. That is a known Whisper quirk in a preview and not a defect                              |
| G-9 | **Stop recording**, then reload the page         | The badge says **Off** and **Upload & transcribe** appears. After the reload the panel is empty, because captions live only in the browser's memory                                                                    |

**G-10. Check that nothing was stored or logged** (terminal 3):

```bash
echo "G-10a stored transcript: '$(docker exec mf-pg psql -U postgres -d mf_manual_demo -tAc "SELECT coalesce(\"transcriptText\",'') FROM \"ConsultationSession\" WHERE \"appointmentId\"='$(J scribeAppointmentId)'")'"
echo "G-10b script words in the backend log: $(grep -c -i -E 'loratadine|dry cough|shortness of breath' uploads/.manual-demo-backend.log)"
echo "G-10c key in the backend log: $(grep -c 'gsk_' uploads/.manual-demo-backend.log)"
```

Expect `G-10a stored transcript: ''`, `G-10b … 0` and `G-10c … 0`.

**G-11. A rejected key, then recovery** (optional, ~3 min).

1. In terminal 1, press Ctrl+C. Run the G-3 block again, but this time replace its last line with:

   ```bash
   AI_SCRIBE_LLM_API_KEY=gsk_not-a-real-key corepack pnpm exec ts-node --transpile-only src/server.ts 2>&1 | tee -a uploads/.manual-demo-backend.log
   ```

   This overrides the key for this run only; the env file is untouched.

2. Run the G-5 reset again, reload **CONSULT** and click **Start recording**.

   **Expect:** within ~10 s, a note under the panel says _"The AI service rejected our credentials. An administrator must check the AI settings."_ Network shows **502** responses with `"code":"ai_auth"`. Recording carries on: **Stop recording** is still there, and the full recording isn't affected.

3. Click **Stop recording**, then restart terminal 1 with the plain G-3 block. Run the G-5 reset, reload and start recording again.

   **Expect:** captions return, and the note clears on the first good segment.

When you're finished, §9.7 deletes the env file and the key with it. You can also revoke the key in the Groq console.

### 9.6 Database checks

```bash
docker exec mf-pg psql -U postgres -d mf_manual_demo -c "SELECT slug, plan, status, round(extract(epoch from (\"trialEndsAt\"-now()))/86400) AS days FROM \"Tenant\" ORDER BY \"createdAt\" DESC LIMIT 2;"
```

| #   | Expect                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Your new clinic: `GROWTH · TRIAL · 14`                                                                                                                                                   |
| D-2 | (Optional) Restart terminal 1 with `BILLING_MODE=demo` added to `.env.manual-demo.local`, then sign up again. The new row is `… · ACTIVE · (null)`, and `/pricing` shows the demo banner |

### 9.7 Clean up

Stop terminals 1 and 2 with **Ctrl+C**, then:

```bash
cd /e/advertout/MedoFlow/backend
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS mf_manual_demo WITH (FORCE)"
rm -f .env.manual-demo.local uploads/.manual-demo-seed.json uploads/.manual-demo-backend.log
```

### 9.8 Result sheet

| Check                          | Pass / Fail | Notes |
| ------------------------------ | ----------- | ----- |
| S-1 … S-5, P-1, P-2, L-1 … L-5 |             |       |
| F-1 … F-13                     |             |       |
| G-1 … G-11 (real Groq)         |             |       |
| D-1, D-2                       |             |       |
| §6 steps 1–3                   |             |       |

## 10. Final gates (all four workstreams together, 2026-11-04)

| Gate                                                                                                                                     | Result                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend `tsc` (app and tests)                                                                                                            | clean                                                                                                                                                                        |
| Backend unit `vitest run`                                                                                                                | **30 files · 463 passed**                                                                                                                                                    |
| Backend integration (all suites, `medoflow_app`, RLS on)                                                                                 | **19 files · 287 passed, 1 skipped** (pre-existing skip)                                                                                                                     |
| Frontend `tsc`, ESLint on changed files                                                                                                  | clean                                                                                                                                                                        |
| Frontend unit / component `vitest run`                                                                                                   | **35 files · 429 passed** (includes the repo's "no backdrop-blur" rule; the controls bar is solid white)                                                                     |
| Playwright, full suite (production build, `NEXT_PUBLIC_APP_URL=http://127.0.0.1:4310`)                                                   | **74 passed, 10 skipped** (the opt-in live specs), 0 failed, in 11.9 min                                                                                                     |
| Real FE+BE runs                                                                                                                          | WS1 (§4.5 of the WS1 doc) and WS2–WS4 (§4.6): all checks passed                                                                                                              |
| gitleaks over `backend/{src,prisma,scripts}`, `frontend/{app,components,lib,hooks,contexts,e2e,tests}`, `shared`, `development-log-docs` | no new findings. Remaining hits are the pre-existing allow-listed ones (`stripe.ts` placeholder; synthetic passwords in `helpers.ts`, `rateLimit.int.test.ts`, `mockApi.ts`) |
| Line endings                                                                                                                             | every new or edited file is LF and Prettier-formatted                                                                                                                        |
