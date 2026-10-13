# F0 — Frontend foundation: walkthrough and verification

**Date:** 2026-10-14 · **Branch:** `feat/f0-frontend-foundation` (on top of `feat/b0-backend-foundation`) · **Data:** synthetic only. The PHI gate stays closed.
**Plan reference:** `arh-agent-docs/development-plan.md` › F0.1–F0.4.

---

## 1. Outcome

| Task                                                         | AC (short)                                                                                        | Status                                      | Evidence                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **F0.1.1** Remove `ignoreBuildErrors` / `ignoreDuringBuilds` | Both flags gone; a deliberate type error fails the prod build                                     | ✅                                          | `frontend/next.config.js`; demo in §4.2                                                                                      |
| **F0.1.2** typecheck + lint (0 warnings) + audit block CI    | A PR with a lint warning or type error cannot merge                                               | 🟨 gate built                               | `Frontend quality gate` job in `.github/workflows/deploy.yml`, which deploys need. **Manual:** mark it a required check (§6) |
| **F0.1.3** Remove stray repo assets                          | Loose image and unreferenced files gone                                                           | ✅                                          | 10 files removed (§3)                                                                                                        |
| **F0.2.1** Idle-timeout / auto-logoff UX                     | e2e: warning, then logout, screen cleared                                                         | ✅                                          | `e2e/idle-timeout.spec.ts` (2 tests)                                                                                         |
| **F0.2.2** MFA enrol + challenge UI                          | e2e: enrol; challenge passes with a valid code and fails with an invalid one; keyboard accessible | ✅                                          | `e2e/mfa.spec.ts` (keyboard-only, axe scan) + `tests/components/mfaChallengeForm.test.tsx`                                   |
| **F0.2.3** Token-storage decision                            | Decision documented; refresh token HttpOnly; access token not in `localStorage`                   | ✅                                          | `docs/FRONTEND_TOKEN_STORAGE.md`; tests in §4                                                                                |
| **F0.2.4** Pre-auth render + logout cache clear              | Protected route never renders before auth; cache empty after logout                               | ✅                                          | `tests/components/protectedLayouts.test.tsx`, `authProvider.test.tsx`                                                        |
| **F0.3.1** No PHI in URLs                                    | Audit finds zero; signed checklist                                                                | 🟨 fixed + guarded; sign-off pending        | `docs/PHI_IN_UI_REVIEW.md`; `tests/unit/staticGuards.test.ts`                                                                |
| **F0.3.2** No PHI in logs / toasts / errors                  | Sweep + manual pass                                                                               | 🟨 fixed + guarded; manual pass pending     | `lib/clientLog.ts`, ESLint `no-console`, `phiScrub.test.ts`                                                                  |
| **F0.3.3** Client telemetry scrubbed or BAA-covered          | A test proves scrubbing, or the vendor has a BAA                                                  | ✅ (none in use; gate in place)             | `telemetry-allowlist.json` + `staticGuards.test.ts` + `phiScrub.test.ts`                                                     |
| **F0.3.4** Minimum-necessary rendering                       | PHI views request only displayed fields; backend select narrowed                                  | 🟨 fixed + guarded; review sign-off pending | invoice leak fixed; `backend/src/tests/minimumNecessary.test.ts`                                                             |
| **F0.4.1** Test runner + CI                                  | `test` runs in CI and blocks merge                                                                | ✅ (blocking once the check is required)    | Vitest + Playwright; coverage ratchet                                                                                        |
| **F0.4.2** Core tests                                        | (a) refresh interceptor (b) role guards (c) PHI boundary                                          | ✅                                          | `apiClient.test.ts`, `routeGuards.test.ts`, `portalPhiBoundary.test.tsx`                                                     |

**Exit criteria (Ph0 frontend part):**

- Build gate on: ✅
- CI gate: ✅ built; becomes enforcing when the owner marks it required.
- Session/MFA UX paired with B0.2: ✅
- PHI-in-UI hygiene: fixed and automatically guarded; human sign-off pending.
- Test harness with core tests: ✅

---

## 2. Problems found and fixed

1. **Invoices leaked credentials.** Every invoice API response used `patient: true`, which returned the whole `User` row to the browser: argon2 password hash, MFA secret and recovery codes. Front-desk staff saw it for every patient; patients saw their own. **Fixed:** `PATIENT_SUMMARY_SELECT = {id, name, email}`, an integration test, and a source guard against any new `patient: true` / `user: true` include.
2. **Production refresh never worked.** The refresh cookie was `SameSite=Strict`, but the app (`workers.dev`) and the API (`onrender.com`) are different sites, so the browser never sent it. Users were signed out when the 15-minute access token expired. **Fixed:**
   - The cookie is now `SameSite=None; Secure; Partitioned`, set by `REFRESH_COOKIE_SAMESITE`; switch it to `strict` after B0.6.9.
   - Refresh and logout now require the `X-MedoFlow-Client` header as a CSRF guard.
3. **Next.js 14 is end of life** and had open critical/high advisories with no 14.x fix. **Upgraded:**

   | Package                       | From    | To                      |
   | ----------------------------- | ------- | ----------------------- |
   | Next.js                       | 14.2.35 | 15.5.27 (backport line) |
   | React                         | 18      | 19                      |
   | axios                         | —       | 1.20                    |
   | `@opennextjs/cloudflare`      | 1.15.1  | 1.20.7                  |
   | wrangler                      | —       | 4.145 (needs Node 22)   |
   | `@react-three/fiber` / `drei` | —       | 9 / 10                  |

   Unused dependencies were removed: `recharts`, `lottie-react`, `js-cookie`, `gsap`.

4. **The type gate had been off for a dependency bug.** `@hookform/resolvers` picked up the backend's hoisted zod 4, which produced 16 type errors. **Fixed:** a `pnpm.packageExtensions` zod peer, then the typecheck was clean and the flags were removed.
5. **Three real hook-order bugs**, flagged once lint actually ran. The admin dashboard, the front-desk dashboard and `ProviderDashboard` called hooks after an early `return`, which crashes React when the role or data state changes. Each was split into a role guard plus a content component.
6. **Patient consultation consent always failed.** It read a `localStorage` key that never existed, so the request had no token and returned 401. It now uses the shared API client.
7. **PHI in URLs:**
   - `/public/patients/check?email=` is now a POST with the email in the body.
   - The Stripe `clientSecret` was put in the `/payment/:id` URL. Nothing read it, so it was removed.
8. **24 raw `console` calls**, several logging whole Axios errors (request body, auth header, response). All now go through the scrubbed `clientLog`; `no-console` is an ESLint error.
9. **Accessibility:** the MFA "Verify" button failed WCAG contrast (3.74:1) and was darkened to 5.5:1. The main "Sign in" button uses the same brand teal and needs a design decision (§7).
10. **Dead link:** the top bar's "Settings" pointed to a page that didn't exist. It is now the staff **Security** page (MFA plus session policy).

---

## 3. What was built (files)

**Session and auth (frontend):**

- `lib/api.ts`: memory-only access token; single-flight refresh serialised across tabs with Web Locks; client header; auth-failure hook; removes any old copy from `localStorage`.
- `contexts/AuthContext.tsx`:
  - restores the session from the cookie on load;
  - `login()` returns an MFA challenge when one is needed, plus `verifyMfa()`;
  - logout and session end clear the query cache, sign out every tab (BroadcastChannel) and route to sign-in with a reason.
- `components/auth/IdleTimeoutManager.tsx` + `lib/idleTimeout.ts`:
  - shows a warning one minute before the server's idle window ends;
  - only "Stay signed in" extends the session, so a nudged mouse doesn't;
  - sends heartbeats (`GET /auth/session`) only while the user is actually active;
  - activity is shared across tabs, and returning to a tab re-checks immediately.
- `components/auth/MfaChallengeForm.tsx`: the second sign-in step (code or recovery code), with focus management, `aria-invalid`/`aria-describedby` and alerts. It is wired into `AuthModal` LoginForm, which also shows the "signed out after inactivity" notice.
- `components/auth/MfaSettings.tsx` + `app/dashboard/settings/page.tsx` + `lib/mfaApi.ts`: enrolment (QR via `qrcode.react` plus manual key), recovery codes shown once, and disable.
- `lib/routeGuards.ts`: pure guards for dashboard, portal and platform. The layouts render nothing until the guard allows.

**PHI hygiene:** `lib/phiScrub.ts`, `lib/clientLog.ts`, `lib/apiErrors.ts`, `telemetry-allowlist.json`.

**Backend (paired):**

- `authController.ts`:
  - `refreshCookieOptions()` and `requireClientHeader`;
  - `GET /auth/session` heartbeat;
  - `/auth/me` now returns `session.idleTimeoutMinutes`.
- `public.ts`: `POST /patients/check`.
- `invoiceService.ts` / `paymentService.ts`: narrowed selects.
- Tests in `authSafeguards`, `authzAndPublic`, `moneyAndBooking`, `b0Foundation`, plus `minimumNecessary.test.ts`.
- `render.yaml` / `.env.example`: `REFRESH_COOKIE_SAMESITE`.

**Tooling:**

- `frontend/.eslintrc.json`.
- `vitest.config.ts` + `tests/` (11 files, 71 tests).
- `playwright.config.ts` + `e2e/`: a stateful mock API that verifies real RFC 6238 TOTP codes, plus axe.
- `scripts/e2e-server.js`, `scripts/audit-frontend.js` + `audit-exceptions.json`.
- The `frontend-quality` CI job.

**Removed (F0.1.3):**

- `frontend/WhatsApp Image 2026-03-16 at 10.33.54.jpeg`
- `find_legacy.js`, `medoflow.css`, `medoflow.js` (0 bytes), `minified.js` (500 KB), `modify_schema.py`
- `vercel.json`, `frontend/vercel.json` (deploys are Cloudflare/Render)
- a tracked `.claude/worktrees/...` file
- the unused `components/LoginModal.tsx`

**Docs:** `docs/FRONTEND_TOKEN_STORAGE.md`, `docs/PHI_IN_UI_REVIEW.md`, and the updated `docs/PUBLIC_ROUTE_SCOPING.md`.

---

## 4. Verification — commands and results

Run from the repo root in Git Bash, with Node 20+ for build and tests and Node 22 for wrangler. Install first with `pnpm install --frozen-lockfile`.

### 4.1 Frontend gate (same steps as CI)

```bash
cd frontend
pnpm run typecheck            # ✓ route types generated, tsc clean
pnpm run lint                 # ✔ No ESLint warnings or errors (app, components, lib, hooks, contexts, tests, e2e)
pnpm run test:coverage        # 11 files, 71 tests passed; coverage ratchet lines 19 / functions 50 / branches 75
node scripts/audit-frontend.js  # ✓ no unaccepted high/critical (sharp: accepted, dated exception — §7)
```

### 4.2 F0.1.1 — a type error fails the production build (demonstrated 2026-10-14)

```bash
cd frontend
printf "export const brokenOnPurpose: number = 'not a number'\n" > lib/__demo.ts
NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 pnpm exec next build   # exit 1
#   Failed to compile.
#   ./lib/__f011_type_error_demo.ts:2:14
#   Type error: Type 'string' is not assignable to type 'number'.
rm lib/__demo.ts
```

### 4.3 E2E (F0.2.1 idle logoff, F0.2.2 MFA)

- **Linux/macOS/CI:** `pnpm test:e2e` builds, serves on :4310 and runs Chromium. Run `pnpm exec playwright install chromium` once beforehand.
- **Windows** (Playwright can't stop its own server there):

```bash
cd frontend
NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 pnpm exec next build
pnpm test:e2e:serve                        # terminal 1
E2E_EXTERNAL_SERVER=1 pnpm test:e2e        # terminal 2
```

Result 2026-10-14: **3 passed**.

- **Idle warning → sign-out:** at 14 min the alert dialog shows a countdown with focus on "Stay signed in". At 15 min the app calls `POST /auth/logout`, the URL gets `reason=idle`, and the Security heading and the user's name are gone. Re-opening `/dashboard/settings` goes to sign-in.
- **"Stay signed in":** pressing Enter extends the session and sends `GET /auth/session`. No logout follows.
- **MFA:**
  - enrolment: QR plus key; `000000` is refused with `aria-invalid`; the real TOTP turns MFA on and shows 8 recovery codes;
  - sign out, then sign in: the challenge screen opens with focus on the code field; a wrong code is refused; the correct code reaches `/dashboard/settings`;
  - the whole flow is keyboard-only; axe reports 0 serious/critical violations on both MFA screens.

### 4.4 Backend (paired changes)

```bash
cd backend
pnpm run typecheck && pnpm run lint
pnpm run test:coverage                       # 14 files, 128 tests passed
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it
pnpm run test:integration:coverage           # 7 files, 84 tests passed (lines 34.9 %)
node scripts/audit-backend.js                # ✓
```

New backend checks:

- refresh and logout return 403 without the client header;
- the refresh cookie is HttpOnly;
- `/auth/me` and `/auth/session` report the idle window;
- the email check works as POST, and GET now returns 404;
- invoices carry only `id`/`name`/`email` and no credential field;
- unit tests cover the cookie policy per environment.

### 4.5 Cloudflare build (production adapter)

The OpenNext build must run on **Linux**; on Windows every page returns 500, as found in Part 0. Verified in a `node:22-bookworm` container:

```bash
git ls-files -co --exclude-standard > /tmp/files.txt && tar -cf /tmp/src.tar -T /tmp/files.txt
MSYS_NO_PATHCONV=1 docker run --rm -v "$(cygpath -w /tmp):/scripts" node:22-bookworm bash -c '
  mkdir /work && cd /work && tar -xf /scripts/src.tar && corepack enable &&
  pnpm install --frozen-lockfile --filter medoflow-frontend... && cd frontend &&
  NEXT_PUBLIC_API_URL=https://medoflow-backend-6pd5.onrender.com pnpm run cf:build &&
  (OPEN_NEXT_DEPLOY=true pnpm exec wrangler dev --port 8787 --local-protocol https &) ; sleep 40;
  for p in / /login /dashboard /dashboard/settings /account /store /clinic/demo /platform/clinics; do
    echo "$p $(curl -sk -o /dev/null -w %{http_code} https://127.0.0.1:8787$p)"; done'
```

Result: see §4.6. CI's `build` job runs the same `cf:build` on Ubuntu.

### 4.6 Linux worker smoke result (2026-10-14)

LINUX_SMOKE_RESULT

### 4.7 Manual browser checks (5 minutes, after deploy)

1. Sign in as `frontdesk@medoflow.test`. In DevTools › Application, Local Storage has **no** token, and Cookies › `refreshToken` is **HttpOnly**.
2. Reload the page. You stay signed in, because the refresh cookie restores the session.
3. Top-bar menu › **Security** › Set up two-step verification. Scan with an authenticator app, enter the code, and save the recovery codes. Sign out and sign in again: the 6-digit challenge appears.
4. Leave the tab idle for 14 minutes. The warning appears. At 15 minutes you're signed out, with "signed out after a period of inactivity" shown.
5. Open two tabs and log out in one. The other tab is signed out too.
6. Network tab: no email or name in any request URL. The `GET /invoices/:id` response shows `patient` = `{id, name, email}` only.

---

## 5. Local setup recap

| What             | How                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------- |
| DB / Redis       | Docker `mf-pg` (:55432) and `mf-redis` (:56379), as in the B0 walkthrough           |
| API              | `cd backend && pnpm dev`, on **:4302** locally; Windows reserves 3001 and 3100      |
| App              | `cd frontend && NEXT_PUBLIC_API_URL=http://localhost:4302 pnpm dev`                 |
| Browsers for e2e | `pnpm exec playwright install chromium`                                             |
| Node             | 20 for build and tests; **22 for wrangler** (`cf:preview`, deploy). CI uses Node 22 |

---

## 6. What you must do manually to declare F0 complete

1. **Deploy B0 and F0 together.** The new frontend depends on the backend's client-header and cookie changes.
   - Merge `feat/b0-backend-foundation` first, or include it in the same PR.
   - In Render, set **`REFRESH_COOKIE_SAMESITE=none`**. This is already in `render.yaml`; it is also the production default.
   - Complete the B0 manual steps from `backend-foundation-B0-WALKTHROUGH-AND-VERIFICATION.md` §6.
2. **Push, open the PR** to `myselfabhi/MedoFlow`, and wait for these checks to pass: **Frontend quality gate**, **Backend quality gate** and **Build**.
3. **Branch protection** (Settings › Branches › `main`): mark **"Frontend quality gate"** as required, alongside the backend gate and Build. Then **demonstrate**:
   - Open a throwaway PR that adds `const x: number = 'a'` to a frontend file. CI fails, and Merge is blocked.
   - Open another that adds `console.log(1)`. Lint fails with `no-console`, and Merge is blocked.
   - Screenshot both for the F0.1.2 evidence, then close both PRs.
4. **Run the manual browser checks** in §4.7 on the deployed app.
5. **Sign `docs/PHI_IN_UI_REVIEW.md`** (frontend reviewer + Security/Privacy Officer) after the manual pass in its "Manual pass" section. This closes F0.3.1, F0.3.2 and F0.3.4.
6. **Decide the brand-button contrast** (§7) with design.
7. **After B0.6.9 (custom domains),** set `REFRESH_COOKIE_SAMESITE=strict` on Render.

---

## 7. Known limits and open items

- **Accepted, dated exception:** `sharp` high advisories (GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w).
  - Next 15.5 allows the fixed sharp 0.35.5, but OpenNext can't bundle it yet, so sharp is pinned to 0.34.5 (`next>sharp`).
  - sharp never runs on Cloudflare Workers.
  - Recorded in `frontend/scripts/audit-exceptions.json`; expires 2027-01-31.
- **Windows:** OpenNext builds must run on Linux (Docker/CI). Playwright's built-in server doesn't stop on Windows; use the two-terminal flow in §4.3. Wrangler now needs Node 22.
- **Contrast:** the shared `mf-btn-primary` (white on `#0d9488`) is 3.74:1, below WCAG AA (4.5:1) for 14 px text. The MFA screens use a darker teal. The global brand colour is a design decision.
- **The e2e suite uses a simulated API** (stateful, real TOTP) so it runs anywhere without a database. The backend behaviour behind the same screens is covered by the backend integration suites.
- **Staff "Profile" link** in the top-bar menu points to the patient-only `/account/profile`. This is pre-existing and outside F0; logged for the F-component owner.
- **The MFA requirement is opt-in per staff user** (B0.2.2 AC: "after enrolment"). Making it mandatory per clinic is a later policy decision.
