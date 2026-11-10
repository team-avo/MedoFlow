# Demo feedback WS1 — simplified patient booking: walkthrough and verification

**Date:** 2026-11-04 · **Branch:** `feat/booking-simplify` (from `development` @ `465fad8`) · **Data:** synthetic only.
**Trigger:** demo notes (26:33–30:15). Auto-fill the signed-in patient's name / email / phone; no password field at booking; self-booking only; four steps (Select provider → Choose time → Review → Payment). Also: "a patient who books after logging in is still asked for their details on the clinic's own website — fix this."

---

## 1. Outcome

| Item                                                                         | Status | Evidence                                                                                                       |
| ---------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| Four steps: Select Provider → Choose Time → Review → Payment                 | ✅     | `booking.spec.ts` checks the stepper labels and that "Your Details" is gone; real run (§4.5)                   |
| No "Your Details" form, no password field in the booking flow                | ✅     | e2e asserts `input[type=password]` count 0 on Review (signed in and signed out); component test                |
| Review shows name / email / phone from the profile (no re-entry)             | ✅     | `bookingIdentity.test.tsx`, `booking.spec.ts`, real run                                                        |
| Phone stored on the profile, encrypted at rest, asked once if missing        | ✅     | Integration: `fle:v1:` at rest, `/auth/me` returns plaintext; e2e "asked once"; real run D-1                   |
| Back on Review returns to Choose Time (never to a details form)              | ✅     | `booking.spec.ts` "Back from Review"                                                                           |
| Payment is inline (step 4); the patient never leaves the booking page        | ✅     | `booking.spec.ts` prepay test (URL stays `/book/...`); real run with a prepaid service                         |
| Self-booking only: a patient cannot book for someone else                    | ✅     | Integration: `POST /appointments` and `/appointments/recurring` → 403 `self_booking_only`; staff still can     |
| **Signed-in patient is not asked for details on the clinic's own website**   | ✅     | Cross-site session handoff (§2, §5). Two-origin e2e `booking-handoff.spec.ts`; real FE+BE run across two sites |
| Signed-out visitor: sign-in / create-account gate, stays on the same booking | ✅     | `booking.spec.ts` "signed-out visitor"                                                                         |
| "Book for someone else"                                                      | ⏸️     | Deferred by the demo notes (§C). Recorded in §8                                                                |

## 2. Root cause: why a signed-in patient was asked for details on the clinic site

1. **The session never reached the clinic's domain.**
   - The access token lives in memory only. A page load restores the session by exchanging the API's HttpOnly refresh cookie.
   - That cookie is `SameSite=None; Secure; Partitioned` in production and `Lax` locally ([authController.ts](../backend/src/controllers/authController.ts) `refreshCookieOptions`).
   - A clinic's own domain is a different browser _site_ from the app (ADR 0005 §94). A partitioned cookie only exists under the site where the patient signed in, and a Lax cookie is never sent cross-site. So on the clinic host, `/auth/refresh-token` failed and `user` was null.
   - Every site "Book" button is a full page load, so the in-memory token was always dropped too.
2. **The booking page had its own bugs on top:**
   - It skipped the details step only if the patient happened to be authenticated _at the moment the slot hold succeeded_.
   - Back on Review always went to the details form, which has a required password.
   - The "new patient — set a password" path never created an account, so `POST /appointments` returned 401.
   - Name and phone were thrown away. `User` had no phone column.
3. **Security gap.** `appointmentController.create` took any `patientId` from a PATIENT.

## 3. What changed (files)

**Backend**

| File                                                                                                                                                    | Change                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [schema.prisma](../backend/prisma/schema.prisma), [migration](../backend/prisma/migrations/20261104000000_patient_phone_and_auth_handoff/migration.sql) | `User.phone` (nullable); new `AuthHandoffCode` (hash, user, origin, expiresAt, usedAt). Additive only                                                                                                     |
| [fieldCrypto.ts](../backend/src/utils/fieldCrypto.ts)                                                                                                   | `User.phone` added to `ENCRYPTED_FIELDS` (sealed like `SiteLead.phone`)                                                                                                                                   |
| [authHandoffService.ts](../backend/src/services/authHandoffService.ts) (new)                                                                            | `startHandoff` (validates the return URL is a live clinic site, mints a 60 s single-use code for an active PATIENT, else `none`), `consumeHandoff` (atomic claim, origin-bound)                           |
| [authController.ts](../backend/src/controllers/authController.ts), [routes/auth.ts](../backend/src/routes/auth.ts)                                      | `POST /auth/handoff/start` (optional auth), `POST /auth/handoff/exchange` (public, client header, failure-counted); phone in `/auth/me`, login payload and `PATCH /auth/me`; `SESSION_HANDOFF` auth event |
| [module1Schemas.ts](../backend/src/validation/module1Schemas.ts), [authService.ts](../backend/src/services/authService.ts)                              | `phoneSchema` (7–15 digits, usual separators); optional `phone` at registration                                                                                                                           |
| [appointmentController.ts](../backend/src/controllers/appointmentController.ts)                                                                         | `resolveBookingPatientId`: a PATIENT naming anyone else → 403 `self_booking_only` (single and recurring)                                                                                                  |
| [auditService.ts](../backend/src/services/auditService.ts)                                                                                              | `SESSION_HANDOFF` action                                                                                                                                                                                  |
| [bookingSelf.int.test.ts](../backend/src/tests/integration/bookingSelf.int.test.ts) (new)                                                               | 12 integration tests (§4.2)                                                                                                                                                                               |

**Frontend**

| File                                                                                                                                                                                                                                                                                                                                                                     | Change                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [book/[serviceId]/page.tsx](../frontend/app/%28public%29/book/%5BserviceId%5D/page.tsx)                                                                                                                                                                                                                                                                                  | 4 steps; details form, email check and password removed; Review = details card or sign-in gate + summary; Back → Choose Time; inline payment step; "Signed in as / Sign in" header; handoff |
| [BookingIdentity.tsx](../frontend/components/booking/BookingIdentity.tsx) (new)                                                                                                                                                                                                                                                                                          | `YourDetailsCard` (read-only, one-time phone field), `BookingSignInGate`, `isValidPhone` (same rule as the API)                                                                             |
| [AppointmentPayment.tsx](../frontend/components/booking/AppointmentPayment.tsx) (new), [payment/[appointmentId]/page.tsx](../frontend/app/%28public%29/payment/%5BappointmentId%5D/page.tsx)                                                                                                                                                                             | Payment UI extracted; used inline by the booking page and by the standalone payment page (now a thin wrapper)                                                                               |
| [lib/authHandoff.ts](../frontend/lib/authHandoff.ts), [hooks/useSessionHandoff.ts](../frontend/hooks/useSessionHandoff.ts), [app/auth/handoff/page.tsx](../frontend/app/auth/handoff/page.tsx) (new)                                                                                                                                                                     | Bounce rules (pure, unit-tested), the booking-page hook, and the app-host page that asks the API where to go back to                                                                        |
| [AuthContext.tsx](../frontend/contexts/AuthContext.tsx), [lib/api.ts](../frontend/lib/api.ts)                                                                                                                                                                                                                                                                            | `exchangeHandoffCode`; the exchange is an auth-flow URL (no refresh-and-retry on its 401)                                                                                                   |
| [AuthModal.tsx](../frontend/components/auth/AuthModal.tsx)                                                                                                                                                                                                                                                                                                               | On `/book/*` a patient stays on the page after sign-in; clinic branding and sign-up clinic link from `?clinicId`; optional phone at sign-up                                                 |
| [BookingModal.tsx](../frontend/components/booking/BookingModal.tsx)                                                                                                                                                                                                                                                                                                      | Same details card on its Review step; no `patientId` sent                                                                                                                                   |
| [edgeRouting.ts](../frontend/lib/site/edgeRouting.ts)                                                                                                                                                                                                                                                                                                                    | `/auth/handoff` always runs on the app host (307 from clinic hosts)                                                                                                                         |
| [playwright.config.ts](../frontend/playwright.config.ts), [e2e/mockApi.ts](../frontend/e2e/mockApi.ts)                                                                                                                                                                                                                                                                   | e2e build knows the app origin; the mock keeps the refresh cookie **per page origin** (models the cross-site problem), phone, `PATCH /auth/me`, handoff routes                              |
| Tests: [booking.spec.ts](../frontend/e2e/booking.spec.ts), [booking-handoff.spec.ts](../frontend/e2e/booking-handoff.spec.ts) (new), [bookingIdentity.test.tsx](../frontend/tests/components/bookingIdentity.test.tsx) (new), [authHandoff.test.ts](../frontend/tests/unit/authHandoff.test.ts) (new), [siteRouting.test.ts](../frontend/tests/unit/siteRouting.test.ts) | §4.3–§4.4                                                                                                                                                                                   |

## 4. Verification: commands and results

Run on this machine, 2026-11-04. Integration database: `mf-pg` (postgres:18) on 55432.

### 4.1 Gates

```bash
cd backend
corepack pnpm exec prisma generate
corepack pnpm exec tsc --noEmit -p .                 # → no output
corepack pnpm exec tsc --noEmit -p tsconfig.test.json # → no output
corepack pnpm exec eslint <changed files>            # → no output
corepack pnpm exec vitest run                        # → 28 files · 444 passed (at WS1 hand-off; final: 30 · 463)
cd ../frontend
corepack pnpm exec tsc --noEmit -p .                 # → no output
corepack pnpm exec eslint <changed files>            # → no output
corepack pnpm exec vitest run                        # → 32 files · 387 passed (at WS1 hand-off; final: 35 · 429)
```

### 4.2 Backend integration (real Postgres, `medoflow_app` role, RLS on)

```bash
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it corepack pnpm exec prisma migrate deploy
#   → applied 20261104000000_patient_phone_and_auth_handoff
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it
corepack pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/bookingSelf.int.test.ts
#   → 12 passed
corepack pnpm exec vitest run --config vitest.integration.config.ts
#   → 17 files · 274 passed, 1 skipped (the skip is pre-existing)
```

`bookingSelf.int.test.ts`:

- **Self-booking only:**
  - a patient booking for another patient → 403, on both `/appointments` and `/appointments/recurring`, and nothing is written;
  - booking for themselves (named or not) → 201;
  - front desk can still book for a patient.
- **Phone:**
  - the phone is stored sealed (`fle:v1:`) and `/auth/me` returns it in plaintext;
  - a malformed phone → 400, at registration and on PATCH;
  - PATCH sets and clears the phone.
- **Handoff:**
  - return URLs that aren't a live clinic site → 400: foreign host, unknown subdomain, `http` in production mode, embedded credentials, `javascript:`, empty;
  - anonymous callers, staff and invalid tokens → `handoff=none`, with the rest of the URL intact;
  - a patient gets a code. Only its hash is stored, bound to the clinic origin. The exchange returns a token and a refresh cookie, `/auth/me` works with that token, and a `SESSION_HANDOFF` audit row is written;
  - a code fails if reused, from another origin, with no origin, after expiry, or if it's a random string;
  - two concurrent exchanges → exactly one 200;
  - a deactivated patient → 401.

### 4.3 Frontend unit and component

```bash
cd frontend
corepack pnpm exec vitest run tests/components/bookingIdentity.test.tsx tests/unit/authHandoff.test.ts tests/unit/siteRouting.test.ts
#   → 3 files · 89 passed
```

### 4.4 Playwright (production build, mocked API)

```bash
cd frontend
NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 NEXT_PUBLIC_APP_URL=http://127.0.0.1:4310 \
  node node_modules/next/dist/bin/next build --webpack
node scripts/e2e-server.js 4310            # terminal 1 (Windows: start it yourself)
E2E_EXTERNAL_SERVER=1 npx playwright test e2e/booking.spec.ts e2e/booking-handoff.spec.ts
#   → 9 passed
E2E_EXTERNAL_SERVER=1 npx playwright test
#   → 68 passed, 10 skipped (the opt-in live specs); with WS2–WS4 on the branch: 74 passed, 10 skipped
```

`booking-handoff.spec.ts` opens the booking page on `http://everwell.localhost:4310`, a different browser site from the app on `127.0.0.1:4310`. The mock only honours the refresh cookie for the origin that signed in. Two tests:

- **Patient signed in on the app:** arrives on the clinic host signed in, the code is gone from the URL, and they book with no details form and no password.
- **Visitor signed in nowhere:** bounces exactly once, gets the sign-in gate, and there is no exchange call.

### 4.5 Real front end ↔ back end (no mocks)

- Real API on `:4312`: `medoflow_app` role, RLS enforced, field encryption on, `SITE_ROOT_DOMAIN=localhost`.
- Real `next dev` on `:3010`.
- Database `mf_manual_booking`, seeded with `scripts/seed-e2e-live.ts`, plus provider availability, a verified subdomain and a prepaid service.
- A scratchpad Playwright script signs the patient in on `http://localhost:3010`, then books twice on `http://live-<hex>.localhost:3010`, the clinic's own host (a different browser site).

```
[ws1] ok - free consult: still on the clinic host
[ws1] ok - free consult: handoff code stripped from the URL
[ws1] ok - free consult: 4 steps, no "Your Details"
[ws1] ok - free consult: no password field
[ws1] ok - free consult: name auto-filled
[ws1] ok - free consult: email auto-filled
[ws1] phone added once and saved to the profile
[ws1] free consult: booked
[ws1] ok - prepaid consult: phone auto-filled from profile
[ws1] ok - prepaid: payment inline on the booking page
[ws1] prepaid consult: booked
[ws1] ok - handoff/start called
[ws1] ok - handoff/exchange called
[ws1] ALL PASSED
```

Database afterwards:

- **Phone:** `User.phone` starts with `fle:v1:`.
- **Bookings:** both new bookings are `PATIENT_PORTAL` — Consult `CONFIRMED`, and Prepaid consult `CONFIRMED / PAID` via "Demo: Simulate Payment" (no Stripe keys on this machine).
- **Handoff codes:** all used, all bound to the clinic origin.
- **Audit:** `SESSION_HANDOFF` rows written.

All the curl checks in §9.4 were run against this server, with the results shown there.

### 4.6 No secrets in the change

- gitleaks (Docker `zricethezav/gitleaks:v8.21.2`, not installed on the machine) over `backend/src`, `backend/prisma`, `frontend/{app,components,lib,hooks,contexts,e2e,tests}`: **no new findings**.
- The remaining hits are pre-existing: the `stripe.ts` placeholder and the synthetic test passwords in `helpers.ts`, `rateLimit.int.test.ts` and `mockApi.ts`.
- A literal synthetic password in the new test was replaced with the shared `FIXTURE_PASSWORD`.
- The throwaway env file is `backend/.env.manual-booking.local`, covered by the `.env.*.local` gitignore rule.

## 5. Design notes

- **Why a handoff, not a shared cookie.** Clinic custom domains can never share a cookie with the app; that's the point of browser site isolation. The handoff is a top-level bounce, so it needs no third-party cookies. The new session's refresh cookie is set on the exchange response, which the clinic page makes, so it lands in the clinic site's partition. Later page loads on that clinic domain then restore normally, with no further bounce in production.
- **Safety of the handoff:**
  - **No open redirect.** The return URL must pass the same check CORS uses (`isClinicSiteOrigin`: a live subdomain or a verified custom domain, https in production), so a code can only travel to a clinic domain.
  - **The code.** Only its sha256 is stored. It lives 60 s, is single-use with an atomic claim, and only works from its origin.
  - **Accounts and auditing.** Only active PATIENT accounts are handed off. Failures count towards the failed-auth monitor, and the exchange requires the CSRF client header.
- **Why every patient, not only the clinic's own.** Booking already self-enrols a patient at a new clinic (`withPatientSelfEnrollScope`). The clinic hint on `/auth/login` guards against account enumeration on an unauthenticated form, and that concern doesn't apply to a session that already exists.
- **Locally**, `<slug>.localhost` and `localhost` are different sites and the dev cookie is Lax. So the clinic page's own refresh cookie doesn't survive a reload there, and each fresh `/book` load bounces once (a few hundred ms). In production the partitioned cookie persists.
- **Payment step.** It's shown when there is a `clientSecret` _or_ the appointment is `PENDING_PAYMENT`. Without Stripe keys (this machine, possibly the demo) the step still appears and offers "Demo: Simulate Payment" / "Confirm & Proceed", instead of a premature "You're booked".
- **Phone is required to confirm.** The old form required it. A profile without a phone shows one inline field on Review, saved to the profile; that is a first entry, not a re-entry.
- **Unchanged:** the site's "Book" buttons stay plain links (the builder canvas renders the same components), and the handoff covers the full page load.

## 6. What you must do manually

1. **Apply the migration** on the hosted database: `prisma migrate deploy` with the owner URL. It's additive (one column, one table).
2. **Set `NEXT_PUBLIC_APP_URL`** on the frontend deploy to the app origin (e.g. `https://app.<root>`). Without it the booking page doesn't bounce and behaves as before for clinic-domain visitors: they see the sign-in gate, not the form.
3. **After deploy, on a real clinic custom domain:**
   - sign in on the app;
   - open the clinic site → Book;
   - expect "Signed in as …" with no form;
   - reload: still signed in, with no second bounce (partitioned cookie).

## 7. HIPAA / review checklist

- **Phone:** encrypted at rest, never logged (the scrubber already masks `phone`), never in URLs (the F1.3 URL check runs on every booking e2e flow).
- **Handoff codes:** they travel in a URL once. They are random, 60 s, single-use, origin-bound and stripped from the address bar with `router.replace` straight away, and they never reach logs (morgan masks query values).
- **No new PHI egress, no new vendor.**

## 8. Known limits

- **"Book for someone else"** (dependants, guardians) is deferred, as the demo notes say. The API now refuses it explicitly (`self_booking_only`).
- **Login guard on clinic sites.** A patient whose home clinic differs from the clinic site is still refused by the `/auth/login` clinic hint on `/clinic/<id>` pages (existing behaviour). The booking page does not send that hint, and the handoff works for them.
- **Not fixed (out of scope):** the waitlist offer email links to `/book/<id>` without `clinicId` (`waitlistService.ts:232`).
- **Real Stripe card payment in step 4** is an owner step: there are no Stripe keys on this machine. The Stripe Elements path is the same component as before.

## 9. Manual local testing guide

Everything runs locally against throwaway data. Three terminals, from the repo root. The API is on **4312** and the frontend on **3010**, so they don't clash with your usual dev servers.

### 9.1 Before you start

- Docker Desktop is running, and `mf-pg` is up: `docker start mf-pg`.
- Ports 4312 and 3010 are free. These commands print `free`:

  ```powershell
  foreach ($p in 4312,3010) { try { "$p busy: " + (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop).OwningProcess } catch { "$p free" } }
  ```

### 9.2 One-time setup (terminal 3, Git Bash)

```bash
cd /e/advertout/MedoFlow/backend
DB=mf_manual_booking
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB corepack pnpm exec prisma migrate deploy
# → All migrations have been successfully applied.

H() { node.exe -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"; }
cat > .env.manual-booking.local <<EOF
# Local manual testing only (gitignored). Throwaway values.
PORT=4312
NODE_ENV=development
MANUAL_DB=mf_manual_booking
DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_manual_booking
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
set -a; . ./.env.manual-booking.local; set +a
mkdir -p uploads
E2E_LIVE_PASSWORD=$MANUAL_PASSWORD DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB \
  corepack pnpm exec ts-node --transpile-only scripts/seed-e2e-live.ts > uploads/.manual-booking-seed.json
S=uploads/.manual-booking-seed.json; J() { node.exe -p "require('./$S').$1"; }
CID=$(J clinicId); PID=$(J providerId); SLUG=$(J clinicSlug); SVC=$(J serviceId)
docker exec -i mf-pg psql -U postgres -d $DB -v ON_ERROR_STOP=1 <<SQL
INSERT INTO "ProviderAvailability" (id,"providerId","locationId",weekday,"startTime","endTime","updatedAt")
SELECT 'avail-'||d, '$PID', (SELECT id FROM "Location" WHERE "clinicId"='$CID' LIMIT 1), d, '00:00','23:59', now() FROM generate_series(0,6) d;
INSERT INTO "SiteDomain" (id,"clinicId",hostname,kind,status,"isPrimary","verifiedAt","updatedAt")
VALUES ('sd-manual-booking','$CID','$SLUG','SUBDOMAIN','VERIFIED',true,now(),now());
INSERT INTO "Service" (id,"clinicId","disciplineId",name,duration,"defaultPrice","requirePrepayment","updatedAt")
SELECT 'svc-manual-prepaid', "clinicId", "disciplineId", 'Prepaid consult', 30, 80, true, now() FROM "Service" WHERE id='$SVC';
INSERT INTO "ProviderService" (id,"providerId","serviceId","updatedAt") VALUES ('ps-manual-prepaid','$PID','svc-manual-prepaid',now());
SQL
# → INSERT 0 7 / INSERT 0 1 / INSERT 0 1 / INSERT 0 1
echo "PATIENT  $(J emails.patient)   PASSWORD  $MANUAL_PASSWORD"
echo "APP      http://localhost:3010/?auth=login"
echo "CLINIC   http://$SLUG.localhost:3010/book/$SVC?clinicId=$CID"
echo "PREPAID  http://$SLUG.localhost:3010/book/svc-manual-prepaid?clinicId=$CID"
```

Keep the four printed lines; the browser steps use them.

### 9.3 Start the apps

**Terminal 1, backend:**

```bash
cd /e/advertout/MedoFlow/backend
set -a; . ./.env.manual-booking.local; set +a
corepack pnpm exec ts-node --transpile-only src/server.ts
# wait for: [db] connected as "medoflow_app" — row-level security is enforced
#           Medoflow server running on port 4312 (development)
```

**Terminal 2, frontend:**

```bash
cd /e/advertout/MedoFlow/frontend
NEXT_PUBLIC_API_URL=http://localhost:4312 NEXT_PUBLIC_APP_URL=http://localhost:3010 \
  NEXT_PUBLIC_SITE_ROOT_DOMAIN=localhost node node_modules/next/dist/bin/next dev -p 3010
# wait for: ✓ Ready
```

### 9.4 Backend checks with curl (terminal 3)

```bash
cd /e/advertout/MedoFlow/backend
set -a; . ./.env.manual-booking.local; set +a
API=http://localhost:4312/api/v1; S=uploads/.manual-booking-seed.json; J() { node.exe -p "require('./$S').$1"; }
CL="X-MedoFlow-Client: web"; SITE="http://$(J clinicSlug).localhost:3010"
TOK=$(curl -s -H "$CL" -H 'content-type: application/json' -d "{\"email\":\"$(J emails.patient)\",\"password\":\"$MANUAL_PASSWORD\"}" $API/auth/login | node.exe -p "JSON.parse(require('fs').readFileSync(0)).data.accessToken")
ADMIN_ID=$(docker exec mf-pg psql -U postgres -d mf_manual_booking -tAc "SELECT id FROM \"User\" WHERE email='$(J emails.admin)'")
echo "B-1 token: ${TOK:0:12}…"
echo "B-2 PATCH phone: $(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "$CL" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"phone":"+1 555 010 9911"}' $API/auth/me)  me.phone=$(curl -s -H "authorization: Bearer $TOK" $API/auth/me | node.exe -p "JSON.parse(require('fs').readFileSync(0)).data.user.phone")"
echo "B-3 bad phone: $(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "$CL" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"phone":"12"}' $API/auth/me)"
echo "B-4 book for someone else: $(curl -s -w ' %{http_code}' -H "$CL" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"clinicId\":\"$(J clinicId)\",\"providerId\":\"$(J providerId)\",\"serviceId\":\"$(J serviceId)\",\"patientId\":\"$ADMIN_ID\",\"startTime\":\"2030-01-07T10:00:00.000Z\",\"endTime\":\"2030-01-07T10:30:00.000Z\"}" $API/appointments | node.exe -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const [b,c]=[s.slice(0,s.lastIndexOf(' ')),s.slice(s.lastIndexOf(' ')+1)];console.log(c,JSON.parse(b).code)})")"
RET="$SITE/book/$(J serviceId)?clinicId=$(J clinicId)"
echo "B-5 anonymous start: $(curl -s -H "$CL" -H 'content-type: application/json' -d "{\"returnUrl\":\"$RET\"}" $API/auth/handoff/start | node.exe -p "new URL(JSON.parse(require('fs').readFileSync(0)).data.redirectUrl).searchParams.get('handoff')")"
echo "B-6 foreign return URL: $(curl -s -o /dev/null -w '%{http_code}' -H "$CL" -H 'content-type: application/json' -d '{"returnUrl":"https://evil.example.com/book/x"}' $API/auth/handoff/start)"
CODE=$(curl -s -H "$CL" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"returnUrl\":\"$RET\"}" $API/auth/handoff/start | node.exe -p "new URL(JSON.parse(require('fs').readFileSync(0)).data.redirectUrl).searchParams.get('handoff')")
echo "B-7 patient code length: ${#CODE}"
X() { curl -s -o /dev/null -w '%{http_code}' -H "$CL" -H "origin: $1" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" $API/auth/handoff/exchange; }
echo "B-8 exchange from wrong origin: $(X http://localhost:3010)"
echo "B-9 exchange from clinic origin: $(X $SITE)"
echo "B-10 same code again: $(X $SITE)"
```

Expected (the output recorded on 2026-11-04):

```
B-1 token: eyJhbGciOiJI…
B-2 PATCH phone: 200  me.phone=+1 555 010 9911
B-3 bad phone: 400
B-4 book for someone else: 403 self_booking_only
B-5 anonymous start: none
B-6 foreign return URL: 400
B-7 patient code length: 43
B-8 exchange from wrong origin: 401
B-9 exchange from clinic origin: 200
B-10 same code again: 401
```

B-2 gives the patient a phone. To see the "add a phone" field in F-5, clear it first: `docker exec mf-pg psql -U postgres -d mf_manual_booking -c "UPDATE \"User\" SET phone=NULL WHERE role='PATIENT'"`.

### 9.5 Browser checks

Use a normal (not incognito) Chrome window. `*.localhost` resolves to your machine automatically.

| #    | Do                                                                     | Expect                                                                                                                                   |
| ---- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| F-1  | Open the **APP** link and sign in as the **PATIENT** with the password | Signed in on `localhost:3010`                                                                                                            |
| F-2  | Open the **CLINIC** link (different site: `live-….localhost`)          | A brief "Signing you in", then the booking page on the clinic host. Top right: **Signed in as Quinn Marlowe**. The URL has no `handoff=` |
| F-3  | Look at the stepper                                                    | **Select Provider · Choose Time · Review · Payment**. No "Your Details"                                                                  |
| F-4  | Pick _Synthetic Provider_ → a time → **Confirm**                       | **Review & Confirm**, with a **Your details** card: Quinn Marlowe, the patient email. No password field anywhere                         |
| F-5  | If the card asks for a phone: type `555-0142` → **Save**               | The field disappears and the phone shows in the card. **Confirm visit** becomes enabled                                                  |
| F-6  | Press **Back**                                                         | The date / time picker (not a form). Pick a time again → Review                                                                          |
| F-7  | **Confirm visit**                                                      | "You're booked, Quinn." with **Add to calendar**, **Complete intake form** and **Back to clinic**                                        |
| F-8  | Open the **PREPAID** link → provider → time → **Confirm visit**        | Step 4 **Payment** on the same page (URL still `/book/svc-manual-prepaid…`), with the reservation countdown                              |
| F-9  | **Demo: Simulate Payment**                                             | "You're booked"                                                                                                                          |
| F-10 | Open a private window, open the **CLINIC** link, pick a time           | Top right **Sign in**; Review shows **Sign in or create an account to continue** and **Confirm visit** is disabled                       |
| F-11 | In that window: **Sign in** → patient email + password                 | The dialog closes and you stay on the same booking. The details card appears                                                             |

### 9.6 Database checks

```bash
cd /e/advertout/MedoFlow/backend
E=$(node.exe -p "require('./uploads/.manual-booking-seed.json').emails.patient")
docker exec mf-pg psql -U postgres -d mf_manual_booking \
  -c "SELECT left(phone,7) AS phone_prefix FROM \"User\" WHERE email='$E';" \
  -c "SELECT s.name, a.status, a.\"paymentStatus\" FROM \"Appointment\" a JOIN \"Service\" s ON s.id=a.\"serviceId\" WHERE a.\"bookingSource\"='PATIENT_PORTAL';" \
  -c "SELECT count(*) total, count(\"usedAt\") used FROM \"AuthHandoffCode\";" \
  -c "SELECT action, count(*) FROM \"AuditLog\" WHERE action='SESSION_HANDOFF' GROUP BY action;"
```

| #   | Expect                                                                              |
| --- | ----------------------------------------------------------------------------------- |
| D-1 | `phone_prefix` = `fle:v1:` (encrypted at rest)                                      |
| D-2 | Your bookings: `Consult · CONFIRMED · NONE`, `Prepaid consult · CONFIRMED · PAID`   |
| D-3 | Every handoff code is used (`total` = `used`), or unused ones are younger than 60 s |
| D-4 | At least one `SESSION_HANDOFF` row                                                  |

### 9.7 Clean up

Stop terminals 1 and 2 with **Ctrl+C**. Then:

```bash
cd /e/advertout/MedoFlow/backend
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS mf_manual_booking WITH (FORCE)"
rm -f .env.manual-booking.local uploads/.manual-booking-seed.json
```

### 9.8 Result sheet

| Check                          | Pass / Fail | Notes |
| ------------------------------ | ----------- | ----- |
| B-1 … B-10                     |             |       |
| F-1 … F-11                     |             |       |
| D-1 … D-4                      |             |       |
| §6 step 3 (real custom domain) |             |       |
