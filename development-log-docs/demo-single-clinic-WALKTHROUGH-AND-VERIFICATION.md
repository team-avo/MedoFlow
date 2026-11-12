# One clinic for the whole demo — stocking a clinic signed up live: walkthrough and verification

**Date:** 2026-11-12 · **Branch:** `feat/demo-single-clinic`, cut from `development` at `1c897eb` (after PR #21) · **Data:** synthetic only.

**Trigger:** the demo script ran on two clinics.

- **Sections 0–1** (sign-up, application, review, website) used a clinic signed up live, _Sunrise Wellness_.
- **Sections 2–11** (booking, front desk, video + AI scribe, prescription to cart, portal, packages, commissions, analytics, compliance) used the seeded _Demo Clinic_.

The owner asked to run every component on **the clinic that was onboarded live**.

**Why that wasn't possible before:**

- **The seeded accounts can't follow the new clinic.** `User.email` is unique across the platform, `User.clinicId` is a single column and `Provider.userId` is unique. A patient's clinic-page sign-in is refused unless `user.clinicId` is that clinic.
- **A fresh sign-up is nearly empty.** It has an owner, a brand, a web address and a UTC "Main Location". The wizard adds disciplines, services and a bare "Add me" provider, but no hours, catalogue, packages, memberships, doctor, front desk or patient.
- **Staff can't be added by e-mail on the hosted demo.** It has no SMTP, so staff invites fail (`providerService.ts:234`, `staffService.ts:293`).
- **The stocking code was locked to one clinic.** `seedBookingWorld` / `seedCatalogue` in `prisma/seed.ts` took a clinic id, but they weren't exported, and `seed.ts` runs on import.

**The owner's decisions (2026-11-12):**

- one command stocks the live clinic right after it is approved;
- the doctor, front desk and patient sign in through **real one-time invite links** (`/set-password`), not preset passwords;
- the separate `pending-setup` sign-in issue found during this work is **not fixed now** (§8).

---

## 1. Outcome

| Item                                                                                                                                                                                                                                                            | Status | Evidence                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| `scripts/demo-stock-clinic.ts --label <label>`: dry run by default, `--apply` to write                                                                                                                                                                          | ✅     | int "a dry run reports the plan and writes nothing"; guide B-4             |
| Refuses a clinic that isn't approved, an unknown label, the seeded `demo` tenant, and an e-mail that belongs to another clinic                                                                                                                                  | ✅     | int "refuses an unknown label…", "never takes over an account…"; guide B-2 |
| Stocks the clinic on its **own** location and timezone (from the application): 4 services, Dr. Evelyn Chen and Marcus Patel with Mon–Fri 09:00–17:00 hours, 16 shop products and the 4 AI-scribe products, 3 packages, 2 memberships, and a 40% commission rule | ✅     | int "stocks the clinic…"; guide B-5, B-9, D-2                              |
| Doctor, front desk and patient get an **unusable random password** and a **one-time /set-password link** (24 h). Each signs in only after redeeming it, and a used link is refused                                                                              | ✅     | int "accounts sign in only after…"; guide B-6…B-8, D-3; real run           |
| **Visits A and B** booked for Anika with Dr. Chen at the next free slots, with AI-scribe consent; the no-overlap constraint still guards them                                                                                                                   | ✅     | unit `nextFreeSlots` (6); int visit times + consent; guide D-1             |
| The AI-scribe wording routes as the demo script says: Magnesium Glycinate / Arnica Gel / Mobility Roller Kit → cart, Tramadol → e-prescribe, "turmeric complex" and the package → unmatched                                                                     | ✅     | int "the AI-scribe demo wording routes…"; real run                         |
| Idempotent: a second run adds nothing and only re-issues links to accounts that haven't set a password (`--reissue`, `--new-visits` to force)                                                                                                                   | ✅     | int "a second run adds nothing…"; guide B-10                               |
| Off-boarding the clinic (Part B reset) frees the label and the three e-mails, and the next sign-up can be stocked again                                                                                                                                         | ✅     | guide B-11; real run reset                                                 |
| `prisma db seed` produces exactly the same Demo Clinic as before the refactor                                                                                                                                                                                   | ✅     | §4.4 old vs new seed comparison: identical                                 |
| Every stocking run writes a `DEMO_CLINIC_STOCKED` audit row                                                                                                                                                                                                     | ✅     | int; guide D-4                                                             |
| Real front end ↔ back end: the live-signed-up clinic carries sign-up → website → patient → doctor scribe → cart → front desk till                                                                                                                               | ✅     | §4.5: 87 API calls, 0 × 5xx                                                |

## 2. Problems found (root causes)

| #   | Problem                                                              | Root cause                                                                                        | Fix                                                                                    |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | The demo needed two clinics                                          | Demo accounts and catalogue existed only on the seeded clinic, and the seeded accounts can't move | A stocking command for the live clinic (`prisma/demoStock.ts` + CLI)                   |
| 2   | The stocking code couldn't be reused                                 | `seedBookingWorld` / `seedCatalogue` were private to `seed.ts`, which runs `main()` on import     | Moved into `prisma/demoWorld.ts`; `seed.ts` imports them unchanged                     |
| 3   | No way to give staff a password without e-mail                       | Invites need SMTP; there's no endpoint that sets a staff password                                 | The script issues the same one-time token an invite e-mail carries and prints the link |
| 4   | The AI-scribe products were added by hand before every demo (old A4) | Not part of the seed                                                                              | `SCRIBE_DEMO_PRODUCTS` (exact names, classes, no SKU/aliases) stocked by the script    |
| 5   | New-clinic site pages need slugs for services, team and products     | Slugs are backfilled only when the Website page first opens                                       | The script assigns slugs with the site builder's rules (unit test compares the two)    |

## 3. What changed (files)

**Backend**

- `backend/prisma/demoWorld.ts` (new):
  - The demo contents: `DEMO_SERVICES`, `DEMO_PRODUCTS`, `SCRIBE_DEMO_PRODUCTS`, `DEMO_PACKAGES`, `DEMO_MEMBERSHIPS`.
  - `seedBookingWorld(db, clinicId, { locationId?, providers?, assignSlugs? })` and `seedCatalogue(db, clinicId, { extraProducts?, assignSlugs? })`.
  - `slugify` / `freeSlug`.
  - Writes no encrypted columns, so it runs on a plain owner `PrismaClient` without the field-encryption keys.
- `backend/prisma/seed.ts`: the two functions are now imported from `demoWorld.ts`; behaviour unchanged.
- `backend/prisma/demoStock.ts` (new): `stockDemoClinic(db, opts)` resolves the clinic, checks it, stocks it, books the visits, issues the links and audits. Also `nextFreeSlots`, `accountEmail` and `DemoStockError`.
- `backend/scripts/demo-stock-clinic.ts` (new): the CLI. It takes `--label`, `--apply`, `--frontend-url` (default `$FRONTEND_URL` or `https://medoflow.pages.dev`), `--reissue` and `--new-visits`.
- `backend/src/services/passwordSetupService.ts`: `createPasswordSetupToken(userId, db = prisma)` takes an optional client, so the script uses the same token code as invites.

**Tests**

- `backend/src/tests/demoStockSlots.test.ts` (6): slot placement (opening time, notice, 15-minute grid, 17:00 cut-off, weekend, around bookings) and slug parity with the site builder.
- `backend/src/tests/integration/demoStockClinic.int.test.ts` (8): the §1 behaviour against Postgres with the app role and RLS.

## 4. Verification: commands and results

Run on 2026-11-12 against `mf-pg` (Postgres 18, port 55432).

### 4.1 Gates

```bash
cd backend
corepack pnpm run typecheck   # tsc --noEmit && tsc -p tsconfig.test.json → exit 0
corepack pnpm run lint        # eslint src --max-warnings=0 → clean
corepack pnpm exec tsc --noEmit --strict --esModuleInterop --skipLibCheck --module commonjs \
  --moduleResolution node --target es2022 --noUncheckedIndexedAccess \
  prisma/demoStock.ts prisma/demoWorld.ts prisma/seed.ts scripts/demo-stock-clinic.ts   # → exit 0
```

### 4.2 Backend unit

`corepack pnpm exec vitest run` → **33 files, 515 passed** (including `demoStockSlots.test.ts`, 6).

### 4.3 Backend integration (real Postgres, `medoflow_app`, RLS on)

```bash
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it
corepack pnpm exec vitest run --config vitest.integration.config.ts
```

→ **21 files passed, 1 skipped; 313 passed, 1 skipped.** The skip is the existing `availability.bench`. The new `demoStockClinic.int.test.ts` passed all 8 tests.

### 4.4 The seed is unchanged

- Two empty databases were migrated. One ran the `development` version of `seed.ts` twice; the other ran the new version twice.
- They were compared on:
  - every table's row count;
  - an md5 of every stocked table's natural columns, leaving out ids, timestamps and password hashes.
- Result: **identical**. The 17 non-empty tables are Brand 1, Clinic 1, Discipline 1, InventoryItem 16, Location 1, Membership 2, Package 3, Product 16, Provider 2, ProviderAvailability 10, ProviderDiscipline 2, ProviderLocationAssignment 2, ProviderService 8, ScribeTemplate 7, Service 4, Tenant 2 and User 5.

### 4.5 Real front end ↔ back end (no mocks)

**Setup:** the backend ran on :3999 with `backend/.env.manual-demo-stock.local` (database `mf_demo_stock_manual`, `medoflow_app`, `CLINIC_REVIEW_MODE=manual`, `AI_SCRIBE_DEMO_ENABLED=true`). The front end was a production build on :4310.

**What a headless Chromium script did:**

1. **Sign-up and application.** The owner signed up on `/get-started`, filled in practice, practitioners and agreement, reached `/welcome` and clicked **Skip setup for now**.
2. **Stocking while pending.** `demo-stock-clinic.ts --apply` was refused: _"… is not live (… PENDING_REVIEW). Approve it first."_
3. **Approval.** The reviewer approved the clinic.
4. **Stocking.** The dry run showed the plan; `--apply` stocked the clinic and printed three links. Visits A and B were booked for Thu 09:00 and 09:45 (America/Chicago), the next working morning.
5. **Invite links.** Each person opened their link in their own browser context: **Set password** → _Password set successfully._ Reusing the doctor's link returned **400**.
6. **Website.** The owner ran **Use this template** → **Install template** → **Publish site** → _Your website is live_.
   - `http://<label>.localhost:4310/team` shows **Dr. Evelyn Chen**.
   - `/store` shows **Mobility Roller Kit** and hides **Tramadol**.
7. **Patient.** `/account` lists **New Patient Consultation**. Sign-in with the clinic hint returned **200**.
8. **Doctor.**
   - Opened Visit A's consultation room → **Demo: simulate conversation**.
   - **Detected products:** Magnesium Glycinate · 400 mg × 2, Arnica Gel × 1, Tramadol · 50 mg × 1 and Turmeric complex × 1.
   - Mapped the turmeric to **Golden Turmeric Blend** and removed Arnica. The summary read _On approval: 2 to the patient's cart, 1 to e-prescribe (never the cart)._
   - Confirmed → **Approve & send** → _2 products sent to the patient's cart_.
9. **Patient cart.** `/checkout` shows 2 lines labelled **Prescribed · Dr. Evelyn Chen**, and no Tramadol.
10. **Front desk.** `/dashboard/front-desk/pos` lists the **10-Session Physio Rehab Package**.
11. **Second stocking run.** Everything was present, 0 added, and _password already set_ for all three accounts.

**Totals:** **87 API calls, 0 × 5xx.** The three people signing in for the first time each got the role tour ("Let's get you clinical-ready" for the doctor), dismissed with **Skip tour**.

**Reset path:**

1. The platform admin off-boarded the clinic (**200**).
2. `check-subdomain` returned `available: true`, and the old doctor sign-in returned **401**.
3. A new sign-up with the same label returned **201**.
4. Approving before the agreement was signed returned **409**, and stocking was refused while the clinic was pending.
5. Once approved, the same label and the same three e-mails were stocked again (`[created]`).

### 4.6 Secrets

- Links are printed to the terminal only. The script writes them nowhere else, and the audit row holds counts only.
- The real-run logs in this doc show `token=<64 hex>` / `<redacted>`.
- `gitleaks detect --no-git` (v8.21.2, default rules) on every changed or new file, plus the local `arh-agent-docs/tech-demo-script.md` → **no leaks found**.

## 5. Design notes

- **Not in the app.** It's a demo tool run by the owner from a terminal against the demo database (the same pattern as `scripts/site-add-products-nav.ts`). Nothing in the API can trigger it.
- **No encryption keys needed.** The script writes no encrypted columns, so it works with the Aiven owner URL alone. The hosted keys stay on Render.
- **The same invite flow.** The token comes from `passwordSetupService.createPasswordSetupToken`, so a stocked account follows the same path as an e-mailed invite: `/set-password` → single use → 24 h.
- **The stored password is the hash of 32 random bytes**, not the shared `pending-setup` placeholder (§8), so nobody can sign in before redeeming the link.
- **"Password already set" means "no open link".** Redeeming a link deletes it, so an account with no open link has set its password. A re-run therefore re-issues links only to accounts still waiting.
- **Visits** sit on the provider's hours, at least the service's notice period (60 min) from now, on a 15-minute grid, avoiding existing bookings. If the demo starts late in the day they land on the next working morning. The doctor can still open the consultation room and use them.

## 6. What you must do manually

- **Hosted demo.** Run the CLI from Git Bash with the Aiven owner URL (`NEW_OWNER_URL`, demo script A2), right after Section 0's approval. The demo script (local) has the exact steps. It was verified locally only; the first hosted run is yours.
- **Merge this branch** into `development` before relying on it from a fresh checkout. Nothing needs redeploying for it: the command runs on your laptop.

## 7. HIPAA / review checklist

| Gate                                 | Result                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Clinic-scoped writes are scoped      | Every write carries the clinic id; the clinic is resolved from one label and checked live first                           |
| Writes audited                       | `DEMO_CLINIC_STOCKED` (counts only); the doctor/patient sign-ins and `PASSWORD_SET` are audited by the existing auth code |
| No sensitive values in logs or audit | Links go to the terminal only; no tokens or passwords in the audit row                                                    |
| Least privilege                      | It refuses to adopt an account of another clinic or role; it never touches the seeded tenant                              |
| Synthetic data                       | Names, e-mails (`@<label>.example.test`) and catalogue are synthetic                                                      |
| New vendor                           | None                                                                                                                      |

## 8. Known limits and known issues

- **Known issue (not fixed, owner's decision 2026-11-12):**
  - **The hole.** Providers and staff invited through the app are stored with the argon2 hash of the fixed word `pending-setup` (`providerService.ts:299`, `staffService.ts:10,341`). Sign-in checks it like any password (`authController.ts:276`). Until an invited person sets their own password, anyone who knows their e-mail can sign in as them with `pending-setup`.
  - **Impact:** unauthorised access to PHI, recorded in the audit log as that staff member's own sign-in.
  - **Proposed fix:** a random placeholder hash, and refusing the literal at sign-in (that covers accounts already invited).
  - **Not affected:** accounts this script creates, which use a random hash.
- **History.** The script books today's visits only, with no history, so Analytics and the Commission ledger stay near-empty on a fresh clinic.
- **Expiry.** Links expire after 24 hours; re-run with `--reissue`.
- **Rate limit.** Each run of the §9 guide makes 3 deliberate failed sign-ins. Two runs within 15 minutes reach the 5-failure lock (429); restart the backend or wait.

## 9. Manual local testing guide

Everything below was run verbatim on 2026-11-12 (results shown). Synthetic data only.

### 9.1 Before you start

- Docker Desktop running, with the `mf-pg` container started (`docker start mf-pg`).
- A database for this guide, migrated and seeded. The seed creates `platform@medoflow.test` / `test1234`:

```bash
docker exec mf-pg psql -U postgres -c "CREATE DATABASE mf_demo_stock_manual"
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_demo_stock_manual npx prisma migrate deploy
TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
  DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_demo_stock_manual npx ts-node --transpile-only prisma/seed.ts
cd ..
```

- `backend/.env.manual-demo-stock.local` (gitignored), generated with random throwaway keys:

```bash
cd backend && node -e "
const c=require('crypto');const h=n=>c.randomBytes(n).toString('hex');
require('fs').writeFileSync('.env.manual-demo-stock.local',[
'PORT=3999','NODE_ENV=development',
'DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_demo_stock_manual',
'CORS_ORIGIN=http://127.0.0.1:4310','FRONTEND_URL=http://127.0.0.1:4310','APP_URL=http://127.0.0.1:4310',
'SITE_ROOT_DOMAIN=localhost','APP_HOSTS=localhost,127.0.0.1',
'JWT_SECRET='+h(32),'MFA_ENCRYPTION_KEY='+h(32),'FIELD_ENCRYPTION_PROVIDER=env',
'FIELD_ENCRYPTION_KEYS=k1:'+h(32),'FIELD_ENCRYPTION_ACTIVE_KID=k1','FILE_BLOB_SIGNING_SECRET='+h(32),
'SITE_PREVIEW_SECRET='+h(32),'REDIS_URL=','TENANT_ISOLATION_MODE=enforce',
'AI_SCRIBE_LLM_PROVIDER=mock','AI_SCRIBE_STT_PROVIDER=mock','AI_SCRIBE_DEMO_ENABLED=true','CLINIC_REVIEW_MODE=manual',''
].join('\n'))" && cd ..
```

### 9.2 Start both servers

```bash
# terminal 1 — backend on :3999
cd backend && set -a && . ./.env.manual-demo-stock.local && set +a && npx ts-node --transpile-only src/server.ts
# terminal 2 — front end on :4310 (production build pointing at :3999)
cd frontend
NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 NEXT_PUBLIC_APP_URL=http://127.0.0.1:4310 corepack pnpm build
node scripts/e2e-server.js 4310
```

Check: `curl -s http://127.0.0.1:3999/api/v1/health` → `"success":true`.

### 9.3 Backend checks (B-1 … B-10)

Paste into Git Bash **from the repo root**. The block prints one-time links; the printout below masks them.

```bash
API=http://127.0.0.1:3999/api/v1
H='content-type: application/json'
C='x-medoflow-client: web'
j() { node -pe "const d=JSON.parse(require('fs').readFileSync(0)); $1"; }
OWNER_DB=postgresql://postgres:postgres@localhost:55432/mf_demo_stock_manual
stock() { (cd backend && DATABASE_URL=$OWNER_DB TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
  npx ts-node --transpile-only scripts/demo-stock-clinic.ts --label $SUB --frontend-url http://127.0.0.1:4310 "$@"); }
SUB=stk$(date +%s)

echo "== B-1 sign up a clinic (still under review)"
TENANT=$(curl -s -H "$H" -H "$C" -d "{\"clinicName\":\"Sunrise Wellness $SUB\",\"clinicEmail\":\"clinic@$SUB.example.test\",\"subdomain\":\"$SUB\",\"ownerName\":\"Olivia Owner\",\"ownerEmail\":\"owner@$SUB.example.test\",\"password\":\"Demo-Clinic-2026!\",\"plan\":\"GROWTH\"}" \
  $API/tenants/signup | j 'd.data.tenantId')
echo "$TENANT"

echo "== B-2 stocking is refused until the clinic is approved"
stock --apply

echo "== B-3 owner applies, reviewer approves"
OWNER=$(curl -s -H "$H" -H "$C" -d "{\"email\":\"owner@$SUB.example.test\",\"password\":\"Demo-Clinic-2026!\"}" $API/auth/login | j 'd.data.accessToken')
curl -s -X PUT -H "$H" -H "$C" -H "authorization: Bearer $OWNER" \
  -d '{"legalName":"Sunrise Wellness LLC","practiceType":"FUNCTIONAL_MEDICINE","locationCount":1,"addressLine1":"100 Example Street","city":"Testville","state":"TX","postalCode":"75001","timezone":"America/Chicago","primaryContactName":"Olivia Owner","primaryContactEmail":"olivia@example.test","mailingSameAsPrimary":true,"noNpi":false,"groupNpi":"1234567893","federalTaxId":"12-3456789","estimatedSeats":3}' \
  $API/onboarding/application/practice | j 'd.data.location.timezone'
curl -s -X PUT -H "$H" -H "$C" -H "authorization: Bearer $OWNER" \
  -d '{"practitioners":[{"name":"Olivia Owner","email":"olivia.md@example.test","npi":"1234567893","isOwner":true,"isSelf":true}]}' \
  $API/onboarding/application/practitioners | j 'JSON.stringify(d.data.progress)'
curl -s -H "$H" -H "$C" -H "authorization: Bearer $OWNER" \
  -d "{\"acknowledgements\":{\"baa\":true,\"hipaa\":true,\"dataResidency\":true,\"refundPolicy\":true,\"authorizedSignatory\":true},\"communications\":true,\"signerName\":\"Olivia Owner\",\"signerTitle\":\"Medical Director\",\"signature\":\"Olivia Owner\",\"confirmClinicName\":\"Sunrise Wellness $SUB\"}" \
  $API/onboarding/agreement | j 'd.data.verificationStatus'
PLAT=$(curl -s -H "$H" -H "$C" -d '{"email":"platform@medoflow.test","password":"test1234"}' $API/auth/login | j 'd.data.accessToken')
curl -s -H "$H" -H "$C" -H "authorization: Bearer $PLAT" -d '{"decision":"APPROVE"}' $API/platform/clinics/$TENANT/review | j 'd.data.verificationStatus'

echo "== B-4 dry run: the plan, nothing written"
stock

echo "== B-5 stock it (links are one-time; keep this output private)"
OUT=$(stock --apply); echo "$OUT" | sed -E 's/token=[0-9a-f]{64}/token=<64 hex>/'
TOKEN() { echo "$OUT" | grep -A1 "$1" | grep -o 'token=[0-9a-f]*' | cut -d= -f2; }
DOC_TOKEN=$(TOKEN PROVIDER)

echo "== B-6 the doctor can't sign in yet (not even with the invite placeholder)"
for PW in Demo-Staff-2026! pending-setup; do
  curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "$C" -d "{\"email\":\"doctor@$SUB.example.test\",\"password\":\"$PW\"}" $API/auth/login
done

echo "== B-7 redeem the doctor's link; a second use is refused"
for i in 1 2; do
  curl -s -H "$H" -H "$C" -d "{\"token\":\"$DOC_TOKEN\",\"password\":\"Demo-Staff-2026!\",\"confirmPassword\":\"Demo-Staff-2026!\"}" $API/auth/set-password | j 'd.message'
done

echo "== B-8 the doctor signs in"
curl -s -H "$H" -H "$C" -d "{\"email\":\"doctor@$SUB.example.test\",\"password\":\"Demo-Staff-2026!\"}" $API/auth/login | j 'd.data.user.role + " " + d.data.user.name'

echo "== B-9 the clinic's public team and shop"
curl -s $API/public/clinics/$SUB/providers | j 'd.data.providers.map(p => p.firstName + " " + p.lastName).sort().join(", ")'
curl -s $API/public/clinics/$SUB/products | j 'd.data.products.length + " products, Tramadol listed: " + JSON.stringify(d.data).includes("Tramadol")'

echo "== B-10 a second run adds nothing; only accounts without a password get a link"
stock --apply | grep -E "present|added|password already|set password" | sed -E 's/token=[0-9a-f]{64}/token=<64 hex>/'

echo "SUB=$SUB TENANT=$TENANT"
```

**Expected** (recorded run):

| Check | Output                                                                                                                                                                                                                                                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-1   | a tenant id                                                                                                                                                                                                                                                                                                                                                       |
| B-2   | `Refused: Sunrise Wellness <SUB> is not live (active: true, review: PENDING_REVIEW). Approve it first.`                                                                                                                                                                                                                                                           |
| B-3   | `America/Chicago`, `{"practice":true,"practitioners":true,"agreement":false}`, `PENDING_REVIEW`, `APPROVED`                                                                                                                                                                                                                                                       |
| B-4   | `── Dry run …`: Services `0/4 … 4 would be added`, Products `0/20 … 20 would be added`, Packages `0/3`, Memberships `0/2`, three accounts `[missing]`, both visits `(would be booked at the next free slot)`                                                                                                                                                      |
| B-5   | `── Demo clinic stocked ──`: the same counts `… added`, `Commission rule (40% of Dr. Chen's New Patient Consultation): added`, three accounts `[created]` each with a `set password: http://127.0.0.1:4310/set-password?token=<64 hex>` line, Visit A / B on the next free weekday slots, e.g. `Thu 12 Nov 2026, 09:00` and `09:45 (America/Chicago)` `[created]` |
| B-6   | `401`, `401`                                                                                                                                                                                                                                                                                                                                                      |
| B-7   | `Password set successfully. You can now log in.`, then `Invalid or expired token`                                                                                                                                                                                                                                                                                 |
| B-8   | `PROVIDER Dr. Evelyn Chen`                                                                                                                                                                                                                                                                                                                                        |
| B-9   | `Evelyn Chen, Marcus Patel`, then `19 products, Tramadol listed: false` (prescription items never appear publicly)                                                                                                                                                                                                                                                |
| B-10  | every line `… present, 0 added`; the doctor `password already set (use --reissue for a new link)`; front desk and patient each get a fresh link (they haven't set one); both visits `[present]`                                                                                                                                                                   |

### 9.4 Database checks (D-1 … D-4)

Run in the **same shell** right after 9.3 (it uses `$SUB`):

```bash
q() { docker exec mf-pg psql -U postgres -d mf_demo_stock_manual -c "$1"; }
CLINIC="(select id from \"Clinic\" where slug = '$SUB')"
echo "== D-1 Visits A and B: Dr. Chen, the patient, AI-scribe consent, clinic time"
q "select a.notes, to_char(a.\"startTime\" at time zone 'UTC' at time zone a.timezone, 'Dy HH24:MI') as local, a.\"aiScribeConsentGrantedAt\" is not null as consent, u.email as patient from \"Appointment\" a join \"User\" u on u.id = a.\"patientId\" where a.\"clinicId\" = $CLINIC order by a.\"startTime\";"
echo "== D-2 the AI-scribe products and how they route"
q "select name, \"fulfillmentClass\", slug from \"Product\" where \"clinicId\" = $CLINIC and name in ('Magnesium Glycinate','Arnica Gel','Tramadol','Golden Turmeric Blend') order by name;"
echo "== D-3 open invite links per account (0 = password set)"
q "select u.email, count(t.id) as open_links from \"User\" u left join \"PasswordSetupToken\" t on t.\"userId\" = u.id where u.\"clinicId\" = $CLINIC and u.role <> 'SUPER_ADMIN' group by u.email order by u.email;"
echo "== D-4 one audit row per stocking run"
q "select action, count(*) from \"AuditLog\" where \"clinicId\" = $CLINIC and action = 'DEMO_CLINIC_STOCKED' group by action;"
```

| Check | Expected                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1   | `Demo visit A \| Thu 09:00 \| t \| patient@<SUB>.example.test` and `Demo visit B \| Thu 09:45 \| t \| …` (the day and time follow from when you run it) |
| D-2   | `Arnica Gel OTC`, `Golden Turmeric Blend SUPPLEMENT`, `Magnesium Glycinate SUPPLEMENT`, `Tramadol RX_SCHEDULED`, each with a slug                       |
| D-3   | doctor `0`, front desk `2`, patient `2`                                                                                                                 |
| D-4   | `DEMO_CLINIC_STOCKED \| 2` (B-5 and B-10)                                                                                                               |

### 9.5 Browser checks (F-1 … F-7)

Run 9.3 once more for a fresh `SUB`, but stop after B-5 (or re-issue links with `stock --apply --reissue`). Use one browser profile per person, then open each printed link in its person's profile.

| #   | Steps                                                                                                                                                                                                                | Expected                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | Doctor profile: open the doctor's link → **Password** and **Confirm password** `Demo-Staff-2026!` → **Set password**                                                                                                 | _Password set successfully._ → the login page                                                                                                                 |
| F-2 | Same for the front desk and the patient links; open the doctor's link again                                                                                                                                          | _Invalid or expired token_ for the reused link                                                                                                                |
| F-3 | Owner (`owner@<SUB>.example.test` / `Demo-Clinic-2026!`): **Website** → **Browse templates** → **Use this template** → **Install template** → **Publish site**; open `http://<SUB>.localhost:4310/team` and `/store` | _Your website is live_; the team shows **Dr. Evelyn Chen**; the store shows **Mobility Roller Kit**, no Tramadol                                              |
| F-4 | Doctor: sign in → **Skip tour** → **Queue** → Visit A → **Enter Consultation Room** → **Demo: simulate conversation**                                                                                                | **Detected products**: Magnesium Glycinate · 400 mg × 2, Arnica Gel × 1, Tramadol · 50 mg × 1 (**e-Prescribe**), **Turmeric complex × 1** under _Not matched_ |
| F-5 | Map the turmeric to **Golden Turmeric Blend**, remove **Arnica Gel**, tick **I confirm these products…** → **Approve & send**                                                                                        | _On approval: 2 to the patient's cart, 1 to e-prescribe_; then _2 products sent to the patient's cart_                                                        |
| F-6 | Patient: sign in → `/checkout`                                                                                                                                                                                       | Two lines **Prescribed · Dr. Evelyn Chen** (Magnesium Glycinate, Golden Turmeric Blend); no Tramadol                                                          |
| F-7 | Front desk: sign in → **Checkout**                                                                                                                                                                                   | The **Packages** section lists **10-Session Physio Rehab Package**                                                                                            |

### 9.6 Reset (B-11): off-board the clinic

The demo's Part B reset. Run in the same shell as 9.3:

```bash
echo "== B-11 off-board: the label and the e-mails are free again"
curl -s -H "$H" -H "$C" -H "authorization: Bearer $PLAT" -d "{\"confirmSlug\":\"$SUB\"}" $API/platform/lifecycle/tenants/$TENANT/offboard | j 'd.success'
curl -s "$API/tenants/check-subdomain?subdomain=$SUB" | j 'd.data.available'
curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "$C" -d "{\"email\":\"doctor@$SUB.example.test\",\"password\":\"Demo-Staff-2026!\"}" $API/auth/login
```

Expected: `true`, `true`, `401`. A new sign-up can now use the same label and be stocked again (§4.5).

### 9.7 Cleanup

```bash
# stop both servers (Ctrl+C in terminals 1 and 2), then:
docker exec mf-pg psql -U postgres -c "DROP DATABASE mf_demo_stock_manual"
rm backend/.env.manual-demo-stock.local
```

### 9.8 Result sheet

| Check      | Pass / fail | Notes |
| ---------- | ----------- | ----- |
| B-1 … B-11 |             |       |
| D-1 … D-4  |             |       |
| F-1 … F-7  |             |       |
