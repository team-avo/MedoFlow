# CTO demo feedback, tiers T1 to T3 (CTO-01 to CTO-35): walkthrough and verification

**Date:** 2026-11-13 · **Branch:** `feat/cto-feedback` (from `development` at `5dcc850`, one commit per task, not pushed) · **Data:** synthetic only · **Machine:** macOS (Intel), zsh, Node 22 via nvm, Docker Desktop.

**Trigger:** Khush (CTO) tested MedoFlow on 2026-11-11 and 2026-11-12. On a fresh clinic he could not reach AI Scribe, because the setup wizard sent the owner through brand and website steps first. His next test is a brand-new clinic with **no website**, where appointments, AI Scribe and products must all work. `arh-agent-docs/cto-feedback-tasks.md` turned both demos into 43 tasks with acceptance criteria; this branch delivers every T1, T2 and T3 task (CTO-01 to CTO-35). T4 and T5 (CTO-36 to CTO-43) are design-first or strategic and are not in this branch.

**Owner decisions (2026-11-12):**

- **Toolchain:** nvm in user space.
- **CTO-26:** the backend deploys the clinic address through the Cloudflare Pages Direct Upload API.
- **Commits:** one commit per task, no push or PR until asked.
- **CTO-10:** retyping the clinic name is demo-only (Khush, 2026-11-12).

---

## 1. Outcome

Every task meets its acceptance criteria and the universal standard:

- the CI gate is green (§4.1);
- tests cover the happy path and a failure or edge case;
- there are no regressions;
- the work was re-tested on a freshly signed-up clinic, with a recorded run against the real backend (§4.4).

| Task       | What                                                             | Status    | Commit              | Evidence                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------- | --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CTO-01     | "Queue" is "Appointments" everywhere                             | ✅        | `1ed7c72`           | `navigation.spec.ts`; front desk card "Today's appointments"                                                                                                  |
| CTO-02     | No "Video Room" tab; the old URL redirects (OAuth callback kept) | ✅        | `1ed7c72`           | `navigation.spec.ts` (redirect to Appointments); Google connect card on the provider profile                                                                  |
| CTO-03     | No Store tab for providers                                       | ✅        | `1ed7c72`           | `navigation.spec.ts`                                                                                                                                          |
| CTO-04     | No "Sales rep" field                                             | ✅        | `aadd17d`           | e2e asserts the field is gone; a client that still sends it gets 200 (stripped); §9 B-4                                                                       |
| CTO-05     | Team size and "How did you hear" align                           | ✅        | `aadd17d` `f83d53a` | e2e measures both inputs at 1280 and 375 px; screenshots in `assets/cto-feedback/`                                                                            |
| CTO-06     | "Longevity medical practice" type                                | ✅        | `aadd17d`           | `shared/validation-cases/practice-lists.json` read by both sides                                                                                              |
| CTO-07     | "Show password" on every password field                          | ✅        | `73f41b2`           | `passwordInput.test.tsx`, `password-toggle.spec.ts` (submit in both states, axe)                                                                              |
| CTO-08     | "I agree to all of the above"                                    | ✅        | `13babe7` `388a1d8` | `agreementPage.test.tsx` (mixed state); e2e sends every acknowledgement                                                                                       |
| CTO-09     | Team size 1 works end to end                                     | ✅        | `aadd17d`           | e2e types "1" into the field and gets 1, then approval and the dashboard; §2                                                                                  |
| CTO-10     | "Retype clinic name" is a switch                                 | ✅        | `13babe7`           | `clinicReview.test.ts` (on, off, unset by `NODE_ENV`); int test for both states; §9 B-3                                                                       |
| CTO-11     | No em dashes anywhere in the product                             | ✅        | `082691f`           | `scripts/check-no-em-dash.js` in both CI gates (0 in 815 files); site copy upgrade script; §4.5                                                               |
| CTO-12     | AI Scribe is never plan-gated                                    | ✅        | `7dddc1b`           | `plans.test.ts`; int test: every plan, both billing modes, start → process → approve; §9 B-12                                                                 |
| CTO-13     | No sign-out while filling the application                        | ✅        | `bd211bb`           | `idleTimeoutManager.test.tsx` (45 min of typing); `authSafeguards.int.test.ts` for both windows; e2e draft survives a refresh without the tax ID; §9 B-2/B-11 |
| CTO-14     | The account creator is a provider                                | ✅        | `13babe7`           | `clinicOnboarding.int.test.ts` both ways, idempotent (no second Provider); §9 D-2                                                                             |
| CTO-15     | Owner-is-a-doctor wording                                        | ✅        | `13babe7`           | Copy list in §3.2                                                                                                                                             |
| CTO-16     | Title field with US options                                      | ✅        | `13babe7` `388a1d8` | Shared `PRACTITIONER_TITLES`; e2e checks the signer title is pre-filled                                                                                       |
| CTO-17     | Contacts step trimmed                                            | ✅        | `aadd17d`           | Int and component tests; e2e asserts office manager and AP fields are gone                                                                                    |
| CTO-18     | "Other" takes a typed name                                       | ✅        | `aadd17d`           | Shared cases; e2e "longevitty" suggests Longevity; §9 B-5                                                                                                     |
| CTO-19     | Command Center setup dialog shrunk                               | ✅        | `22d7ee1`           | `clinic-onboarding.spec.ts` at 1280×800: no dialog, KPIs and today's appointments in view; collapse remembered (`clinicOnboarding.test.tsx`)                  |
| CTO-20     | One Commerce group, no Catalog, Settings last                    | ✅        | `1ed7c72`           | `navigation.spec.ts` checks the exact link order                                                                                                              |
| CTO-21     | "Which conditions?" when the answer is Yes                       | ✅        | `9f5a592`           | Shared cases; int test asserts `fle:v1:` on the stored answer; default intake form at sign-up; §9 B-18                                                        |
| CTO-22     | US address and ZIP validation                                    | ✅        | `aadd17d`           | Shared cases (AS, MP, ZIP+4); ZIP-to-state warning only; §9 B-6                                                                                               |
| **CTO-23** | **Website optional; the core product works without it**          | ✅        | `c12f8f0` `dea0e98` | `freshClinicNoWebsite.int.test.ts`; **recorded real-backend run, 6/6** (§4.4); grep and review in §2                                                          |
| **CTO-24** | **Owner and admins create appointments (walk-in, phone)**        | ✅        | `a19a2d9`           | Int: owner, front desk, provider 403, custom role with and without the permission, other clinic 404, overlap 409, audit actor                                 |
| **CTO-25** | **Straight to the dashboard after the application**              | ✅        | `22d7ee1`           | Backfill migration; route-guard table; e2e owner journey                                                                                                      |
| CTO-26     | The clinic website goes live from inside the product             | ✅ (code) | `6c667d9`           | `siteLaunch.int.test.ts` (stubbed Pages API), `site-launch.spec.ts`; **the real Cloudflare run is a manual step (§6.1)**                                      |
| CTO-27     | Logo → brand colours                                             | ✅        | `a0e6ffa`           | `brandColors.test.ts` (fixture palette, AA adjustment, SVG sanitising); `brand.spec.ts`                                                                       |
| CTO-28     | Brand colours in the console                                     | ✅        | `a0e6ffa`           | `consoleTheme.test.ts` (safe tint when a colour fails AA); `brand.spec.ts`                                                                                    |
| CTO-29     | Real NPI lookup (type 1 and type 2)                              | ✅        | `b0e2e82`           | `npiRegistry.test.ts` on recorded NPPES answers; int test for overrides; no network in tests                                                                  |
| CTO-30     | Start AI Scribe from lists, with reminders                       | ✅        | `3b4071b` `dea0e98` | `start-scribe.spec.ts`; `providerReminders.int.test.ts` (payload allow-list); recorded run step b                                                             |
| CTO-31     | Virtual vs in-person appointments                                | ✅        | `3b4071b` `dea0e98` | `appointmentMode.int.test.ts` (both modes; the room keeps the mode after consent)                                                                             |
| CTO-32     | MedoFlow-branded checkout for clinics without a website          | ✅        | `ea68be3`           | Int: single use, expiry, another patient 404; recorded run step d                                                                                             |
| CTO-33     | Scribe "key changes to approve" and auto-cart on approve         | ✅        | `ea68be3` `d93c1ef` | `rxCart.int.test.ts` (CTO-32/33 block), `key-changes.spec.ts`; unstocked lines listed, never dropped; B5.5 e-prescribe test still green                       |
| CTO-34     | Multiple locations                                               | ✅        | `51c99a3`           | `locations.int.test.ts` (timezone per location, 409 cases); `locations.spec.ts`; §9 B-17                                                                      |
| CTO-35     | Auto-end an idle video call                                      | ✅        | `291aff8`           | Fake-timer `idleCall.test.ts` and `jitsiVideoCall.test.tsx`; int test for the audit; real 8x8 check is manual (§9 F-16)                                       |

## 2. Problems found (root causes)

- **What blocked Khush on a fresh clinic (CTO-23 / CTO-25).** I reproduced it on a fresh sign-up. The blocking step was the **setup wizard**: after the application, `needsOnboarding` held the dashboard until `onboardingCompletedAt` was set, and only the wizard's last step set it. The wizard ran `/welcome → /brand → …`, and `/brand` lives in the site editor, so the owner had to touch the website first. A second blocker sat behind it: the owner was **never linked to a Provider**, so even on the dashboard there was nobody to book with and no scribe to start. Both are fixed (CTO-25, CTO-14).
- **Nothing else gates on a website.** A grep of non-site code for `publishedAt` finds only two uses: `checkoutLinkService` (to choose which checkout link to send) and `aiScribeService` (a summary line). Public gates all use `liveClinicWhere`, which is approval, never "site published" (CTO-23 AC2).
- **Owner bookings were recorded as `PUBLIC`** (CTO-24). The controller treated any non-front-desk caller as a public booking, and the minimum-notice rule made "walk-in, now" impossible for staff.
- **Hours ignored the location** (CTO-34). `availabilityService.createAvailability` dropped `data.locationId` and always used the Online location.
- **Team size 1** (CTO-09). There was no backend fault. The hint listed three roles (owner, provider, front desk), which read as "you need three", and the field was pre-filled with 1, so typing "1" produced 11 (or 13). The hint now says 1 is fine, and the value is selected on focus.
- **Found only by the real-backend run (fixed in `dea0e98`).** The mocked e2e could not see these, because the mock returned the ideal shape:
  - **In-person visits turned into video calls.** `GET /consultations/appointment/:id`, the join link and `POST …/consent/attest` returned the session **without `appointment.mode`**. After the provider recorded consent, the room thought the visit was virtual and called `POST /video-room` (503 without JaaS) instead of starting audio. All three endpoints now return the mode, and the room keeps the appointment it loaded when a response leaves it out (`withSessionContext`).
  - **No way to set stock** from the UI, though CTO-23 step 1c needs it. Only `PUT /inventory/:id/adjust` existed, and it accepted any JSON (a negative or text count reached Prisma).
  - **Product form labels were not linked to their inputs** (an accessibility defect; screen readers and `getByLabel` could not find the fields).
- **An idle sign-out could say "session expired"** (found by the final full Playwright run; `idle-timeout.spec.ts` failed 1 run in 3).
  - The idle timer signs the user out, which ends the server session.
  - The notification bell (new with CTO-30) polls every 60 s. If its poll lands at that moment it gets a 401, the token refresh fails, and the auth-failure handler ended the session again as `expired`, overwriting `idle`. Either order was possible, because the sign-out awaits `POST /auth/logout`.
  - The cause is ordinary for real users too, not just tests. The fix is in [AuthContext.tsx](../frontend/contexts/AuthContext.tsx): a sign-out records its reason as soon as it starts, and an `expired` that arrives while a sign-out is in progress or done is ignored as a consequence. A new session clears it.
  - `authProvider.test.tsx` covers the poll after and during the sign-out (both fail without the fix), and a real expiry still reads "expired". The spec then passed 5 runs out of 5.
- **Em dashes in YAML** (CTO-11). Replacing a dash with a colon inside an unquoted `name:` or `run:` value makes it invalid YAML. The pre-commit Prettier check caught it before anything was committed; those values were reworded with commas or parentheses.

## 3. What changed (files)

### 3.1 The P0 path (CTO-25, CTO-14, CTO-24, CTO-12, CTO-23)

| Area                           | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Straight to the dashboard      | [clinicApplicationService.ts](../backend/src/services/clinicApplicationService.ts) stamps `onboardingCompletedAt` when the agreement is signed; migration `20261112000000_onboarding_complete_on_sign` backfills stranded clinics. [routeGuards.ts](../frontend/lib/routeGuards.ts) (`onboardingFinished`, application paths only); the old wizard pages only redirect                                                                                                              |
| Quick setup and Command Center | [SetupChecklist.tsx](../frontend/components/onboarding/SetupChecklist.tsx) (compact, collapsible, remembered in `user.preferences`, website optional); [TourContext.tsx](../frontend/contexts/TourContext.tsx) (no auto tour for owners); admin page website card demoted                                                                                                                                                                                                           |
| Owner is a provider            | [ownerProviderService.ts](../backend/src/services/ownerProviderService.ts) (`syncOwnerProvider`: one Provider, every location and service, Mon to Fri 09:00 to 17:00 if none; deactivated when the owner does not see patients); `PractitionersForm` row 0 is the owner                                                                                                                                                                                                             |
| Staff bookings                 | `POST /patients` ([clinicPatientService.ts](../backend/src/services/clinicPatientService.ts): placeholder `walkin+<uuid>@patients.invalid` for phone-only patients, invite link); `POST /appointments` takes `bookingSource` WALK_IN / PHONE (migration `20261112010000`) and `collectAtDesk`; `GET /appointments/availability`; [NewAppointmentDialog.tsx](../frontend/components/appointments/NewAppointmentDialog.tsx), [staffBookingApi.ts](../frontend/lib/staffBookingApi.ts) |
| Scribe in every plan           | [config/plans.ts](../backend/src/config/plans.ts) `PLAN_FEATURES`, "AI Scribe, included in every plan" on every card                                                                                                                                                                                                                                                                                                                                                                |
| Stock (found by the live run)  | [StockControl.tsx](../frontend/components/products/StockControl.tsx) (new) on each product card; `adjustInventorySchema` in [rxCartSchemas.ts](../backend/src/validation/rxCartSchemas.ts) on [routes/inventory.ts](../backend/src/routes/inventory.ts); labelled fields in [AddProductModal.tsx](../frontend/components/products/AddProductModal.tsx)                                                                                                                              |
| Tests                          | `freshClinicNoWebsite.int.test.ts`, `staffBooking.int.test.ts`, `clinicOnboarding.int.test.ts` (owner provider), `aiScribe.int.test.ts` (all plans), `plans.test.ts`, `new-appointment.spec.ts`, `clinic-onboarding.spec.ts`, `stockControl.test.tsx`, [live-fresh-clinic.spec.ts](../frontend/e2e/live-fresh-clinic.spec.ts) (opt-in, video)                                                                                                                                       |

### 3.2 T1 and T2: navigation, application form, copy

| Area                                             | Files                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar (01, 02, 03, 20)                         | [AppSidebar.tsx](../frontend/components/layout/AppSidebar.tsx) sections with `data-section`; [next.config.js](../frontend/next.config.js) redirects `/dashboard/provider/meetings` without `?code` to Appointments; the Google connect card moves to the provider profile                                                                                                                            |
| Practice form (04 to 09, 17, 18, 22)             | Both [practiceIds.ts](../frontend/lib/practiceIds.ts) files: Longevity type, AS and MP, `closestPracticeType`, `US_ZIP`, `zipStateMismatch`; [practice-lists.json](../shared/validation-cases/practice-lists.json); migration `20261112020000` (secondary contact, `practiceTypeOther`); retired fields stripped on the server; `AppFormField` `descriptionBelow`                                    |
| Practitioners and agreement (08, 10, 14, 15, 16) | `PRACTITIONER_TITLES`; [SelectAllCheckbox.tsx](../frontend/components/onboarding/SelectAllCheckbox.tsx); [config/clinicReview.ts](../backend/src/config/clinicReview.ts) `confirmClinicNameRequired` (`ONBOARDING_CONFIRM_NAME`), exposed as `config.confirmClinicName`                                                                                                                              |
| Password (07)                                    | [PasswordInput.tsx](../frontend/components/ui-system/PasswordInput.tsx) on get-started, set-password and the sign-in modal                                                                                                                                                                                                                                                                           |
| Idle (13)                                        | `UserSession.idleTimeoutMinutes` (migration `20261112030000`); [sessionService.ts](../backend/src/services/sessionService.ts); `GET /auth/session?context=onboarding`; [IdleTimeoutManager.tsx](../frontend/components/auth/IdleTimeoutManager.tsx); [formDraft.ts](../frontend/lib/formDraft.ts); [AuthContext.tsx](../frontend/contexts/AuthContext.tsx) keeps the sign-out reason over later 401s |
| Intake (21)                                      | `followUp` in both clinical-records schemas; [defaultIntakeTemplate.ts](../backend/src/config/defaultIntakeTemplate.ts); `POST /forms/templates/default`; `DynamicFormRenderer` and builder support                                                                                                                                                                                                  |
| Em dashes (11)                                   | [scripts/check-no-em-dash.js](../scripts/check-no-em-dash.js); [emDashUpgrade.ts](../backend/src/site/services/emDashUpgrade.ts) and [site-remove-em-dash.ts](../backend/scripts/site-remove-em-dash.ts); 390 files of copy, comments and tests                                                                                                                                                      |

**CTO-15 copy list** (the owner is the clinic's doctor and admin):

- The practitioners step is "Your practitioner details", with the owner first and an "I see patients" toggle.
- "Owner on record" is now "Primary account holder".
- The Command Center talks to the owner as the doctor who sees patients ("Start scribe", "Today's appointments") and as the admin ("Quick setup").

### 3.3 T3: visits, scribe, checkout, brand, NPI, site launch, locations, video

| Area                              | Files                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visit mode (31)                   | Migration `20261112040000` (`AppointmentMode`, `Appointment.mode`, `Service.defaultMode`); [virtualVisitService.ts](../backend/src/services/virtualVisitService.ts); `POST /consultations/:id/consent/attest`; consult room `inPerson` and the attest card; `withSessionContext` in [consultationApi.ts](../frontend/lib/consultationApi.ts)          |
| Start scribe and reminders (30)   | Migration `20261112050000` (`Notification`); [providerReminderService.ts](../backend/src/services/providerReminderService.ts), [routes/notifications.ts](../backend/src/routes/notifications.ts), a minute cron; `NotificationBell`, `StartingSoonCard`; Start scribe on the Command Center, provider dashboard and Appointments                      |
| Idle video (35)                   | [idleCall.ts](../frontend/lib/idleCall.ts); [JitsiVideoCall.tsx](../frontend/components/consultation/JitsiVideoCall.tsx) (`onAutoEnd`, prompt, `endCallOnce`); `POST /consultations/:id/video/auto-ended`                                                                                                                                             |
| Key changes and checkout (32, 33) | [keyChangesService.ts](../backend/src/services/keyChangesService.ts); migration `20261112060000` (`CheckoutLinkToken`); [checkoutLinkService.ts](../backend/src/services/checkoutLinkService.ts); `POST /checkout-links/open`; [c/[slug]/cart/page.tsx](../frontend/app/%28public%29/c/%5Bslug%5D/cart/page.tsx); `DetectedProductsPanel` key changes |
| Locations (34)                    | `DELETE /locations/:id` (soft); `createAvailability` honours `locationId`; [locations/page.tsx](../frontend/app/dashboard/locations/page.tsx)                                                                                                                                                                                                         |
| NPI (29)                          | [npiRegistryService.ts](../backend/src/services/npiRegistryService.ts); migration `20261112070000` (`ClinicProfile.npiVerification`); `GET /onboarding/npi/:npi`; [NpiRegistryCheck](../frontend/components/onboarding/NpiRegistryCheck.tsx); fixtures in `src/tests/fixtures/nppes.ts`                                                               |
| Brand (27, 28)                    | [brandColors.ts](../frontend/lib/brandColors.ts), [consoleTheme.ts](../frontend/lib/consoleTheme.ts); `BrandCard` on `/dashboard/clinic#brand`; `onboardingService.updateBrand` mirrors `Clinic.themeColor` and the site draft theme; Tailwind `brand` and `console` colours                                                                          |
| Site launch (26)                  | Migration `20261112080000` (`SiteLaunch`); [pagesClient.ts](../backend/src/site/frontDoor/pagesClient.ts), [siteLaunchService.ts](../backend/src/site/services/siteLaunchService.ts); `GET /site/launch`, `POST /site/launch/retry`; [LaunchStatus.tsx](../frontend/components/site/LaunchStatus.tsx)                                                 |

New clinic-scoped tables (`Notification`, `CheckoutLinkToken`, `SiteLaunch`) have the RLS policy, `GRANT … TO medoflow_app`, and are registered in `CLINIC_SCOPED_MODELS`. Every migration is additive.

## 4. Verification: commands and results

Run on 2026-11-13. Postgres is `mf-pg` on 55432; the CI-equivalent gate used a brand-new database `mf_ci`.

### 4.1 Gates (the same steps as `.github/workflows/deploy.yml`)

| Gate                                                                 | Result                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Backend typecheck (app and tests)                                    | clean                                                                                              |
| Backend ESLint (zero warnings)                                       | clean                                                                                              |
| Synthetic fixtures (`check-synthetic-fixtures.js`)                   | clean                                                                                              |
| No em dashes (`check-no-em-dash.js backend shared` / `frontend`)     | clean; 815 files across both areas                                                                 |
| Backend unit tests with coverage threshold                           | **39 files · 600 passed**                                                                          |
| Migrations on an empty database (`mf_ci`)                            | all 9 new migrations apply cleanly                                                                 |
| Backend integration with coverage threshold (`medoflow_app`, RLS on) | **27 files · 362 passed, 1 skipped** (the pre-existing opt-in availability benchmark)              |
| Backend dependency audit                                             | no unaccepted high or critical advisories                                                          |
| Frontend typecheck                                                   | clean                                                                                              |
| Frontend ESLint (zero warnings)                                      | clean                                                                                              |
| Frontend unit and component tests with coverage threshold            | **51 files · 599 passed**                                                                          |
| Frontend dependency audit                                            | no unaccepted high or critical advisories (the existing dated `sharp` exception, until 2027-01-31) |
| Production build (`next build --webpack`, e2e URLs)                  | succeeds                                                                                           |
| Playwright, full suite (production build, mocked API)                | **101 passed, 16 skipped** (the opt-in live specs), 0 failed, in 11.5 min                          |
| Real front end and back end, recorded                                | **6/6** (§4.4)                                                                                     |
| gitleaks v8.21.2 (Docker) over `development..HEAD`                   | 21 commits scanned, no leaks                                                                       |

The first full Playwright run had one failure, `idle-timeout.spec.ts`. That was a real race, not a flaky test (§2); it was fixed and the table shows the rerun.

### 4.2 Backend integration (real Postgres, `medoflow_app`, RLS on)

What the new suites prove:

- **`freshClinicNoWebsite`** (CTO-23):
  - Sign-up in auto review mode, then the application and agreement.
  - `onboardingCompletedAt` is set, and the owner's Provider is active.
  - Product, stock (and a bad count → 400), discipline and service.
  - A walk-in patient booked now, and a visit record.
  - The scribe simulated and approved with the confirmed product.
  - A `medoflow` checkout link; the patient sets a password, opens the link, accepts and pays. Stock goes down.
  - No site is ever published; `/public/clinics/:sub` and its services return 200.
- **`staffBooking`** (CTO-24): owner, front desk and custom roles with and without the permission; provider 403; another clinic's patient 404; overlap 409; the audit actor is the staff member.
- **`appointmentMode`** (CTO-31):
  - In person by default; a virtual booking gets a session, JaaS room and join link.
  - Verbal consent only from the visit's provider.
  - The consult room (start, reopen, join link and attest) always reports the mode.
- **`rxCart`, CTO-32/33 block:**
  - key changes against earlier approved orders;
  - unstocked lines are listed, not dropped;
  - the checkout link is single use, expires, gives another patient 404, and is stored hashed.
- **`locations`** (CTO-34): timezone per location; 409 for upcoming appointments and for the last location.
- **`siteLaunch`** (CTO-26):
  - Pending → live with the stubbed Pages API.
  - A transient failure is retried; a lasting one is FAILED with a reason, is audited, and can be retried. The platform email is best-effort and not asserted.
  - Off-boarding removes the branch.
- **`authSafeguards`, CTO-13 block:** 60 minutes only for an owner who hasn't signed; 15 for everyone else and after signing.

### 4.3 Frontend unit and Playwright (production build, mocked API)

```bash
cd ~/Work/AdvertOut/MedoFlow/frontend
NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 NEXT_PUBLIC_APP_URL=http://127.0.0.1:4310 node node_modules/next/dist/bin/next build --webpack
E2E_SKIP_BUILD=1 pnpm exec playwright test            # full suite, see §4.1
```

New specs on this branch:

- `navigation`, `new-appointment`, `start-scribe`, `key-changes`, `locations`;
- `password-toggle`, `brand`, `site-launch`;
- the extended `clinic-onboarding` owner journey;
- `live-fresh-clinic` (opt-in).

### 4.4 Real front end and back end, recorded (CTO-23 AC5)

**Setup:**

- **API:** the real API on `:3999`.
  - `medoflow_app` with RLS enforced; field encryption on; Redis for the scribe worker.
  - Mock speech-to-text and LLM.
  - `CLINIC_REVIEW_MODE=auto`, `BILLING_MODE=demo`, `NPI_REGISTRY_MODE=off`, no JaaS, no Stripe.
- **Database:** a fresh `mf_live`.
- **Frontend:** the production build on `:4310`.
- **Browser:** Chrome with a fake microphone, recording video.

```bash
cd ~/Work/AdvertOut/MedoFlow/frontend
E2E_LIVE_API=http://127.0.0.1:3999 E2E_SKIP_BUILD=1 pnpm exec playwright test e2e/live-fresh-clinic.spec.ts --reporter=line
```

```
[1/6] 1. sign up → application → dashboard, without opening a website page
[2/6] c. a product in the Storefront, with stock
[3/6] a. the owner books a walk-in for a new patient
[4/6] b. Start scribe from the list → consent → record → Approve & send
[5/6] d. the patient sets a password, opens the checkout link and pays
[6/6] no website page was ever opened
  6 passed (31.8s)
```

After the run, the database shows:

- 0 published sites;
- the walk-in booked as `WALK_IN · IN_PERSON · CONFIRMED`;
- the checkout link used;
- Magnesium Glycinate stock went from 10 to 8 (the two bottles from the scribe).

**Recordings**, to attach to the PR before Khush's next test:

- `arh-agent-docs/recordings/cto-23-fresh-clinic-2026-11-13/owner-signup-to-approve-and-send.webm` (5.7 MB): steps 1, c, a and b.
- `…/patient-checkout-link-and-pay.webm` (0.8 MB): step d.

The first three runs of this spec failed and exposed the three defects in §2. Each was fixed with a test before the run passed.

### 4.5 Em dash guard and existing website copy (CTO-11)

```bash
cd ~/Work/AdvertOut/MedoFlow
node scripts/check-no-em-dash.js                  # → No em dashes in 815 files.
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it pnpm exec ts-node --transpile-only scripts/site-remove-em-dash.ts
#   → "<clinicId>: 14 string(s) in settings (2), /contact (2), /home (4), /conditions (4), /privacy (2) (dry run)"
#   → "13 site(s) checked, 4 would change (run with --apply)"
#   with --apply → "13 site(s) checked, 4 updated"; run again → "0 would change"
```

After `--apply`, a query for U+2014 in every `SitePage` and `Site` copy column returns 0 rows.

## 5. Design notes

- **No wizard, a checklist.** Signing the agreement finishes onboarding. Brand, locations, services and team are Quick setup items the owner can do in any order, and the website is one of them, marked Optional. The old wizard URLs redirect, so bookmarks still work.
- **The owner's Provider is created by the server, idempotently**, from the practitioners step (`seesPatients`). If the owner later turns it off, the Provider is deactivated rather than deleted, so past visits keep their provider.
- **`appointments.manage` in the AC maps to the existing `appointments.create` permission**, and `patients.create` was added. A custom role needs those keys; providers still can't book for other providers.
- **Placeholder emails for phone-only patients** use the reserved `.invalid` TLD (RFC 2606), so nothing can ever be delivered there. They never leave the server: the API shows such a patient with no email.
- **The idle extension is server-side.** The 60-minute window is stored on the session and granted only to an owner whose agreement isn't signed, so a client can't extend its own session. Drafts never include the tax ID or DEA number.
- **Brand colours are computed in the browser.** The logo never goes to a third party. Any colour is made safe: text on it passes WCAG AA, and a tint stands out on the dark sidebar. Patients and platform admins keep MedoFlow's colours.
- **Which checkout link.** A clinic with a published site on its own address gets its site's checkout. Every other clinic gets `/c/<slug>/cart?t=…` on MedoFlow, clinic-branded. The token is hashed, lasts 72 hours, opens only for the cart's patient and works once.
- **Key changes are deterministic.** They compare the draft against the patient's earlier approved order lines; there's no AI judgement in what counts as a start, stop or dose change. Unstocked or unmapped items are listed for the provider, never silently dropped.
- **Site launch from the backend** (owner's decision). The worker uploads the existing front-door bundle to a Pages branch named after the clinic label. The token needs only "Pages: Edit" and stays on the server. Without the token the status is `NOT_CONFIGURED`, so development and tests never call Cloudflare.
- **NPI lookups** go to the public CMS NPPES API with a 5-second timeout and a one-hour cache. A mismatch is a warning the applicant can override with a reason, and the reviewer sees both. An unreachable registry falls back to the checksum and "could not verify", so onboarding never blocks on CMS.
- **Em dash rules.**
  - Visible copy was rewritten by hand where the automatic rule read badly (a comma, colon, full stop or semicolon, whichever reads naturally).
  - Lone placeholders are "Not set" or "None".
  - Code that must match the character (the legacy testimonial parser) uses the U+2014 escape.
  - Seed testimonials use " - " so that parser still splits the author.
  - Applied migrations are exempt, because their checksums are recorded.

## 6. What you must do manually

1. **Cloudflare Pages for CTO-26:**
   - Create an API token with only **Account › Cloudflare Pages › Edit**.
   - On Render, set `CF_PAGES_API_TOKEN`, `CF_ACCOUNT_ID` and `CF_PAGES_PROJECT=medoflow`.
   - If the Pages project doesn't exist yet, run the **Front door (Pages)** workflow once with an empty label (`.github/workflows/front-door.yml`).
   - Then publish a demo clinic's site. The site screen should go from "Going live" to "Live" with its address, and the address should open.
   - **The Direct Upload request shape is covered only against a stub** (§8). This run is its first real check.
2. **`ONBOARDING_CONFIRM_NAME`:**
   - `render.yaml` sets `on` for the hosted demo.
   - Unset, it is `off` in production, per Khush (demo-only).
   - Confirm that's still wanted before a production deploy.
3. **NPI lookups:** leave `NPI_REGISTRY_MODE` unset (live) on Render. It needs outbound HTTPS to `npiregistry.cms.hhs.gov`. Set `off` only if CMS is unreachable from the host.
4. **SMTP:** set it on Render so these emails go out:
   - patient invites;
   - "your cart is ready";
   - provider "starting soon" reminders;
   - the platform's site-launch failure email.

   Without SMTP, the invite and checkout links are shown in the product for staff to copy.

5. **Existing website copy:** on the hosted database, run `scripts/site-remove-em-dash.ts` as a dry run, then with `--apply` (§4.5). It changes draft and published copy, so live sites update without a re-publish.
6. **Attach the recordings** in §4.4 to the PR before Khush's next test.
7. **Workflow name:** the "many clinics" front-door workflow is now titled **Front door (Pages), many clinics**. The internal guides in `arh-agent-docs` still use the old title.

## 7. HIPAA / review checklist

- **Notifications and reminders** carry ids and a time only. A payload allow-list test fails if any other key is added, and the reminder email has no patient name.
- **Checkout links:**
  - the token is stored hashed, single use, expires after 72 hours, and opens only for the signed-in patient the cart belongs to;
  - another patient gets 404, which reveals nothing;
  - opening a link is audited.
- **Phone-only patients** get a non-routable placeholder email that is never shown or sent. The phone number is encrypted at rest, as before.
- **Intake follow-up answers** live inside the field-encrypted responses (the integration test asserts `fle:v1:` on the raw row).
- **The onboarding idle extension** applies only before the agreement is signed, when the owner can't yet see patient data. It is capped at 240 minutes. Form drafts in the browser exclude the tax ID and DEA number.
- **NPI lookups** send only NPI numbers, which are public provider identifiers, to CMS.
- **Brand colours** are computed in the browser. Uploaded SVGs are sanitised in the browser and checked again on the server.
- **The video auto-end** is audited with ids only.
- **The Cloudflare token** stays server-side, and the Pages bundle contains no clinic data, only the front-door router.
- **Staff bookings and new patients** are audited with the staff member as the actor.

## 8. Known limits

- **CTO-26:** the Pages Direct Upload request is tested only against a stub of the API. A real deploy (§6.1) is the first end-to-end check.
- **There is no clinic-hours model.** "Locations & hours" covers the places; opening hours are each provider's availability per location.
- **Retired columns remain:** `salesRep`, `officeManager*` and `accountsPayable*`. They are no longer asked, accepted or returned; dropping them needs agreement.
- **The em dash upgrade** does not rewrite published revision history (`SitePageRevision`). Restoring an old revision brings its punctuation back.
- **Idle video and video visits** are tested with a stub of 8x8 and fake timers, not a real JaaS call (§9 F-16 is the manual check).
- **The ZIP-to-state table** uses 3-digit prefixes. It is a warning only, so rare edge ZIPs may warn wrongly.
- **Key changes** compare only against earlier **approved** orders on MedoFlow; prescriptions from elsewhere are unknown.
- **Starting-soon reminders** go to the visit's provider only, not to front desk.
- **Flaky tests** (pre-existing; they pass when rerun):
  - the `patientFilesSection` unit test fails occasionally under full-suite load;
  - two `consultation-room` e2e tests failed once after other specs.

  Neither failed in the final runs above.

## 9. Manual local testing guide (macOS)

Three Terminal windows (zsh), from the repo. The API runs on **4312** and the frontend on **3010**. The steps assume the repo is at `~/Work/AdvertOut/MedoFlow`; change `REPO` if yours is elsewhere.

### 9.1 Before you start

- **Node 22 from nvm, and pnpm through corepack.** Check with:

  ```zsh
  source ~/.nvm/nvm.sh && nvm use 22 && corepack enable && node -v && pnpm -v
  # → Now using node v22.x … / v22.x / 10.33.0
  ```

- **Docker Desktop is running** (menu bar whale). If `docker` isn't found, add its CLI to your PATH: `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`. Then start Postgres: `docker start mf-pg`.
- **Ports 4312, 3010 and 56380 are free.** This prints nothing when they are:

  ```zsh
  for p in 4312 3010 56380; do lsof -nP -iTCP:$p -sTCP:LISTEN; done
  ```

### 9.2 One-time setup (terminal 3)

This creates a fresh database `mf_manual_cto`, a Redis container (the AI scribe worker needs it), and a gitignored env file.

```zsh
REPO=~/Work/AdvertOut/MedoFlow
cd $REPO/backend
DB=mf_manual_cto
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB pnpm exec prisma migrate deploy | tail -1
docker rm -f mf-redis-manual 2>/dev/null; docker run -d --name mf-redis-manual -p 56380:6379 redis:7 >/dev/null
H() { node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" }
cat > .env.cto-feedback.local <<EOF
# Local manual testing only (gitignored). Throwaway values.
PORT=4312
NODE_ENV=development
DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_manual_cto
CORS_ORIGIN=http://localhost:3010
FRONTEND_URL=http://localhost:3010
APP_HOSTS=localhost,127.0.0.1
JWT_SECRET=$(H)
MFA_ENCRYPTION_KEY=$(H)
FIELD_ENCRYPTION_PROVIDER=env
FIELD_ENCRYPTION_KEYS=k1:$(H)
FIELD_ENCRYPTION_ACTIVE_KID=k1
FILE_BLOB_SIGNING_SECRET=$(H)
REDIS_URL=redis://localhost:56380
TENANT_ISOLATION_MODE=enforce
CLINIC_REVIEW_MODE=auto
BILLING_MODE=demo
ONBOARDING_CONFIRM_NAME=off
NPI_REGISTRY_MODE=off
ONBOARDING_IDLE_TIMEOUT_MINUTES=60
AI_SCRIBE_LLM_PROVIDER=mock
AI_SCRIBE_STT_PROVIDER=mock
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
MANUAL_PASSWORD=Synthetic-Manual-$(node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
EOF
mkdir -p uploads
grep MANUAL_PASSWORD .env.cto-feedback.local
```

**Expect:**

```
All migrations have been successfully applied.
MANUAL_PASSWORD=Synthetic-Manual-<8 hex>
```

Keep the password; you'll use it in the browser.

### 9.3 Start the apps

```zsh
# Terminal 1: backend
cd ~/Work/AdvertOut/MedoFlow/backend && set -a && . ./.env.cto-feedback.local && set +a && pnpm exec ts-node --transpile-only src/server.ts
#   wait for: Medoflow server running on port 4312 (development)
#   and:      AI Scribe worker started
# Terminal 2: frontend
cd ~/Work/AdvertOut/MedoFlow/frontend && NEXT_PUBLIC_API_URL=http://localhost:4312 NEXT_PUBLIC_APP_URL=http://localhost:3010 node node_modules/next/dist/bin/next dev -p 3010
#   wait for: ✓ Ready
```

### 9.4 Backend checks (terminal 3)

This block signs up a brand-new clinic through the API and walks the CTO path. Paste it as-is.

zsh note: don't name a shell variable `path`, because in zsh it's tied to `PATH`. The helpers below use `u`.

```zsh
REPO=~/Work/AdvertOut/MedoFlow
cd $REPO/backend
set -a; . ./.env.cto-feedback.local; set +a
API=http://localhost:4312/api/v1
CL="X-MedoFlow-Client: web"
P() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log($1)})" }
req() { local m=$1 u=$2 body=$3; curl -s -X $m -H "$CL" -H "authorization: Bearer $AT" -H 'content-type: application/json' ${body:+-d "$body"} $API$u }
code() { local m=$1 u=$2 body=$3; curl -s -o /dev/null -w '%{http_code}' -X $m -H "$CL" -H "authorization: Bearer $AT" -H 'content-type: application/json' ${body:+-d "$body"} $API$u }
RUN=$(date +%s); SUB=manual$RUN; OWNER=owner.$RUN@example.test; NPI=1234567893
AT=""

echo "B-1 sign up: $(curl -s -H "$CL" -H 'content-type: application/json' -d "{\"clinicName\":\"Manual Longevity $RUN\",\"clinicEmail\":\"clinic.$RUN@example.test\",\"subdomain\":\"$SUB\",\"ownerName\":\"Manual Owner\",\"ownerEmail\":\"$OWNER\",\"password\":\"$MANUAL_PASSWORD\",\"plan\":\"FREE\"}" $API/tenants/signup | P 'd.data.verificationStatus')"
AT=$(curl -s -H "$CL" -H 'content-type: application/json' -d "{\"email\":\"$OWNER\",\"password\":\"$MANUAL_PASSWORD\"}" $API/auth/login | P 'd.data.accessToken')
echo "B-2 onboarding idle window: $(req GET '/auth/session?context=onboarding' | P 'd.data.session.idleTimeoutMinutes') min"
echo "B-3 confirm-name step: $(req GET /onboarding/application | P 'd.data.config.confirmClinicName')"
echo "B-4 practice (salesRep sent, Longevity): $(code PUT /onboarding/application/practice "{\"legalName\":\"Manual Longevity LLC\",\"practiceType\":\"LONGEVITY_MEDICAL\",\"locationCount\":1,\"addressLine1\":\"1 Manual Street\",\"city\":\"Austin\",\"state\":\"TX\",\"postalCode\":\"73301\",\"timezone\":\"America/Chicago\",\"primaryContactName\":\"Manual Owner\",\"primaryContactEmail\":\"$OWNER\",\"mailingSameAsPrimary\":true,\"noNpi\":false,\"groupNpi\":\"$NPI\",\"federalTaxId\":\"12-3456789\",\"estimatedSeats\":1,\"salesRep\":\"Old Field\"}")"
echo "B-5 Other with no name: $(code PUT /onboarding/application/practice "{\"legalName\":\"X LLC\",\"practiceType\":\"OTHER\",\"locationCount\":1,\"addressLine1\":\"1 X St\",\"city\":\"Austin\",\"state\":\"TX\",\"postalCode\":\"73301\",\"timezone\":\"America/Chicago\",\"primaryContactName\":\"M O\",\"primaryContactEmail\":\"$OWNER\",\"mailingSameAsPrimary\":true,\"noNpi\":true,\"federalTaxId\":\"12-3456789\",\"estimatedSeats\":1}")"
echo "B-6 bad ZIP: $(code PUT /onboarding/application/practice "{\"legalName\":\"X LLC\",\"practiceType\":\"LONGEVITY_MEDICAL\",\"locationCount\":1,\"addressLine1\":\"1 X St\",\"city\":\"Austin\",\"state\":\"TX\",\"postalCode\":\"7330\",\"timezone\":\"America/Chicago\",\"primaryContactName\":\"M O\",\"primaryContactEmail\":\"$OWNER\",\"mailingSameAsPrimary\":true,\"noNpi\":true,\"federalTaxId\":\"12-3456789\",\"estimatedSeats\":1}")"
echo "B-7 practitioners (owner sees patients): $(code PUT /onboarding/application/practitioners "{\"practitioners\":[{\"name\":\"Dr Manual Owner\",\"email\":\"$OWNER\",\"npi\":\"$NPI\",\"title\":\"Medical Director\",\"isOwner\":true,\"isSelf\":true,\"seesPatients\":true}]}")"
echo "B-8 NPI lookup (registry off): $(req GET "/onboarding/npi/$NPI?expect=2" | P 'd.data.verdict')"
echo "B-9 sign: $(req POST /onboarding/agreement "{\"acknowledgements\":{\"baa\":true,\"hipaa\":true,\"dataResidency\":true,\"refundPolicy\":true,\"authorizedSignatory\":true},\"communications\":true,\"signerName\":\"Manual Owner\",\"signerTitle\":\"Medical Director\",\"signature\":\"Manual Owner\"}" | P 'd.data.verificationStatus')"
echo "B-10 me: $(req GET /auth/me | P "'onboarded=' + Boolean(d.data.user.clinic.tenant.onboardingCompletedAt) + ' provider=' + (d.data.user.provider && d.data.user.provider.isActive)")"
echo "B-11 idle window after signing: $(req GET '/auth/session?context=onboarding' | P 'd.data.session.idleTimeoutMinutes') min"
echo "B-12 every plan includes AI Scribe: $(curl -s $API/tenants/plans | P "d.data.plans.every(p => p.highlights.some(h => /AI Scribe/.test(h)))")"
DISC=$(req POST /disciplines '{"name":"Longevity"}' | P 'd.data.discipline.id')
SVC=$(req POST /services "{\"disciplineId\":\"$DISC\",\"name\":\"Longevity consult\",\"duration\":30,\"defaultPrice\":0}" | P 'd.data.service.id')
PROV=$(req GET /auth/me | P 'd.data.user.provider.id')
echo "B-13 phone-only walk-in patient: $(req POST /patients '{"name":"Phone Only","phone":"+1 512 555 0100"}' | P "'email shown=' + d.data.patient.email + ' invite link=' + Boolean(d.data.inviteLink)")"
PAT=$(req POST /patients "{\"name\":\"Walk In\",\"email\":\"walkin.$RUN@example.test\"}" | P 'd.data.patient.id')
START=$(node -e "process.stdout.write(new Date(Date.now()+120000).toISOString())"); END=$(node -e "process.stdout.write(new Date(Date.now()+1920000).toISOString())")
echo "B-14 walk-in now: $(req POST /appointments "{\"providerId\":\"$PROV\",\"serviceId\":\"$SVC\",\"patientId\":\"$PAT\",\"startTime\":\"$START\",\"endTime\":\"$END\",\"bookingSource\":\"WALK_IN\"}" | P "d.data.appointment.bookingSource + ' ' + d.data.appointment.mode")"
echo "B-15 same slot again: $(code POST /appointments "{\"providerId\":\"$PROV\",\"serviceId\":\"$SVC\",\"patientId\":\"$PAT\",\"startTime\":\"$START\",\"endTime\":\"$END\",\"bookingSource\":\"PHONE\"}")"
PROD=$(req POST /products '{"name":"Magnesium Glycinate","price":24,"fulfillmentClass":"SUPPLEMENT"}' | P 'd.data.product.id')
echo "B-16 stock 10: $(req PUT /inventory/$PROD/adjust '{"quantityInStock":10}' | P 'd.data.inventoryItem.quantityInStock')   negative: $(code PUT /inventory/$PROD/adjust '{"quantityInStock":-1}')"
LOC=$(req GET /locations | P "d.data.locations.filter(l => !/online|virtual/i.test(l.name))[0].id")
echo "B-17 remove the only location: $(code DELETE /locations/$LOC)"
echo "B-18 default intake form twice: $(code POST /forms/templates/default) $(code POST /forms/templates/default)"
echo "B-19 notifications: $(req GET /notifications | P "'unread=' + d.data.unread")"
echo "B-20 site launch (no Cloudflare token): $(req GET /site/launch | P "JSON.stringify(d.data.launch ? d.data.launch.status : d.data)")"
cd $REPO && echo "B-21 $(node scripts/check-no-em-dash.js)"
```

**Expect** (recorded on 2026-11-13):

```
B-1 sign up: PENDING_REVIEW
B-2 onboarding idle window: 60 min
B-3 confirm-name step: false
B-4 practice (salesRep sent, Longevity): 200
B-5 Other with no name: 400
B-6 bad ZIP: 400
B-7 practitioners (owner sees patients): 200
B-8 NPI lookup (registry off): UNVERIFIED
B-9 sign: APPROVED
B-10 me: onboarded=true provider=true
B-11 idle window after signing: 15 min
B-12 every plan includes AI Scribe: true
B-13 phone-only walk-in patient: email shown=null invite link=false
B-14 walk-in now: WALK_IN IN_PERSON
B-15 same slot again: 409
B-16 stock 10: 10   negative: 400
B-17 remove the only location: 409
B-18 default intake form twice: 200 200
B-19 notifications: unread=0
B-20 site launch (no Cloudflare token): {"status":"NOT_CONFIGURED"}
B-21 No em dashes in 815 files.
```

What the less obvious results mean:

- **B-1 vs B-9:** the clinic is `PENDING_REVIEW` until it signs; auto review then approves it.
- **B-8:** with the registry off, the checksum alone is used and the answer is "could not verify". Set `NPI_REGISTRY_MODE=live` in the env file and restart terminal 1 to see a real NPPES answer (for this made-up NPI, `NOT_FOUND`).
- **B-13:** a phone-only patient is stored with a placeholder email that is never shown (D-3), so there's nothing to send an invite to.
- **B-14 and B-15:** walk-ins skip the online minimum notice, and the overlap constraint still applies.

### 9.5 Browser checks

Open the app with `open http://localhost:3010/get-started?plan=FREE`. Chrome is best (it asks for the microphone once; allow it). For the patient's side, use a private window: **⇧⌘N** in Chrome, **⇧⌘N** in Safari.

| #    | Do                                                                                                                                                                               | Expect                                                                                                                                                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1  | Sign up a new clinic: name, your email (any `@example.test`), the password from §9.2. Click the eye in the password field twice                                                  | The eye shows then hides the password and never submits the form (CTO-07). **Create my clinic** lands on "Tell us about your practice"                                                                                                        |
| F-2  | On the practice form, look for Sales rep, office manager and accounts payable. Open Practice type                                                                                | None of those three fields exist; a secondary contact does (CTO-04, CTO-17). **Longevity medical practice** is listed just before Other (CTO-06)                                                                                              |
| F-3  | Choose **Other**, type `longevitty`                                                                                                                                              | "Did you mean Longevity medical practice?" with **Use it** (CTO-18)                                                                                                                                                                           |
| F-4  | Click Team size and type `1`. Compare Team size and "How did you hear about us" side by side                                                                                     | The field shows **1**, not 11; the hint says 1 is fine (CTO-09). Both inputs sit on the same line; on a narrow window they stack (CTO-05)                                                                                                     |
| F-5  | State **TX**, ZIP `10001`; then ZIP `7330`                                                                                                                                       | `10001`: an amber warning that it's usually outside TX, but it can still be saved. `7330`: "Enter a 5-digit ZIP or ZIP+4" (CTO-22)                                                                                                            |
| F-6  | Fill the rest (NPI `1234567893`, tax ID `12-3456789`) and save. On Practitioners, look at row 0                                                                                  | Row 0 is you, with a **You** badge, **I see patients** ticked, and a **Title** select (no "Owner") (CTO-14, CTO-16). Save                                                                                                                     |
| F-7  | On the agreement, tick **I agree to all of the above**                                                                                                                           | All five acknowledgements tick; the communications box stays separate (CTO-08). The signer title is pre-filled. With `ONBOARDING_CONFIRM_NAME=off` there's no "retype the clinic name" dialog (CTO-10)                                        |
| F-8  | Sign and submit                                                                                                                                                                  | Straight to the dashboard; no brand or website step (CTO-25). No tour dialog. **Quick setup** is a small card you can collapse; reload and it stays collapsed. "Publish your website" says **Optional** (CTO-19, CTO-23)                      |
| F-9  | Look at the sidebar                                                                                                                                                              | **Commerce:** Services, Storefront, Packages, Memberships, Billing, Commissions. No Catalog. **Settings** last: Clinic profile, Locations & hours, Disciplines, Forms, Security. No Video Room, no provider Store (CTO-01 to CTO-03, CTO-20)  |
| F-10 | Storefront → **Add Product**: Magnesium Glycinate, $24, Supplement. Then **Adjust stock** → `10` → Save                                                                          | The card shows "10 in stock". Typing `-1` disables Save with "Enter a whole number, 0 or more" (CTO-23 step c)                                                                                                                                |
| F-11 | Disciplines → add "Longevity". Services → **Add Service**: Longevity consult, 30 min, $0, default visit type **In person**                                                       | The service is listed; as a solo practice you can offer it at once                                                                                                                                                                            |
| F-12 | Appointments → **New appointment** → **New patient** (name, `@example.test` email) → service, you as clinician → **Walk-in, now** → **Book appointment**                         | Booked, with a **Patient invite link** to copy (works without SMTP). Copy it (CTO-24)                                                                                                                                                         |
| F-13 | On the row, **Start scribe** → **The patient agreed** → speak for a few seconds → **Stop recording** → **Upload & transcribe**                                                   | Recording starts by itself after consent, with no video controls (in person). Within about 10 s the draft appears; the mock AI returns a synthetic visit, not your words (CTO-30, CTO-31)                                                     |
| F-14 | In the draft, look at **Detected products**                                                                                                                                      | "Key changes to approve" lists Magnesium Glycinate as a new product, approved. Tick **I confirm these products for this patient** → **Approve & send**. A checkout link is shown to share (CTO-33, CTO-32)                                    |
| F-15 | In a private window, open the invite link → set a password → open the checkout link → sign in as the patient → **Accept** Magnesium Glycinate → **Simulate Demo Payment**        | "Payment received". Back in the owner window, Storefront shows "8 in stock" (CTO-23 step d)                                                                                                                                                   |
| F-16 | (Optional, needs JaaS keys in the env file) Make a service **Video visit**, book it, start the call from both sides, then leave from one side and don't touch the other for 60 s | The joining patient's confirmation has the video link (CTO-31). The person left alone sees "Are you still there?" with a 30 s countdown; no answer ends the call and keeps the recording (CTO-35)                                             |
| F-17 | Clinic profile → **Brand** → upload a logo (PNG or SVG)                                                                                                                          | Two proposed colours with a preview. **Use these** saves them. Primary buttons, the active sidebar item and focus rings take the colour, and text on them stays readable (CTO-27, CTO-28)                                                     |
| F-18 | Locations & hours → **Add location** with another timezone → save; try to remove each location                                                                                   | The new location is listed with its timezone. You can remove one of the two, but not the last (CTO-34)                                                                                                                                        |
| F-19 | Forms → open **Patient intake** in the builder and find "Do you have any existing medical conditions?"                                                                           | It has a follow-up, "Which conditions?", with its options one per line and Other allowed; you can add one to any yes/no question the same way. A patient sees it only after answering **Yes** (covered by `intakeFollowUp.test.tsx`) (CTO-21) |
| F-20 | After F-12, stay on the Command Center for up to a minute (the walk-in starts within 10 minutes)                                                                                 | The bell gets a red dot, and a **Starting soon** card shows the visit with **Start scribe** (CTO-30). B-19 shows `unread=0` only because it runs before the minute job                                                                        |
| F-21 | (Optional, slow) Sign up another clinic and keep typing in the practice form for 20 minutes                                                                                      | You're not signed out (CTO-13). Reload mid-way: the form comes back without the tax ID                                                                                                                                                        |

### 9.6 Database checks

```zsh
Q() { docker exec mf-pg psql -U postgres -d mf_manual_cto -c "$1" }
Q "SELECT \"verificationStatus\", \"onboardingCompletedAt\" IS NOT NULL AS onboarded FROM \"Tenant\" ORDER BY \"createdAt\" DESC LIMIT 1;"
Q "SELECT c.name LIKE 'Manual Longevity%' AS clinic, count(p.id) AS providers, bool_and(p.\"isActive\") AS active FROM \"Provider\" p JOIN \"Clinic\" c ON c.id=p.\"clinicId\" GROUP BY c.id ORDER BY 1;"
Q "SELECT u.name, u.email LIKE '%@patients.invalid' AS placeholder, u.phone IS NOT NULL AS has_phone FROM \"User\" u WHERE u.role='PATIENT' ORDER BY u.\"createdAt\";"
Q "SELECT \"bookingSource\", mode, status FROM \"Appointment\" ORDER BY \"createdAt\";"
Q "SELECT name, count(*) FROM \"FormTemplate\" GROUP BY \"clinicId\", name;"
Q "SELECT \"salesRep\" IS NULL AS sales_rep_not_stored, \"practiceType\" FROM \"ClinicProfile\";"
```

| #   | Expect after §9.4 alone (the browser checks add rows of their own)                                              |
| --- | --------------------------------------------------------------------------------------------------------------- |
| D-1 | `APPROVED · t`                                                                                                  |
| D-2 | `t · 1 · t`: exactly one active Provider for the owner, even after saving the practitioners step again (CTO-14) |
| D-3 | `Phone Only · t · t` and `Walk In · f · f`: the placeholder is stored, never shown                              |
| D-4 | `WALK_IN · IN_PERSON · CONFIRMED` (CTO-24, CTO-31)                                                              |
| D-5 | `Patient intake · 1`: created at sign-up; the second "add default" call in B-18 didn't duplicate it (CTO-21)    |
| D-6 | `t · LONGEVITY_MEDICAL`: the sales rep sent in B-4 wasn't stored (CTO-04)                                       |

### 9.7 Clean up

Stop terminals 1 and 2 with **Ctrl+C**, then:

```zsh
cd ~/Work/AdvertOut/MedoFlow/backend
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS mf_manual_cto WITH (FORCE)"
docker rm -f mf-redis-manual
rm -f .env.cto-feedback.local
```

### 9.8 Result sheet

| Check                     | Pass / Fail | Notes |
| ------------------------- | ----------- | ----- |
| B-1 … B-21                |             |       |
| F-1 … F-15 (the CTO path) |             |       |
| F-16 (JaaS, optional)     |             |       |
| F-17 … F-21               |             |       |
| D-1 … D-6                 |             |       |
| §6 steps 1 to 5           |             |       |
