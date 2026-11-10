# Clinic onboarding — practice application, signed agreement, platform review and go-live gate: walkthrough and verification

**Date:** 2026-11-10 · **Branch:** `feat/clinic-onboarding`, cut from `development` at `e97e99d` (after PR #20) · **Data:** synthetic only.

**Trigger:** the owner asked for a complete clinic sign-up and onboarding process, compatible with the existing platform. The field set was taken from the Healing Biologix clinic account application (`healingbiologix.net/clinic-signup`):

- **Practice information:** legal name / DBA, number of locations, address, order contact / office manager / accounts payable, phone, fax, website, group NPI with a verify step (or "I don't have an NPI"), Tax ID, DEA, license.
- **Practitioners:** a repeatable list with an individual NPI each and an "owner on record".
- **Authorization:** communications consent plus a typed signature (print name & title, signature, date).
- **Admin review before activation.**

**The owner's decisions (2026-11-10):**

- the review gates go-live;
- NPI checks are **checksum only** (no NPPES lookup);
- **no billing** in this task (B12.2 stays separate);
- a new branch from `development`.

---

## 1. Outcome

| Item                                                                                                                                                                                                                                                                                                           | Status | Evidence                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Sign-up → **practice application** (practice → practitioners → agreement), in order, not skippable                                                                                                                                                                                                             | ✅     | `onboardingRedirect` unit table (11 cases); `clinicOnboarding.int.test.ts` "runs in order"; e2e owner journey; real run §4.6    |
| Practice details with HBX's fields: legal name/DBA, practice type, locations, primary address (→ main location + **timezone**), office phone/fax/website, primary contact / office manager / accounts payable, mailing address, group NPI or "no NPI", EIN, state license, DEA, team size, referral, sales rep | ✅     | int "stores the practice…"; e2e request body                                                                                    |
| NPI / EIN / DEA format + check-digit validation, the same on both sides                                                                                                                                                                                                                                        | ✅     | `practiceIds.test.ts` (backend 44, frontend 38) on `shared/validation-cases/practice-ids.json`; inline ✓/✗ feedback (e2e)       |
| Practitioners: 1–20, exactly one owner on record, unique emails, NPI each when the practice has a group NPI, "This is me"                                                                                                                                                                                      | ✅     | int "requires exactly one owner…"; `clinicOnboarding.test.tsx`; e2e                                                             |
| Agreement: 5 acknowledgements, **communications authorization**, print name + title, **typed signature must match**, retype clinic name; stored as an append-only `ClinicAgreement` row (IP, user agent)                                                                                                       | ✅     | int "signing checks…", "append-only for the app role"; e2e                                                                      |
| Tax ID and DEA **encrypted at rest**, masked to the clinic, full to the reviewer (reads audited), never in the audit log                                                                                                                                                                                       | ✅     | int: `fle:v1:` envelopes in the raw row, masked API, `CLINIC_APPLICATION_VIEWED`                                                |
| **Go-live gate:** until APPROVED, no public clinic API, no site host, no availability, no slot holds, no patient booking, no enquiry form, not listed                                                                                                                                                          | ✅     | int "nothing public is reachable" and "approve → live"; real run                                                                |
| **Platform review:** queue with count, full application, Approve / Request changes (note required) / Reject; idempotent; audited; owner notified                                                                                                                                                               | ✅     | int "queue → … → live", "reject…", "only platform admins…"; e2e platform spec; real run                                         |
| Request changes → owner edits in **/dashboard/clinic** → **Resubmit**                                                                                                                                                                                                                                          | ✅     | int; e2e "changes requested"                                                                                                    |
| Owner dashboard: **review banner** (under review / changes requested with note / rejected) and the promised **setup checklist** (8 items, deep links)                                                                                                                                                          | ✅     | `clinicOnboarding.test.tsx` (banner states, checklist items, partial data); e2e                                                 |
| `CLINIC_REVIEW_MODE=auto` (demo) approves on submit; platform-created clinics and **all existing clinics** are APPROVED                                                                                                                                                                                        | ✅     | int "auto mode", "platform-created"; migration sets existing rows `APPROVED`                                                    |
| Wizard fixes: Locations step saved nothing (`PATCH /locations/:id` didn't exist); failed steps were silent; saved step never resumed; `/onboarding/complete` had no role check                                                                                                                                 | ✅     | int PATCH (own / other clinic 404 / front desk 403); `/onboarding/*` owner-only (int 403); resume unit test; e2e Locations step |
| Providers step invites the application's practitioners with their NPI/license; "Add me" copies the owner's NPI/license                                                                                                                                                                                         | ✅     | int "Add me…"; real run                                                                                                         |
| Sign-up hardening: own rate-limit bucket, SiteDomain label conflict → 409, `TENANT_SIGNUP` audit                                                                                                                                                                                                               | ✅     | `tenantSignup.int.test.ts` (+2)                                                                                                 |
| Off-boarding still complete: the profile is destroyed, signed agreements retained                                                                                                                                                                                                                              | ✅     | `dataLifecycle.int.test.ts` (plan coverage), int "off-boarding"                                                                 |
| Demo presenter's script rewritten end to end, including from-scratch clinic setup and reset commands                                                                                                                                                                                                           | ✅     | `arh-agent-docs/tech-demo-script.md` (gitignored, local)                                                                        |

---

## 2. Problems found (root causes)

1. **The wizard's Locations step never saved.** It called `PATCH /locations/:id`, which didn't exist (only `POST`/`GET`). Signup always creates "Main Location", so every owner hit it. `OnboardingShell.handleNext` had no `catch`, so the button just stopped. The default timezone `UTC` was therefore never fixed.
2. **Agreement data lived only in an audit row.** Legal name, tax ID (in clear text) and mailing address were written into `AuditLog.newValue` JSON, with no columns behind them.
3. **No verification at all.** A clinic was live, with public site, booking and contact form, the moment it signed up. `Tenant.status` was never read.
4. **Promised features that didn't exist:**
   - The Welcome page promised "a setup checklist on your dashboard"; there was none.
   - The Brand step said "change this anytime from Settings"; there's no such page. `/dashboard/clinic` is now the clinic profile.
   - `onboardingStep` was saved but never used to resume.
5. **Wizard endpoints had no role check.** `/onboarding/complete`, `/step` and `/brand` could be called by any staff member of the clinic.
6. **Signup failures used up the login budget.** `POST /tenants/signup` shared `authRateLimit` with login, so a mistyped signup could lock the same person out of signing in.
7. **Address squatting.** A `SiteDomain` holding the label without a Brand let signup succeed silently with **no website**.
8. _Found by e2e during this task:_ the dashboard's new checklist and clinic page crashed the whole page on a partial status/application response. Both now render nothing, or an error card, instead (unit test "partial status").

---

## 3. What changed (files)

### Backend

| Area                 | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema + migration   | [schema.prisma](../backend/prisma/schema.prisma): `Tenant.verificationStatus` (+ submitted/reviewed fields), enum `ClinicVerificationStatus`, models `ClinicProfile` and `ClinicAgreement`, `Provider.npi/licenseState/credentials`. [20261110000000_clinic_onboarding_application](../backend/prisma/migrations/20261110000000_clinic_onboarding_application/migration.sql): existing tenants → `APPROVED`, new default `PENDING_REVIEW`; RLS on both tables; `ClinicAgreement` insert-only for `medoflow_app`                                                                                                                        |
| Registries           | [prisma.ts](../backend/src/config/prisma.ts) (`CLINIC_SCOPED_MODELS`, `HARD_DELETE_PROTECTED_MODELS`), [fieldCrypto.ts](../backend/src/utils/fieldCrypto.ts) (`ClinicProfile.federalTaxId`, `deaNumber`), [dataLifecycleService.ts](../backend/src/services/dataLifecycleService.ts) (agreements retained and exported)                                                                                                                                                                                                                                                                                                                |
| Validation           | [practiceIds.ts](../backend/src/utils/practiceIds.ts) (NPI Luhn with the 80840 prefix, EIN, DEA checksum, masking, US states, practice types); [onboardingSchemas.ts](../backend/src/validation/onboardingSchemas.ts) (practice, practitioners, agreement, review decision); [module1Schemas.ts](../backend/src/validation/module1Schemas.ts) (`locationPatchSchema`, provider credentials)                                                                                                                                                                                                                                            |
| Application + review | [clinicApplicationService.ts](../backend/src/services/clinicApplicationService.ts) (new): get / save practice (+ main location) / save practitioners / sign agreement / resubmit / review / application-for-review; [clinicReview.ts](../backend/src/config/clinicReview.ts) (`CLINIC_REVIEW_MODE`, `PLATFORM_REVIEW_EMAIL`); [emailService.ts](../backend/src/services/emailService.ts) (3 HTML-escaped templates, best-effort)                                                                                                                                                                                                       |
| Go-live gate         | [clinicVerification.ts](../backend/src/services/clinicVerification.ts) (`liveClinicWhere`, `assertClinicLive`), used in [publicController.ts](../backend/src/controllers/publicController.ts), [appointmentController.ts](../backend/src/controllers/appointmentController.ts) (patients), [hostService.ts](../backend/src/site/services/hostService.ts), [renderService.ts](../backend/src/site/services/renderService.ts) (public `locate` / page lookups only; the editor preview is not gated), [sites.routes.ts](../backend/src/site/http/public/sites.routes.ts) (leads). The host cache is cleared on every decision            |
| Routes               | [onboarding.ts](../backend/src/routes/onboarding.ts): `GET /application`, `PUT /application/practice`, `PUT /application/practitioners`, `POST /agreement` (reworked), `POST /application/resubmit`; every route owner-only. [platform.ts](../backend/src/routes/platform.ts): `verification` filter, `pendingReview`, application in detail, `POST /clinics/:tenantId/review`. [locations.ts](../backend/src/routes/locations.ts): `PATCH /:id`. [tenants.ts](../backend/src/routes/tenants.ts): `signupRateLimit`, `publicApiRateLimit` on check-subdomain                                                                           |
| Status / auth        | [onboardingService.ts](../backend/src/services/onboardingService.ts) (status adds `verification`, `application`, checklist `availability` and `website`; brand counts a site-editor logo); [authController.ts](../backend/src/controllers/authController.ts) (`/auth/me` and login: verification fields + `clinicProfile` progress)                                                                                                                                                                                                                                                                                                    |
| Other                | [tenantService.ts](../backend/src/services/tenantService.ts) (SiteDomain conflict 409, `TENANT_SIGNUP` audit); [platformAdminService.ts](../backend/src/services/platformAdminService.ts) (platform-created → APPROVED; list/detail fields); [providerService.ts](../backend/src/services/providerService.ts), [staffService.ts](../backend/src/services/staffService.ts) (credentials; "Add me" copies the owner's NPI/license); [rateLimit.ts](../backend/src/middleware/rateLimit.ts); seeds and fixtures create APPROVED tenants; [.env.example](../backend/.env.example); [render.yaml](../render.yaml) `CLINIC_REVIEW_MODE=auto` |

### Frontend

| Area              | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application pages | [practice/page.tsx](../frontend/app/%28onboarding%29/practice/page.tsx), [practitioners/page.tsx](../frontend/app/%28onboarding%29/practitioners/page.tsx) (new), [agreement/page.tsx](../frontend/app/%28onboarding%29/agreement/page.tsx) (rewritten: summary, acknowledgements, authorization, typed signature)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Components        | [ApplicationShell.tsx](../frontend/components/onboarding/ApplicationShell.tsx), [PracticeDetailsForm.tsx](../frontend/components/onboarding/PracticeDetailsForm.tsx), [PractitionersForm.tsx](../frontend/components/onboarding/PractitionersForm.tsx), [useApplication.ts](../frontend/components/onboarding/useApplication.ts), [VerificationBanner.tsx](../frontend/components/onboarding/VerificationBanner.tsx), [SetupChecklist.tsx](../frontend/components/onboarding/SetupChecklist.tsx), [ClinicApplicationReview.tsx](../frontend/components/platform/ClinicApplicationReview.tsx) (all new)                                                                                                                                                                                                                                                                                                                                                                                   |
| Logic             | [onboardingApi.ts](../frontend/lib/onboardingApi.ts), [practiceIds.ts](../frontend/lib/practiceIds.ts) (mirror), [schemas/onboarding.ts](../frontend/lib/schemas/onboarding.ts) (new); [routeGuards.ts](../frontend/lib/routeGuards.ts) (`onboardingRedirect`, `onboardingResumePath`, clinic-less owner → `/get-started`); [types.ts](../frontend/lib/types.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Wiring            | [(onboarding)/layout.tsx](../frontend/app/%28onboarding%29/layout.tsx) (uses the pure guard), [OnboardingShell.tsx](../frontend/components/onboarding/OnboardingShell.tsx) (error toast), [welcome](../frontend/app/%28onboarding%29/welcome/page.tsx) (review notice), [providers](../frontend/app/%28onboarding%29/providers/page.tsx) (invite application practitioners), [get-started](../frontend/app/%28public%29/get-started/page.tsx) (→ `/practice`), [DashboardLayout.tsx](../frontend/components/layout/DashboardLayout.tsx) (banner), [admin/page.tsx](../frontend/app/dashboard/admin/page.tsx) (checklist), [dashboard/clinic/page.tsx](../frontend/app/dashboard/clinic/page.tsx) (new), [AppSidebar.tsx](../frontend/components/layout/AppSidebar.tsx) ("Clinic profile"), [platform/clinics](../frontend/app/platform/clinics/page.tsx) (queue + review column), [platform/clinics/[tenantId]](../frontend/app/platform/clinics/%5BtenantId%5D/page.tsx) (review panel) |

### Tests

- **Backend:** `practiceIds.test.ts` (44), `clinicReview.test.ts` (2), `clinicOnboarding.int.test.ts` (16, new), `tenantSignup.int.test.ts` (+2), `dataLifecycle.int.test.ts` (plan coverage updated), `module4Remediation.test.ts` (gate stub).
- **Frontend:** `practiceIds.test.ts` (38), `onboardingSchemas.test.ts` (9), `clinicOnboarding.test.tsx` (6), `routeGuards.test.ts` (+13, now 41).
- **e2e:** `clinic-onboarding.spec.ts` (3, new), `clinic-signup.spec.ts` (lands on `/practice`), `mockApi.ts` (live onboarding state, defaults for an approved clinic).

---

## 4. Verification: commands and results

All commands run on Windows 10 in Git Bash, with Postgres 18 in Docker (`mf-pg`, port 55432).

### 4.1 Gates

```bash
cd backend && npx tsc --noEmit -p .                         # → no output
npx eslint src --max-warnings=0                             # → no output
cd ../frontend && npx tsc --noEmit -p .                     # → no output
npx eslint <every changed frontend file>                    # → no output
```

### 4.2 Backend unit

```bash
cd backend && npx vitest run
#   → 32 files · 509 passed (practiceIds 44, clinicReview 2; module4Remediation stubs the booking gate)
```

### 4.3 Backend integration (real Postgres, `medoflow_app` role, RLS on)

```bash
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it corepack pnpm exec prisma migrate deploy
#   → applied 20261110000000_clinic_onboarding_application
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it
corepack pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/clinicOnboarding.int.test.ts
#   → 16 passed
corepack pnpm exec vitest run --config vitest.integration.config.ts
#   → 20 files · 305 passed, 1 skipped (the skip is pre-existing)
```

`clinicOnboarding.int.test.ts` covers:

- **In review, nothing public:** `/public/clinics/:slug` and the clinic list, the site host, `/public/slots/hold`, `/public/availability/summary` and the enquiry form.
- **Order:** the steps run practice → practitioners → agreement (409 out of order).
- **Validation, with per-field messages:** NPI, EIN, DEA, state, timezone, mailing address, "no NPI".
- **Encryption:** `fle:v1:` envelopes at rest, masked in the API; blank keeps the value, null removes the DEA.
- **Practitioners:** owner on record, duplicates, NPI required.
- **Signing:** signature, consent and clinic-name checks, a single signature, the audit row without the tax ID, append-only for `medoflow_app`.
- **Review:** 403 for non-platform, 409 before signing, the queue and `pendingReview`, the full numbers plus `CLINIC_APPLICATION_VIEWED`, request changes → resubmit → approve → every public surface live, idempotent, the audit trail.
- **Modes:** reject freezes the application; auto mode; platform-created clinics are approved.
- **Locations and roles:** `PATCH /locations/:id` (own / cross-clinic 404 / front desk 403); staff 403 on onboarding.
- **Other:** "Add me" carries the NPI/license; off-boarding keeps the agreement and drops the profile.

`tenantSignup.int.test.ts` (+2): the records created, duplicate email 409, reserved 400, taken 409, SiteDomain-held label 409 with no tenant left behind.

### 4.4 Frontend unit / component

```bash
cd frontend && npx vitest run
#   → 38 files · 495 passed
```

The new and changed test files:

- `practiceIds.test.ts` (38, shared cases)
- `onboardingSchemas.test.ts` (9)
- `clinicOnboarding.test.tsx` (6): banner states, checklist items, checklist render, a partial status renders nothing, the practitioner list
- `routeGuards.test.ts` (41, of which 13 are new for onboarding)

### 4.5 Playwright (production build, mocked API)

```bash
cd frontend
NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 NEXT_PUBLIC_APP_URL=http://127.0.0.1:4310 corepack pnpm build
node scripts/e2e-server.js 4310            # terminal 2
E2E_EXTERNAL_SERVER=1 npx playwright test e2e/clinic-onboarding.spec.ts e2e/clinic-signup.spec.ts
#   → 6 passed
E2E_EXTERNAL_SERVER=1 npx playwright test
#   → 77 passed, 10 skipped (the E2E_LIVE_API specs), 0 failed (11.4 min)
```

The first full run had **4 failures**, all `layout-smoke` SUPER_ADMIN. The new **Clinic profile** nav link crashed on the mock's empty default answer. The clinic page and the checklist now render an error card or nothing on partial data, and `mockApi.ts` answers `/onboarding/*` like an approved clinic. After the fix: all green.

### 4.6 Real front end ↔ back end (no mocks)

Backend `ts-node src/server.ts` on :3999 with `backend/.env.manual-onboarding.local` (database `mf_onboard_manual`, `medoflow_app`, `CLINIC_REVIEW_MODE=manual`). Front end: the production build above on :4310. A headless Chromium script:

1. signs up on `/get-started` → lands on `/practice`, fills it → `/practitioners` → `/agreement` (summary shows `•••••6789`, never `12-3456789`) → signs → `/welcome` "Application submitted: under review";
2. `/locations` → **Save & continue** → `/disciplines` (the PATCH works) → **Skip setup for now** → dashboard banner "Your clinic is under review"; checklist "2 of 8 done";
3. as `platform@medoflow.test`: `/platform/clinics` "1 clinic application is waiting for review" → **Show queue** → the clinic → panel shows `12-3456789` and 3 × "checksum ok" → **Approve** → "Approved — live";
4. the owner reloads: banner gone; `GET /public/clinics/<sub>` → **200**.

**38 API calls, 0 × 5xx.** The guide in §9 was also run verbatim twice against this server. The first run found that a bad NPI answered zod's generic "Invalid input"; the optional-field helpers were rebuilt on `preprocess + refine`, and it now answers "Enter a valid 10-digit NPI" (integration test added).

### 4.7 Secrets

```bash
# every changed / new file, plus arh-agent-docs/tech-demo-script.md, with gitleaks v8.21.2 (default rules):
#   → 2 hits, both pre-existing and unchanged by this branch:
#     frontend/e2e/mockApi.ts:13 (synthetic e2e password, already in .gitleaksignore)
#     backend/.env.example (the truncated "-----BEGIN PRIVATE KEY-----\nMIIE..." JaaS placeholder in a comment)
```

The manual env file is generated with random throwaway keys and is gitignored (`.env.*.local`).

---

## 5. Design notes

- **One gate, applied where patients enter.** `liveClinicWhere` replaces the bare `isActive: true` on every public clinic lookup. An unapproved clinic simply _doesn't exist_ to the public: 404, never 403, so it can't be enumerated. Signed-in owner and staff paths (dashboard, site editor, preview) are not gated, so the clinic sets up while it waits.
- **Profile per clinic, status per tenant.** RLS is clinic-scoped, so `ClinicProfile` and `ClinicAgreement` key on `clinicId`. The review status is the customer account's, so it sits on `Tenant`, next to `status`/`plan`.
- **Existing clinics are untouched.** The migration adds the column with default `APPROVED` and only then switches the default to `PENDING_REVIEW`. Seeds and test fixtures create approved tenants. `createClinicByPlatform` creates approved tenants: the platform admin is the reviewer.
- **The signed agreement is evidence.** `ClinicAgreement` is insert-only for the app role (REVOKE UPDATE/DELETE/TRUNCATE). Off-boarding keeps it, with the audit trail, because HIPAA keeps policy/contract documentation for 6 years. `Tenant.terms*` keeps working for older code and reports.
- **Sensitive numbers.** EIN and DEA are field-encrypted, so they can't be filtered on (fine: nothing searches them). They're masked to the clinic. A blank field on edit means "keep what's on file"; DEA has an explicit "remove". The audit log records which regulated fields changed (names, not values), at `warning` severity if the clinic was already approved.
- **Checksums, not a registry.** NPI uses the CMS Luhn rule with the 80840 prefix. DEA uses its own check digit; EIN is format only. The reviewer verifies against NPPES and the state boards, which is the owner's choice. The badges in the review panel are format checks, labelled as such.
- **Strict owner guard.** The onboarding routes use a local `ownerOnly`: `role === SUPER_ADMIN` and nothing else. `authorize()` also lets break-glass staff through, and onboarding isn't an emergency.
- **Demo:** `render.yaml` ships `CLINIC_REVIEW_MODE=auto` like `BILLING_MODE=demo`. The demo script recommends `manual` on demo day so the review can be shown live.

---

## 6. What you must do manually

1. **Render → Environment:**
   - decide `CLINIC_REVIEW_MODE`: `manual` for real reviews, or for the demo's review step; `auto` approves on submit;
   - optionally set `PLATFORM_REVIEW_EMAIL`, where the "application waiting" e-mails go; without it, every active platform admin;
   - optionally set `SIGNUP_RATE_LIMIT_MAX` (default 10 sign-ups per IP per hour).
2. **SMTP:** without `SMTP_HOST`, the three onboarding e-mails are skipped (best-effort, the request still succeeds). Provider and staff **invites still fail** in production, as before.
3. **Deploy:** the migration runs on boot (`prisma migrate deploy`). Every existing clinic becomes `APPROVED`, so nothing changes for live clinics.
4. **Reviewer process:** check the NPI on NPPES, the state license on the board's site, and the DEA if given, then Approve / Request changes / Reject in `/platform/clinics/<tenantId>`.
5. **Plan status:** `arh-agent-docs/development-plan.md` is gitignored. The B12.1 and A.5 notes there are local edits only.

---

## 7. HIPAA / review checklist

- **No PHI in the application.** It's practice and practitioner business data. The patient-facing gate keeps unverified clinics from collecting PHI at all: no booking, no enquiry form, no site.
- **A.5 ("no PHI without a BAA on file") is partly done.** A clinic can't take patients through public channels until it has signed the agreement, including the BAA acknowledgement, and has been approved. The countersigned BAA document itself is still the A.5 template work.
- **Tax ID / DEA:** encrypted at rest, masked to the clinic. Reviewer reads are audited, and the values are never logged.
- **Audit actions:**
  - `TENANT_SIGNUP`
  - `CLINIC_PROFILE_CREATED` / `CLINIC_PROFILE_UPDATED`
  - `CLINIC_PRACTITIONERS_UPDATED`
  - `TERMS_ACCEPTED` (agreement id, signer, no tax data)
  - `CLINIC_APPLICATION_VIEWED`
  - `CLINIC_CHANGES_REQUESTED`, `CLINIC_APPLICATION_RESUBMITTED`, `CLINIC_APPROVED`, `CLINIC_REJECTED`
- **E-mails** escape every clinic- or reviewer-typed value.

## 8. Known limits

- **No registry lookup:** NPPES and state license boards are checked by the reviewer, not the system. That was the owner's choice.
- **No owner e-mail verification**, and **no licence document upload** (HBX doesn't ask for one either; its agreement says "on request").
- **Edits after approval** to regulated fields are audited (`warning`) but don't re-open the review.
- **Billing (B12.2)** is not part of this. Trial expiry is still not enforced.
- The Brand / Clinic / Site-settings brand fields are still three copies (pre-existing).
- **Invites from the Providers step** give each practitioner every discipline and service, to be refined on the provider page. They fail where SMTP is missing, as all invites do.
- `GET /tenants/resolve` (brand config for the storefront middleware) is not gated. It returns only colours, logo and subdomain.

---

## 9. Manual local testing guide

Everything below was run verbatim on 2026-11-10 (results shown). Synthetic data only.

### 9.1 Before you start

- Docker Desktop running, with the `mf-pg` container started (`docker start mf-pg`).
- A database for this guide, migrated and seeded (the seed creates `platform@medoflow.test` / `test1234`):

```bash
docker exec mf-pg psql -U postgres -c "CREATE DATABASE mf_onboard_manual"
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_onboard_manual corepack pnpm exec prisma migrate deploy
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_onboard_manual npx ts-node --transpile-only prisma/seed.ts
cd ..
```

- `backend/.env.manual-onboarding.local` (gitignored). Generate it with random throwaway keys:

```bash
cd backend && node -e "
const c=require('crypto');const h=n=>c.randomBytes(n).toString('hex');
require('fs').writeFileSync('.env.manual-onboarding.local',[
'PORT=3999','NODE_ENV=development',
'DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_onboard_manual',
'CORS_ORIGIN=http://127.0.0.1:4310','FRONTEND_URL=http://127.0.0.1:4310','APP_URL=http://127.0.0.1:4310',
'SITE_ROOT_DOMAIN=localhost','APP_HOSTS=localhost,127.0.0.1',
'JWT_SECRET='+h(32),'MFA_ENCRYPTION_KEY='+h(32),'FIELD_ENCRYPTION_PROVIDER=env',
'FIELD_ENCRYPTION_KEYS=k1:'+h(32),'FIELD_ENCRYPTION_ACTIVE_KID=k1','FILE_BLOB_SIGNING_SECRET='+h(32),
'SITE_PREVIEW_SECRET='+h(32),'REDIS_URL=','TENANT_ISOLATION_MODE=enforce',
'AI_SCRIBE_LLM_PROVIDER=mock','AI_SCRIBE_STT_PROVIDER=mock','CLINIC_REVIEW_MODE=manual'].join('\n')+'\n')" && cd ..
```

### 9.2 Start both servers

```bash
# terminal 1 — backend on :3999
cd backend && set -a && . ./.env.manual-onboarding.local && set +a && npx ts-node --transpile-only src/server.ts
# terminal 2 — front end on :4310 (production build pointing at :3999)
cd frontend
NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 NEXT_PUBLIC_APP_URL=http://127.0.0.1:4310 corepack pnpm build
node scripts/e2e-server.js 4310
```

Check: `curl -s http://127.0.0.1:3999/api/v1/health` → `"success":true`. Then `http://127.0.0.1:4310` opens the landing page.

### 9.3 Backend checks (B-1 … B-11)

Paste into Git Bash, from anywhere:

```bash
API=http://127.0.0.1:3999/api/v1
H='content-type: application/json'
C='x-medoflow-client: web'
j() { node -pe "const d=JSON.parse(require('fs').readFileSync(0)); $1"; }
SUB=onb$(date +%s)

echo "== B-1 health"
curl -s $API/health | j 'd.success'

echo "== B-2 sign up a clinic"
SIGNUP=$(curl -s -H "$H" -H "$C" -d "{\"clinicName\":\"Manual Onboarding Clinic $SUB\",\"clinicEmail\":\"clinic.$SUB@example.test\",\"subdomain\":\"$SUB\",\"ownerName\":\"Olivia Owner\",\"ownerEmail\":\"owner.$SUB@example.test\",\"password\":\"Manual-Onboard-2026!\",\"plan\":\"GROWTH\"}" \
  $API/tenants/signup | j 'd.data.verificationStatus + " " + d.data.tenantId')
echo "$SIGNUP"
TENANT=${SIGNUP#* }

echo "== B-3 nothing public while in review"
curl -s -o /dev/null -w "%{http_code}\n" $API/public/clinics/$SUB
curl -s "$API/public/sites/resolve?host=$SUB.localhost" | j 'd.data.kind'

echo "== B-4 owner signs in"
OWNER=$(curl -s -H "$H" -H "$C" -d "{\"email\":\"owner.$SUB@example.test\",\"password\":\"Manual-Onboard-2026!\"}" $API/auth/login | j 'd.data.accessToken')
curl -s -H "authorization: Bearer $OWNER" $API/auth/me | j 'd.data.user.clinic.tenant.verificationStatus + " profile=" + d.data.user.clinic.clinicProfile'

echo "== B-5 practice details: a bad NPI is refused, then saved"
PRACTICE='{"legalName":"Manual Wellness LLC","practiceType":"FUNCTIONAL_MEDICINE","locationCount":1,"addressLine1":"100 Example Street","city":"Testville","state":"TX","postalCode":"75001","timezone":"America/Chicago","primaryContactName":"Olivia Owner","primaryContactEmail":"olivia@example.test","mailingSameAsPrimary":true,"noNpi":false,"groupNpi":"NPI_HERE","federalTaxId":"12-3456789","deaNumber":"AB1234563","estimatedSeats":3}'
curl -s -X PUT -H "$H" -H "$C" -H "authorization: Bearer $OWNER" -d "${PRACTICE/NPI_HERE/1234567890}" $API/onboarding/application/practice | j 'd.message'
curl -s -X PUT -H "$H" -H "$C" -H "authorization: Bearer $OWNER" -d "${PRACTICE/NPI_HERE/1234567893}" $API/onboarding/application/practice \
  | j 'd.data.profile.federalTaxIdMasked + " " + d.data.profile.deaNumberMasked + " " + d.data.location.timezone'

echo "== B-6 practitioners"
curl -s -X PUT -H "$H" -H "$C" -H "authorization: Bearer $OWNER" \
  -d '{"practitioners":[{"name":"Dr Olivia Owner","email":"olivia.md@example.test","npi":"1234567893","credentials":"MD","licenseNumber":"TX-1","licenseState":"TX","isOwner":true,"isSelf":true}]}' \
  $API/onboarding/application/practitioners | j 'JSON.stringify(d.data.progress)'

echo "== B-7 sign the agreement (wrong signature first)"
SIGN='{"acknowledgements":{"baa":true,"hipaa":true,"dataResidency":true,"refundPolicy":true,"authorizedSignatory":true},"communications":true,"signerName":"Olivia Owner","signerTitle":"Medical Director","signature":"SIG_HERE","confirmClinicName":"Manual Onboarding Clinic SUB_HERE"}'
SIGN=${SIGN/SUB_HERE/$SUB}
curl -s -H "$H" -H "$C" -H "authorization: Bearer $OWNER" -d "${SIGN/SIG_HERE/Someone Else}" $API/onboarding/agreement | j 'd.message'
curl -s -H "$H" -H "$C" -H "authorization: Bearer $OWNER" -d "${SIGN/SIG_HERE/olivia owner}" $API/onboarding/agreement | j 'd.data.verificationStatus'

echo "== B-8 platform reviewer: queue, application, request changes"
PLAT=$(curl -s -H "$H" -H "$C" -d '{"email":"platform@medoflow.test","password":"test1234"}' $API/auth/login | j 'd.data.accessToken')
curl -s -H "authorization: Bearer $PLAT" "$API/platform/clinics?verification=PENDING_REVIEW" | j '"pending=" + d.data.pendingReview'
curl -s -H "authorization: Bearer $PLAT" $API/platform/clinics/$TENANT | j 'd.data.application.profile.federalTaxId + " " + d.data.application.agreements[0].signerName'
curl -s -H "$H" -H "$C" -H "authorization: Bearer $PLAT" -d '{"decision":"REQUEST_CHANGES","notes":"Please add your state license number."}' $API/platform/clinics/$TENANT/review | j 'd.data.verificationStatus'

echo "== B-9 owner resubmits; reviewer approves"
curl -s -X POST -H "$H" -H "$C" -H "authorization: Bearer $OWNER" -d '{}' $API/onboarding/application/resubmit | j 'd.data.verificationStatus'
curl -s -H "$H" -H "$C" -H "authorization: Bearer $PLAT" -d '{"decision":"APPROVE"}' $API/platform/clinics/$TENANT/review | j 'JSON.stringify(d.data)'

echo "== B-10 live"
curl -s -o /dev/null -w "%{http_code}\n" $API/public/clinics/$SUB
curl -s "$API/public/sites/resolve?host=$SUB.localhost" | j 'd.data.kind'

echo "== B-11 only a platform admin may review"
curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "$C" -H "authorization: Bearer $OWNER" -d '{"decision":"APPROVE"}' $API/platform/clinics/$TENANT/review

echo "SUB=$SUB TENANT=$TENANT"
```

**Expected** (recorded run):

| Check | Output                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------ |
| B-1   | `true`                                                                                                 |
| B-2   | `PENDING_REVIEW <tenantId>`                                                                            |
| B-3   | `404` then `unknown` (no public clinic, no site host)                                                  |
| B-4   | `PENDING_REVIEW profile=null`                                                                          |
| B-5   | `Enter a valid 10-digit NPI`, then `•••••6789 •••••4563 America/Chicago`                               |
| B-6   | `{"practice":true,"practitioners":true,"agreement":false}`                                             |
| B-7   | `Type your full name exactly as written above to sign`, then `PENDING_REVIEW`                          |
| B-8   | `pending=1`, then `12-3456789 Olivia Owner` (the reviewer sees the full EIN), then `CHANGES_REQUESTED` |
| B-9   | `PENDING_REVIEW`, then `{"verificationStatus":"APPROVED","changed":true}`                              |
| B-10  | `200` then `site` (live)                                                                               |
| B-11  | `403` (a clinic owner can't review)                                                                    |

### 9.4 Database checks (D-1 … D-4)

Use the `SUB` value printed at the end of 9.3:

```bash
SUB=<the SUB printed by 9.3>
docker exec mf-pg psql -U postgres -d mf_onboard_manual -c "select left(p.\"federalTaxId\",7) as tax_id_prefix, p.\"groupNpi\" from \"ClinicProfile\" p join \"Clinic\" c on c.id = p.\"clinicId\" where c.slug = '$SUB';"
docker exec mf-pg psql -U postgres -d mf_onboard_manual -c "select a.\"signerName\", a.\"signerTitle\", a.\"communicationsConsent\", a.version from \"ClinicAgreement\" a join \"Clinic\" c on c.id = a.\"clinicId\" where c.slug = '$SUB';"
docker exec mf-pg psql -U postgres -d mf_onboard_manual -c "select action, count(*) from \"AuditLog\" a join \"Clinic\" c on c.id = a.\"clinicId\" where c.slug = '$SUB' group by action order by action;"
docker exec -e PGPASSWORD=app_local_pw mf-pg psql -h localhost -U medoflow_app -d mf_onboard_manual -c "update \"ClinicAgreement\" set \"signerName\" = 'Tampered';"
```

| Check | Expected                                                                                                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1   | `tax_id_prefix` = `fle:v1:` (encrypted), `groupNpi` = `1234567893`                                                                                                                                                                      |
| D-2   | one row: `Olivia Owner \| Medical Director \| t \| v2-2026-11`                                                                                                                                                                          |
| D-3   | the 9.3 run: `CLINIC_APPLICATION_RESUBMITTED`, `CLINIC_APPLICATION_VIEWED`, `CLINIC_APPROVED`, `CLINIC_CHANGES_REQUESTED`, `CLINIC_PRACTITIONERS_UPDATED`, `CLINIC_PROFILE_CREATED`, `LOGIN_SUCCESS`, `TENANT_SIGNUP`, `TERMS_ACCEPTED` |
| D-4   | `ERROR:  permission denied for table ClinicAgreement` (signed agreements are append-only)                                                                                                                                               |

### 9.5 Browser checks (F-1 … F-8)

Use two browser profiles (owner and reviewer):

| #   | Steps                                                                                                                                                                        | Expected                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | `http://127.0.0.1:4310/get-started?plan=GROWTH` → fill the clinic and your account (any `@example.test` e-mail) → **Create my clinic**                                       | Signed in, on **Tell us about your practice** (step 1 of 3). Opening `/agreement` sends you back to `/practice`                                                       |
| F-2 | Type Group NPI `1234567890`, then `1234567893`; EIN `12-3456789`; complete the address (**State**, **Timezone** Central) → **Save & continue**                               | `✗ Not a valid NPI`, then `✓ NPI format and check digit look right`. You land on **Who practices here?**                                                              |
| F-3 | Click **Save & continue** with no NPI on your row → add NPI `1234567893` → **Add practitioner** (a second person, NPI `1987654328`) → **Save & continue**                    | First "NPI is required"; then the agreement page                                                                                                                      |
| F-4 | Check the summary; tick every box; title; type a different signature, then your printed name → **Sign & submit application** → retype the clinic name → **Confirm & submit** | Federal Tax ID shows `•••••6789`; a wrong signature shows "Type your name exactly as printed"; you land on **Welcome** with **Application submitted: under review**   |
| F-5 | Go to `/locations` → **Save & continue**, then **Skip setup for now →**                                                                                                      | Moves to Disciplines (the location saved); the dashboard shows the banner **Your clinic is under review**; **Command Center** shows **Finish setting up your clinic** |
| F-6 | Reviewer profile: sign in as `platform@medoflow.test` / `test1234` → `/platform/clinics`                                                                                     | Banner **1 clinic application is waiting for review**; the row's Review column says **In review**                                                                     |
| F-7 | **Show queue →** → the clinic → type a note → **Request changes**; in the owner profile reload, click **Update application** → **Resubmit for review**                       | Owner banner **Changes requested on your clinic application** with the note; **Clinic profile** shows it, then **Under review** after resubmitting                    |
| F-8 | Reviewer: reload → **Approve**; owner: reload                                                                                                                                | "Approved — live"; the owner's banner is gone                                                                                                                         |

### 9.6 Cleanup

```bash
# stop both servers (Ctrl+C in terminals 1 and 2), then:
docker exec mf-pg psql -U postgres -c "DROP DATABASE mf_onboard_manual"
rm backend/.env.manual-onboarding.local
```

### 9.7 Result sheet

| Check      | Pass / fail | Notes |
| ---------- | ----------- | ----- |
| B-1 … B-11 |             |       |
| D-1 … D-4  |             |       |
| F-1 … F-8  |             |       |
