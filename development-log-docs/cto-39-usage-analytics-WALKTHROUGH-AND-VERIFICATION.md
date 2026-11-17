# CTO-39 · Cross-clinic feature-usage analytics (PostHog): walkthrough and verification

**Date:** 2026-11-16 · **Branch:** `feat/cto-39-usage-analytics` (from `development` at `a028515`) · **Data:** synthetic only · **Machine:** macOS, Node 22, Docker Postgres `mf-pg`

**Trigger:** CTO-39 in [cto-feedback-tasks.md](../arh-agent-docs/cto-feedback-tasks.md), from the 2026-11-11 CTO demo. The goal is to find the most and least used features across clinics, to inform tier and product decisions.

**Owner decisions (2026-11-16):**

- **PostHog**, **server-side only**: `posthog-node` in the backend, with no browser SDK.
- **Dashboards in two places:** an in-app platform page (`/platform/usage`) and PostHog's own UI.
- **No PHI by design, no BAA:** runs on the PostHog free tier.

---

## 1. Outcome

| AC  | What                                                                                                                                       | Status | Evidence                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Server-side `feature_used` event (feature, clinic, role, timestamp) for key actions. **No PHI**, and a test checks the payload allow-list. | ✅     | 52 features in one catalog. Allow-list and validators in `usageAnalytics.ts`. Tests: `usageAnalytics.test.ts` (30), `usageAnalytics.int.test.ts` (8), and a new case in `aiScribe.int.test.ts`. Real SDK wire capture in §4.5. |
| 2   | Platform-admin-only dashboard: usage per feature over time, clinics per feature, least-used features.                                      | ✅     | `/platform/usage` (frontend) reads `GET /platform/usage` (backend, `requirePlatformAdmin`). Zero-use features are listed. Component test `platformUsage.test.tsx` (5).                                                         |
| 3   | Respects data retention; clinic-level usage can be exported (B12.3).                                                                       | ✅     | `GET /platform/usage/export.csv` (audited `USAGE_EXPORTED`). `DATA_RETENTION_POLICY.md` has a new row and an off-boarding step.                                                                                                |

**Universal standard:**

- CI gates are green locally (§4.1).
- Tests cover the happy path and the failure or edge cases.
- No regressions: full backend integration and unit suites, frontend unit suite, and the targeted Playwright specs.
- HIPAA per-change gate ticked (§7).
- **Still open:**
  - peer review;
  - PR and merge;
  - a real PostHog project, which is the owner's setup (§6);
  - a live run against it.

---

## 2. Problems found before building

1. **A CI guard already blocks browser analytics.**
   - `frontend/tests/unit/staticGuards.test.ts` fails if `posthog-js` (or any telemetry SDK) is added without an entry in `frontend/telemetry-allowlist.json`. An entry needs a BAA reference and the PHI scrubber.
   - Server-side capture avoids this entirely, and the allow-list stays empty.
2. **The HIPAA register said "any analytics tool is a BAA decision"** (`HIPAA_COMPLIANCE_CHECKLIST.md` §1.2).
   - PostHog's BAA needs a paid platform package.
   - It also excludes the managed reverse proxy and PostHog AI.
   - So the design is "no PHI ever leaves", enforced in code and tests, and recorded in the register.
3. **Some actions write their audit row inside a transaction**, for example `APPOINTMENT_CREATED` in `appointmentService.ts`, so they bypass `logAudit`. Emitting inside a transaction could count a booking that later rolls back. Those actions are tracked explicitly, after commit.
4. **There's no backend event for some actions:**
   - Reception check-in doesn't exist.
   - Key-change approve and reject (CTO-33), and the manual "end call" button, happen only in the browser.
   - They're inferred from `scribe.approved` (the count of kept Rx lines) and from recording or video events. See §8.
5. **The scribe autostart path (CTO-30) never calls `/ai-scribe/session/start`.** It starts the recording first.
   - The CTO-30 origin is therefore recorded on `scribe.recording_started`, not on session creation.
   - It's passed as `?from=command_center|appointments_list|reminder` on the "Start scribe" links.
6. **Logins and invite acceptance run before the request is authenticated**, so the ambient role is unknown.
   - Rule: an actor with an unknown role is counted under the clinic's "system" id, never as a hashed user. This is so a patient can't get an individual id by accident.
   - Logins are tracked explicitly at the point where the role is known.
7. **posthog-node releases almost daily.**
   - Pinned to `5.61.1`, released 2026-10-30, more than two weeks old.
   - Its transitive `@posthog/core` and `@posthog/types` are pinned through root `pnpm.overrides` to versions from the same date. Otherwise they resolve to builds a day old.

---

## 3. What changed (files)

### 3.1 Backend

| File                                                                                                                                                                                                                                                                               | Change                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/usageFeatures.ts` **(new)**                                                                                                                                                                                                                                            | The feature catalog: 52 features in 8 areas, each `{key, area, label, auditActions?}`. Single source of truth; unmapped audit actions are ignored (default deny).                                                                                                                                                                                                                                              |
| `src/services/usageAnalytics/usageAnalytics.ts` **(new)**                                                                                                                                                                                                                          | The emitter. Contains: `trackUsage()`; `trackAuditAction()` (called by `logAudit`); the property allow-list and validators; HMAC staff ids and per-clinic patient and system ids; the plan lookup (cached 5 min); `syncClinicGroups()`; `shutdownUsageAnalytics()`; test hooks. Fire and forget: it never throws and never waits on the network.                                                               |
| `src/services/usageAnalytics/config.ts` **(new)**                                                                                                                                                                                                                                  | Env parsing and `usageAnalyticsConfigProblems()` (boot checks, modelled on `videoConfigProblems`).                                                                                                                                                                                                                                                                                                             |
| `src/services/usageAnalytics/usageQueryService.ts` **(new)**                                                                                                                                                                                                                       | Read side. Sends HogQL to the PostHog Query API (server-side, Bearer personal key, 10 s timeout, 5 min cache). Merges results with the catalog so zero-use features show. Builds the CSV export, with formula-injection protection.                                                                                                                                                                            |
| `src/services/auditService.ts`                                                                                                                                                                                                                                                     | `logAudit` calls `trackAuditAction({action, entityType, clinicId, performedById})` after the row is written. Audit `oldValue` and `newValue` are never read.                                                                                                                                                                                                                                                   |
| `src/routes/platform.ts`                                                                                                                                                                                                                                                           | `GET /platform/usage?days=` and `GET /platform/usage/export.csv?days=`, behind the existing `protect, requirePlatformAdmin`. The export is audited.                                                                                                                                                                                                                                                            |
| `src/config/envValidation.ts`                                                                                                                                                                                                                                                      | Runs `usageAnalyticsConfigProblems`.                                                                                                                                                                                                                                                                                                                                                                           |
| `src/server.ts`                                                                                                                                                                                                                                                                    | Flushes queued events on graceful shutdown.                                                                                                                                                                                                                                                                                                                                                                    |
| `src/scheduler/cronJobs.ts`                                                                                                                                                                                                                                                        | Clinic-group sync one minute after boot, then daily.                                                                                                                                                                                                                                                                                                                                                           |
| Explicit hooks (after commit): `appointmentService.ts`, `aiScribeService.ts`, `consultationController.ts`, `productController.ts`, `inventoryController.ts`, `membershipService.ts`, `routes/onboarding.ts`, `googleCalendarService.ts`, `staffController.ts`, `authController.ts` | These events: `appointment.created` (source, mode; not on reschedule), `appointment.completed` / `no_show`, `scribe.approved` (sent_to_patient, count), `scribe.recording_started` (source), `product.created`, `inventory.adjusted`, `membership.purchased` (once per paid invoice), `onboarding.brand_saved`, `onboarding.npi_lookup` (outcome), `calendar.google_connected`, `staff.invited`, `auth.login`. |
| `src/services/providerReminderService.ts`                                                                                                                                                                                                                                          | The starting-soon link carries `&from=reminder`.                                                                                                                                                                                                                                                                                                                                                               |
| `package.json` / root `package.json` / `pnpm-lock.yaml`                                                                                                                                                                                                                            | `posthog-node@5.61.1` (exact) plus the two transitive pins.                                                                                                                                                                                                                                                                                                                                                    |
| `.env.example`, `render.yaml`                                                                                                                                                                                                                                                      | A documented CTO-39 env block (§6).                                                                                                                                                                                                                                                                                                                                                                            |

### 3.2 Frontend

| File                                                                                       | Change                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/platform/usage/page.tsx` **(new)**                                                    | The Usage page. It has range tabs (7 days to 12 months), four KPI tiles, area filter chips, a table of features by reach (bar, events, weekly sparkline, last used), a least-used panel, and Export CSV. It also handles the not-configured, error-with-retry and loading states. |
| `lib/platformUsageApi.ts` **(new)**                                                        | API client and CSV download.                                                                                                                                                                                                                                                      |
| `app/platform/layout.tsx`                                                                  | Adds a "Usage" item to the platform nav.                                                                                                                                                                                                                                          |
| `components/dashboard/TodayAppointmentsCard.tsx`                                           | `scribeHref(id, from)` adds `&from=command_center` (the default) or `appointments_list`.                                                                                                                                                                                          |
| `app/dashboard/appointments/page.tsx`                                                      | Passes `'appointments_list'`.                                                                                                                                                                                                                                                     |
| `app/dashboard/provider/appointments/[id]/consultation/page.tsx`, `lib/consultationApi.ts` | Forwards a known `from` value as `source` on `recording/start`.                                                                                                                                                                                                                   |

### 3.3 Docs and tests

- **Docs:**
  - `docs/HIPAA_COMPLIANCE_CHECKLIST.md` §1.2 has a PostHog row (no-PHI, no BAA, how it's enforced).
  - `docs/DATA_RETENTION_POLICY.md` has a usage-events row and an off-boarding step.
  - Local only: `arh-agent-docs/development-plan.md` and `cto-feedback-tasks.md` mark CTO-39 🟨 (code done; setup and live run pending).
- **New tests:**
  - `backend/src/tests/usageAnalytics.test.ts`
  - `backend/src/tests/integration/usageAnalytics.int.test.ts`
  - `frontend/tests/components/platformUsage.test.tsx`
  - `frontend/tests/unit/scribeOrigin.test.ts`
- **Extended tests:** `aiScribe.int.test.ts` (one new case) and `providerReminders.int.test.ts` (new link).

No database migration: the usage events live in PostHog only.

---

## 4. Verification: commands and results

Run on 2026-11-16. Postgres is `mf-pg` on 55432; the CI-equivalent gate used a brand-new database, `mf_ci`.

### 4.1 Gates (the same steps as `.github/workflows/deploy.yml`)

| Gate                                                                                                                                                                 | Result                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Backend typecheck (app and tests)                                                                                                                                    | clean                                                                                                     |
| Backend ESLint (zero warnings)                                                                                                                                       | clean                                                                                                     |
| Synthetic fixtures (`check-synthetic-fixtures.js`)                                                                                                                   | passed, 109 files                                                                                         |
| No em dashes (`check-no-em-dash.js backend shared` / `frontend`)                                                                                                     | clean, 370 + 457 files                                                                                    |
| Backend unit tests with coverage threshold                                                                                                                           | **41 files · 637 passed** (was 39 · 600 on 2026-11-13)                                                    |
| Migrations on an empty database (`mf_ci`)                                                                                                                            | all apply cleanly (none added)                                                                            |
| Backend integration with coverage threshold (`medoflow_app`, RLS on)                                                                                                 | **28 files · 371 passed, 1 skipped** (the opt-in availability benchmark). Lines 65.69 %, branches 71.72 % |
| Backend dependency audit                                                                                                                                             | no unaccepted high or critical advisories                                                                 |
| Frontend typecheck                                                                                                                                                   | clean                                                                                                     |
| Frontend ESLint (zero warnings)                                                                                                                                      | clean                                                                                                     |
| Frontend unit and component tests with coverage threshold                                                                                                            | **53 files · 606 passed**                                                                                 |
| Playwright, targeted (production build, mocked API): `start-scribe`, `consultation-room`, `video-consultation`, `scribe-review`, `clinic-onboarding`, `layout-smoke` | **48 passed**, 0 failed, in 10.0 min                                                                      |

Commands:

```zsh
cd backend
pnpm typecheck && pnpm lint && node scripts/check-synthetic-fixtures.js && pnpm test:coverage
DB=mf_ci
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB pnpm exec prisma migrate deploy
docker exec mf-pg psql -U postgres -d $DB -c "ALTER ROLE medoflow_app WITH LOGIN PASSWORD 'ci_app_password'"
INTEGRATION_DATABASE_URL=postgresql://medoflow_app:ci_app_password@localhost:55432/$DB \
INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB \
  pnpm test:integration:coverage
node scripts/audit-backend.js
cd ../frontend && pnpm typecheck && pnpm lint && pnpm test:coverage
npx playwright test e2e/start-scribe.spec.ts e2e/consultation-room.spec.ts e2e/video-consultation.spec.ts \
  e2e/layout-smoke.spec.ts e2e/clinic-onboarding.spec.ts e2e/scribe-review.spec.ts
node ../scripts/check-no-em-dash.js frontend
```

### 4.2 Backend unit tests (`usageAnalytics.test.ts`, 30 tests)

- **Allow-list:**
  - only the 12 keys survive;
  - PHI put into allow-listed keys is dropped (an email in `source`, a name in `outcome`, a DOB in `count`, a name as `clinic_id`);
  - counts are bounded;
  - a captured event has exactly the expected properties, and none of the synthetic PHI strings appear anywhere in it.
- **Identity:**
  - staff ids are `u_` plus a 32-hex HMAC, and the raw id never appears;
  - a different salt gives a different id;
  - patients map to `clinic_<id>_patients`;
  - an unknown role maps to `clinic_<id>_system`.
- **Safety:**
  - off without config, and always off under `NODE_ENV=test`;
  - production needs `USAGE_ANALYTICS_POLICY=no-phi`;
  - a throwing client never breaks `logAudit`;
  - a failing plan lookup still sends the event, without the plan.
- **Audit hook:**
  - `VISIT_FINALIZED` counts;
  - READ, BREAK_GLASS_ACCESS, LOGIN_FAILURE and generic UPDATE don't;
  - PHI in `oldValue` and `newValue` never reaches the payload;
  - consent outcomes are an enum;
  - the ambient role is used only when the context user is the actor.
- **Catalog:**
  - unique keys and known areas;
  - **every mapped audit action is written somewhere in `backend/src`** (a drift guard);
  - `ACTION:EntityType` resolution.
- **Group sync:** sends exactly the 11 business-fact properties, and is a no-op when off.
- **Boot checks:**
  - nothing set gives one warning;
  - a weak salt is fatal;
  - production without the policy is fatal;
  - messages never contain values;
  - the read config validation works.
- **Read side:**
  - zero-use features are listed and ranked by reach;
  - retired keys are ignored;
  - the totals and scribe adoption are correct;
  - the request is a server-side Bearer HogQL query filtered on env and range;
  - results are cached;
  - an HTTP failure gives a clean 502;
  - only fixed ranges reach the query (`'1; DROP TABLE events'` becomes 30);
  - the CSV joins names from our database and neutralises `=HYPERLINK(...)`.

### 4.3 Backend integration (real Postgres, `medoflow_app`, RLS on)

`usageAnalytics.int.test.ts` (8 tests), through the real API with a fake PostHog client:

- **Owner walk-in booking:**
  - It gives `appointment.created` with `source=WALK_IN`, `mode=IN_PERSON`, `role=SUPER_ADMIN`, `plan=FREE`, `env=it` and the clinic group.
  - The audited `PATIENT_CREATED` also counts.
  - The payload never contains the patient's name, phone, patient id, or the owner's id or email.
  - Marking the appointment completed gives `appointment.completed`.
- **Sign-ins:**
  - Front-desk and patient sign-ins give `auth.login` with their roles.
  - The staff member is hashed; the patient is `clinic_<id>_patients`.
- **Not counted:** a failed sign-in counts nothing, and with analytics off, actions still succeed and nothing is sent.
- **`/platform/usage`:**
  - 403 for the clinic owner, 401 when anonymous;
  - `{configured:false}` without the read keys, and the CSV gives 404;
  - with a stubbed PostHog, every catalog feature is listed with reach and zero-use features included;
  - every call goes to `https://us.posthog.com/api/projects/<id>/query/`.
- **CSV export:**
  - `text/csv`, with a dated filename;
  - a header and one row per clinic × feature;
  - a `USAGE_EXPORTED` audit row naming the platform admin, `clinicId: null`, `{days: 30}`.

`aiScribe.int.test.ts`, new case:

- A full scribe run emits these events: `scribe.session_started`, `consult.consent`, `scribe.draft_generated` (from the worker), `scribe.approved` (`role=PROVIDER`, `sent_to_patient=false`, `count=0`) and `consult.visit_finalized`.
- None of the transcript text or the patient id appears in them.

### 4.4 Frontend

- **`platformUsage.test.tsx` (5 tests):**
  - the KPIs (3 / 4 clinics, 75 % adoption, 2 / 3 features);
  - the table ranked by reach, with "3 (75%)";
  - the least-used list starts with "Not used";
  - the area filter and the range change (the 90-day request);
  - the not-configured state, with Export disabled;
  - a PostHog error with retry;
  - Export calls the selected range.
- **`scribeOrigin.test.ts`:** the "Start scribe" links carry `from`.
- **The existing `staticGuards.test.ts` stays green:** no browser telemetry SDK was added.

### 4.5 Real SDK wire capture

The real emitter and `posthog-node@5.61.1` were pointed at a local HTTP capture server (`POSTHOG_HOST=http://127.0.0.1:4399`). It ran `trackUsage('scribe.approved', …)`, with an `email` deliberately smuggled into the extras. Result:

- **Requests:** exactly **one** request, `POST /batch/`, gzip, user agent `posthog-node/5.61.1`. There were no feature-flag, remote-config or survey calls.
- **Log:** `[usage-analytics] scribe.approved: dropped properties email`.
- **Body:**

```json
{
  "event": "feature_used",
  "properties": {
    "sent_to_patient": true,
    "count": 2,
    "feature": "scribe.approved",
    "area": "scribe",
    "role": "PROVIDER",
    "env": "wiretest",
    "$lib": "posthog-node",
    "$lib_version": "5.61.1",
    "$is_server": true,
    "$geoip_disable": true
  },
  "distinct_id": "u_9a0ce443b2d5d7b059ec845626a6d865",
  "timestamp": "…",
  "uuid": "…"
}
```

The only properties are our allow-list plus the SDK's own `$lib`, `$lib_version`, `$is_server` and `$geoip_disable`. The user id is hashed.

---

## 5. Design notes

### 5.1 How it works

```
action succeeds ─► logAudit(row) ──► trackAuditAction ─┐   (mapped actions only)
              └──► trackUsage(feature, extra) ─────────┤   (explicit, after commit)
                                                       ▼
          resolve actor (tenant context) ─► plan lookup (cached) ─► sanitize (allow-list)
                                                       ▼
                  posthog-node queue ─► batched POST /batch/ (US Cloud) every 10 s / 20 events

/platform/usage ─► backend ─► HogQL (Query API, personal key, Query: Read) ─► merge with catalog ─► page
```

- **One event name, `feature_used`.** That keeps HogQL and PostHog insights simple: break down by `feature`.
- **Clinic groups:** events carry `groups: {clinic}`, and a daily `groupIdentify` sends business facts.
  - The facts sent: name, plan, status, verification, active, onboarding completed, published site, provider count, created at.
  - PostHog group analytics is a paid add-on. The in-app page doesn't need it, because it groups by `properties.clinic_id`.
- **Environments are kept apart by `env`** (`USAGE_ANALYTICS_ENV`). The page reads only its own env.
- **Delivery:** fire and forget, with a no-op when not configured, so analytics can never slow down or break a clinic action. Events queued at a hard crash can be lost, which is acceptable for analytics.

### 5.2 The event catalogue (what is counted)

| Area                        | Features                                                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI Scribe and consult       | `scribe.session_started`, `scribe.recording_started` (source), `scribe.draft_generated`, `scribe.draft_edited`, `scribe.approved` (sent_to_patient, count), `scribe.summary_published`, `consult.visit_finalized`, `consult.live_transcription`, `consult.consent` (outcome) |
| Video                       | `video.room_created`, `video.joined`, `video.auto_ended`                                                                                                                                                                                                                     |
| Scheduling                  | `appointment.created` (source, mode), `.rescheduled`, `.cancelled`, `.recurring_created`, `.completed`, `.no_show`, `waitlist.joined`, `waitlist.booked`                                                                                                                     |
| Commerce                    | `rxcart.built`, `rxcart.confirmed`, `checkout_link.sent`, `checkout_link.opened`, `cart.checkout`, `payment.confirmed`, `pos.invoice_finalized`, `pos.manual_payment`, `product.created`, `inventory.adjusted`, `membership.purchased`, `treatment_plan.created`             |
| Intake and forms            | `intake.submitted`, `forms.template_created`                                                                                                                                                                                                                                 |
| Website                     | `site.template_installed`, `site.page_published`, `site.published`, `site.address_live`, `site.address_failed`, `site.domain_added`, `site.asset_uploaded`                                                                                                                   |
| Onboarding and integrations | `clinic.signup`, `clinic.agreement_signed`, `clinic.approved`, `clinic.offboarded`, `onboarding.brand_saved`, `onboarding.npi_lookup` (outcome), `calendar.google_connected`                                                                                                 |
| Staff and sign-in           | `auth.login`, `staff.invited`, `staff.invite_accepted`, `patient.created`                                                                                                                                                                                                    |

**Properties (the complete allow-list):**

| Property                 | Values                              |
| ------------------------ | ----------------------------------- |
| `feature`                | a catalog key                       |
| `area`                   | one of the 8 areas                  |
| `role`                   | a `Role` enum value or `SYSTEM`     |
| `clinic_id`, `tenant_id` | record ids                          |
| `plan`                   | FREE, STARTER, GROWTH or ENTERPRISE |
| `env`                    | the environment tag                 |
| `source`                 | a booking source or scribe origin   |
| `mode`                   | IN_PERSON or VIRTUAL                |
| `outcome`                | a small enum                        |
| `count`                  | 0 to 10,000                         |
| `sent_to_patient`        | a boolean                           |

**Adding a feature:** add a row to `usageFeatures.ts`. If there's no audit row for it, call `trackUsage('<key>')` at its success point. The drift test and the page pick it up automatically.

### 5.3 Metrics this setup gives you, and why each matters

⚑ = built in PostHog's UI (funnels, retention, cohorts). The rest are on `/platform/usage`, or derived from its CSV.

| #   | Metric                                      | How it's computed                                                                                  | Benefit                                                                                                        |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | **Usage per feature over time**             | weekly count by `feature`                                                                          | Shows what's growing, flat or declining. This is AC2.                                                          |
| 2   | **Clinics using each feature** (reach)      | distinct `clinic_id` per feature, and the % of active clinics                                      | Separates broad adoption from one heavy-user clinic. The main input for which plan includes what.              |
| 3   | **Least-used and never-used features**      | catalog left-joined with usage                                                                     | Candidates to cut, fix, or explain better in onboarding. Zero-use shows because the catalog is local.          |
| 4   | **Per-clinic feature matrix (CSV)**         | clinic × feature counts and last used                                                              | B12.3 tier planning: what each plan's clinics actually use. Also account reviews, upsell and churn-risk calls. |
| 5   | **Active clinics**                          | distinct clinics with any event in the range (KPI tile)                                            | Health of the customer base, and an early churn warning (a clinic going quiet).                                |
| 6   | **Active staff per clinic** ⚑               | distinct hashed staff ids per clinic                                                               | Seat use against the sign-up `estimatedSeats`, for per-seat pricing.                                           |
| 7   | **Scribe adoption**                         | `scribe.approved` ÷ `appointment.completed` (KPI tile; per clinic in the CSV)                      | The core selling point (CTO-12). Measures CTO-36's "forgot to start" problem and gives CTO-36 its baseline.    |
| 8   | **Scribe funnel** ⚑                         | session_started → draft_generated → approved → summary_published                                   | Where providers drop off: AI quality, or approval friction.                                                    |
| 9   | **Scribe start origin**                     | `source` on `scribe.recording_started` (command_center, appointments_list, reminder, consult_room) | Whether CTO-30's "Start scribe" buttons and reminders are used.                                                |
| 10  | **Draft edit rate**                         | `scribe.draft_edited` ÷ `scribe.draft_generated`                                                   | A proxy for AI draft quality.                                                                                  |
| 11  | **Booking channel mix**                     | `appointment.created` by `source`                                                                  | Walk-in and phone (CTO-24) against portal and public booking. Shows the value of the website and self-booking. |
| 12  | **Virtual vs in-person mix**                | `mode` on `appointment.created`                                                                    | Telehealth demand (CTO-31), which sizes the video (JaaS) cost.                                                 |
| 13  | **No-show and cancellation rates**          | completed, no_show, cancelled and rescheduled counts                                               | Clinic operations health; justifies reminders and deposits.                                                    |
| 14  | **Rx→Cart revenue funnel** ⚑                | rxcart.built → checkout_link.sent → opened → cart.checkout / payment.confirmed                     | Where patients abandon the scribe-to-purchase path (CTO-32/33).                                                |
| 15  | **Front-desk POS use**                      | `pos.invoice_finalized`, `pos.manual_payment`                                                      | In-person against online payment.                                                                              |
| 16  | **Storefront activity**                     | product.created, inventory.adjusted, packages, memberships                                         | Whether commerce is worth more investment (and demand for the CTO-40 import).                                  |
| 17  | **Website adoption and launch reliability** | template_installed → published → address_live; `site.address_failed`                               | How many clinics want a site now that it's optional (CTO-23), and the CTO-26 launch failure rate.              |
| 18  | **Onboarding funnel and time to value** ⚑   | clinic.signup → agreement_signed → approved → first appointment → first scribe approved            | Activation: how long until a clinic gets value, and where sign-ups stall.                                      |
| 19  | **NPI verification outcomes**               | `outcome` on `onboarding.npi_lookup`                                                               | A data-quality and fraud signal for platform review (CTO-29).                                                  |
| 20  | **Integration uptake**                      | Google Calendar connected, live transcription, video                                               | Which integrations deserve polish (CTO-37 / CTO-41).                                                           |
| 21  | **Clinic retention cohorts** ⚑              | PostHog retention on `clinic_id` (or the clinic group)                                             | Do clinics keep using MedoFlow week after week, by sign-up cohort or plan?                                     |
| 22  | **Usage by plan and role** ⚑                | breakdown by `plan` and `role`                                                                     | Shows whether features are used by the people and tiers we built them for.                                     |

**Not measurable, by design:**

- anything about an individual patient;
- clinical content;
- page views and clicks (there is no browser SDK);
- reception check-in (no backend event exists yet).

---

## 6. What you must do manually

1. **Create the PostHog account:** go to <https://us.posthog.com/signup>. Choose **US Cloud** (data stays in the US), with organisation "MedoFlow".
   - Make one project per environment ("MedoFlow demo", later "MedoFlow production").
   - Or use one project and rely on `USAGE_ANALYTICS_ENV`. Separate projects are cleaner.
2. **Project settings, for each project:**
   - **Settings → Project → "Discard client IP data": ON.**
   - Autocapture, session replay, heatmaps and surveys: leave **OFF**. They're unused server-side, and this guards against a future browser snippet.
3. **Organisation settings:**
   - Turn **PostHog AI / AI features OFF**; they're not covered by any BAA.
   - Don't use PostHog's managed reverse proxy.
4. **Copy the keys:**
   - **Project API key** (`phc_…`) → `POSTHOG_API_KEY`.
   - **Project ID** (the number in the URL or settings) → `POSTHOG_PROJECT_ID`.
   - **Account → Personal API keys → Create**, scoped to **that project only**, with only **Query: Read** → `POSTHOG_PERSONAL_API_KEY` (`phx_…`).
5. **Generate the salt:** `openssl rand -hex 32` → `USAGE_ANALYTICS_SALT`.
   - **Keep it stable and secret.** Changing it splits staff history into new ids.
   - Store it in your password manager.
6. **Render (backend service) → Environment:**
   - Set `POSTHOG_API_KEY`, `USAGE_ANALYTICS_SALT`, `POSTHOG_PROJECT_ID` and `POSTHOG_PERSONAL_API_KEY`.
   - `USAGE_ANALYTICS_POLICY=no-phi` and `USAGE_ANALYTICS_ENV=demo` are already in `render.yaml`.
   - `POSTHOG_HOST` and `POSTHOG_APP_HOST` default to US Cloud. Set them only for EU or self-hosting.
   - Redeploy.
   - Check the boot log: the line `POSTHOG_API_KEY is not set` should be gone, and no `FATAL` line should mention `USAGE_ANALYTICS_*`.
7. **Smoke test (about 5 minutes):**
   - Sign in to the demo as a clinic owner, create an appointment and run a scribe.
   - In PostHog, open **Activity → Live events**. You should see `feature_used` with `env=demo`, and no names or emails in the properties.
   - Open `https://<app>/platform/usage` as a platform admin. The page caches for 5 minutes, so wait or switch range to see new data.
8. **Optional, in PostHog:**
   - Build a dashboard with: Trends of `feature_used` broken down by `feature`; unique `clinic_id`; and Funnels 8 / 14 / 18 from §5.3 (filter `env = demo`).
   - Enable the **Group analytics** add-on only if you want per-clinic profiles inside PostHog. It's paid, and billing starts when you enable it.
9. **Billing guard:** in PostHog **Billing**, set a limit or alert at the free 1M events per month. Expected volume is a few thousand events per clinic per month.
10. **Compliance record:** confirm the HIPAA register decision ("PostHog: no-PHI, no BAA") with Khush and the Security Officer, in the PR.
11. **Git:** this branch isn't pushed. When you're ready: push `feat/cto-39-usage-analytics` and open a PR into `development`.

---

## 7. HIPAA / review checklist

- [x] **No PHI in payloads.** Allow-list plus strict validators. Tested in unit, integration and the real wire capture (§4.5).
- [x] **No PHI to a non-BAA endpoint.** PostHog only receives ids, enums and counts.
  - Staff ids are HMAC-hashed.
  - Patients are aggregated per clinic.
  - GeoIP is off.
- [x] **Audit values never read** by the usage hook (test).
- [x] **Least privilege on the read key:** Query: Read only, server-side only, never sent to the browser.
- [x] **Export is platform-admin only and audited** (`USAGE_EXPORTED`, ids only). The CSV has no patient or staff data and is protected against formula injection.
- [x] **Boot refusal:** production won't send without `USAGE_ANALYTICS_POLICY=no-phi` and a 32+ character salt.
- [x] **Docs:**
  - BAA register (§1.2) updated;
  - retention policy updated;
  - frontend telemetry allow-list unchanged (no browser SDK).
- [x] **Supply chain:** exact, two-week-old version pins; backend audit clean.
- [ ] **Owner:** PostHog project settings from §6 (IP discard ON, AI OFF), and the register decision signed off.

---

## 8. Known limits

- **Check-in isn't counted:** there's no check-in in the product yet (no `CHECKED_IN` status or endpoint). Add `appointment.checked_in` when CTO-36's walk-in trigger lands.
- **Browser-only actions are inferred, not counted directly:**
  - Per-line key-change approve and reject (CTO-33) shows only through `scribe.approved.count` (Rx lines kept).
  - The manual "end call" button isn't an event; `video.auto_ended` and the recording events are.
- **Scribe adoption depends on staff marking visits Completed.** Clinics that never mark completion show "n/a" or an inflated rate. The CSV gives per-clinic counts to judge this.
- **Webhook retries:** `payment.confirmed` follows the audit row, so a Stripe retry that writes a second audit row counts twice. `membership.purchased` is de-duplicated.
- **Google Calendar "start scribe from meeting"** counts as `scribe.session_started`, but its recording has no `from`; it's counted as `consult_room`.
- **Group analytics** inside PostHog needs the paid add-on. Everything on `/platform/usage` works without it.
- **The plan is captured at event time** (cached up to 5 minutes), so a plan change shows on new events only. That's the right behaviour for "usage by plan".
- **Possible event loss:** events queued in memory can be lost on a hard crash (not on a graceful shutdown).

---

## 9. Manual local testing guide (macOS)

### 9.1 Without a PostHog account (wire capture, about 5 minutes)

This proves what would be sent, using a local server instead of PostHog.

```zsh
REPO=~/Work/AdvertOut/MedoFlow
mkdir -p /tmp/ph && cat > /tmp/ph/srv.js <<'EOF'
const http=require('http'),zlib=require('zlib')
http.createServer((q,s)=>{const c=[];q.on('data',d=>c.push(d));q.on('end',()=>{let b=Buffer.concat(c);try{b=zlib.gunzipSync(b)}catch{};console.log(q.url,b.toString());s.end('{"status":1}')})}).listen(4399)
EOF
node /tmp/ph/srv.js &      # terminal 1 shows every batch
```

Then start the backend as in the CTO-23 guide (`cto-feedback-t1-t3-WALKTHROUGH-AND-VERIFICATION.md` §9.2), adding these lines to the local env file:

```
POSTHOG_API_KEY=phc_local
POSTHOG_HOST=http://127.0.0.1:4399
USAGE_ANALYTICS_SALT=<openssl rand -hex 32>
USAGE_ANALYTICS_ENV=local
```

Then, in the app:

1. Sign in as an owner. Within 10 s, terminal 1 prints a `/batch/` body with `auth.login`.
2. Book a walk-in, then mark it completed. You should see `appointment.created` (`source: WALK_IN`) and `appointment.completed`.
3. Click **Start scribe** on the Command Center, then record. You should see `scribe.recording_started` with `source: command_center`.
4. Check every body for any name, email, phone or note text. **There must be none.**

### 9.2 With the real PostHog project

1. Do §6 steps 1 to 5. Put the same values in your local env file (`USAGE_ANALYTICS_ENV=local`, and no `POSTHOG_HOST`).
2. Repeat 9.1 steps 1 to 3. In PostHog **Live events**, filter `env = local`.
3. Sign in as a platform admin. Go to **Usage** in the top nav (or `/platform/usage`) and check:
   - the KPI tiles;
   - the features ranked by reach;
   - the least-used list (mostly "Not used" on a fresh setup);
   - the range tabs;
   - Export CSV, which downloads `medoflow-feature-usage-30d.csv` with one row per clinic × feature.
4. Without the read keys, the page says "Usage analytics is not connected yet" and Export is disabled.

### 9.3 Result sheet

| Check                                   | Expected                                      | Result |
| --------------------------------------- | --------------------------------------------- | ------ |
| Sign-in event                           | `auth.login`, hashed `u_…` id                 |        |
| Walk-in booking                         | `appointment.created`, `WALK_IN`, `IN_PERSON` |        |
| Start scribe from the Command Center    | `scribe.recording_started`, `command_center`  |        |
| No PHI in any body                      | none                                          |        |
| `/platform/usage` loads, CSV downloads  | yes                                           |        |
| Owner account opening `/platform/usage` | redirected away (platform admins only)        |        |
