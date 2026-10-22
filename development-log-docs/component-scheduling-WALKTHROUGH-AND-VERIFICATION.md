# Component 1 — Scheduling: walkthrough and verification

**Date:** 2026-10-14 · **Branch:** `feat/c1-scheduling` (from `feat/f0-frontend-foundation` @ `711aec6`) · **Data:** synthetic only. The PHI gate stays closed.
**Plan reference:** `arh-agent-docs/development-plan.md` › Part B › Component 1 (B1.1–B1.4, F1.1–F1.3).

---

## 1. Outcome

| Task                                                          | AC (short)                                                                                                      | Status | Evidence                                                                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1.1** Exclusion constraint on `Appointment` overlap        | A direct overlapping INSERT for the same provider is rejected by the DB; the advisory lock stays as fast-fail   | ✅     | Migration `20261014000000_appointment_no_overlap`; `scheduling.int.test.ts` › B1.1 (6 tests); live smoke §4.6                                  |
| **B1.2** Hold → appointment conversion honours the constraint | A now-conflicting hold converts to a clean 409: no 500, no partial write                                        | ✅     | `scheduling.int.test.ts` › B1.2 (6 tests): the app-check path, the constraint-only path, expired hold, status re-activation, atomic reschedule |
| **B1.3** Set-based `getAvailableDatesInRange`                 | Bounded queries over the window; output matches the old code on a fixture; p95 improves (benchmark noted)       | ✅     | 5 queries for 7 or 90 days; identical to the pre-B1.3 code; **p95 6323 ms → 260 ms** (§4.3)                                                    |
| **B1.4** Booking-race test                                    | Two concurrent requests for one slot → one booking, the other 409                                               | ✅     | 2-way (existing) and 10-way HTTP races; 8 concurrent raw INSERTs with no app → DB admits exactly 1                                             |
| **F1.1** Deposit / slot-hold flow                             | e2e: pick → hold → prepay → confirm succeeds; an expired hold shows a clear "slot taken" recovery, not an error | ✅     | `frontend/e2e/booking.spec.ts` (4 tests)                                                                                                       |
| **F1.2** Waitlist + recurring UI                              | e2e: a patient joins a waitlist; staff create and cancel a recurring series                                     | ✅     | `frontend/e2e/waitlist-recurring.spec.ts` (2 tests). Both UIs existed as components but **were not wired to any page**; now they are           |
| **F1.3** Cancel / reschedule surfaces                         | The UI respects the cancellation policy; no PHI in any booking URL (verified)                                   | ✅     | `frontend/e2e/cancel-reschedule.spec.ts` (3 tests); every scheduling e2e asserts no patient detail in any URL                                  |

**Exit criteria (Universal Acceptance Standard, per task):**

| #   | Criterion                                                                | Status                                                                                                   |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | CI gate: typecheck, lint (0 warnings), full test suite, audit            | ✅ locally, the same commands as CI (§4.1). The PR still has to pass on GitHub                           |
| 2   | Tests prove the behaviour: happy path plus failure/edge cases, run in CI | ✅ 22 backend integration + 6 frontend unit + 9 browser e2e, all in existing CI jobs                     |
| 3   | No regressions; manual smoke                                             | ✅ all suites green (backend 128 unit / 106 integration, frontend 77 unit / 12 e2e); live API smoke §4.6 |
| 4   | Peer review                                                              | ⬜ **reviewer** (checklist in §7)                                                                        |
| 5   | HIPAA §2 per-change gate                                                 | ✅ answered in §7. Appointments are PHI. No new vendor and no new PHI path                               |
| 6   | Verified in a running environment, evidence attached                     | ✅ local evidence in §4. Attach it to the PR                                                             |
| 7   | No open defects; docs updated; no secrets; synthetic fixtures            | ✅ plan updated; fixture scan passes; no new dependencies                                                |

**Not done here (needs you):** apply the migration on Neon after the overlap pre-check (§6), then open the PR. Nothing is committed yet. The changes are in the working tree on `feat/c1-scheduling`.

---

## 2. Problems found and fixed

1. **Nothing at the database stopped double-booking.** Overlaps were prevented only by `pg_advisory_xact_lock` plus a `findFirst` check inside `createAppointment`. Seeds, scripts, manual SQL, and any future code path that skipped `createAppointment` could double-book a provider. **Fixed:** a btree_gist `EXCLUDE` constraint over `(providerId, tsrange(startTime, endTime, '[)'))` for live statuses, plus a `CHECK (endTime > startTime)`.
2. **Reschedule was not atomic, and the constraint would have broken it.** The new appointment was inserted first and the old one was marked `RESCHEDULED` afterwards, in a second transaction. With the constraint, moving a visit by 30 minutes (an overlap with its own old slot) would have failed. A crash between the two steps could also leave both appointments live. **Fixed:** the old row is superseded inside the booking transaction, guarded so that two concurrent reschedules cannot both succeed. A failed reschedule leaves the original untouched (tested).
3. **A refused write could surface as a 500 that echoed the DB error.** **Fixed:** an overlap-constraint violation now maps to `409 { code: 'conflict' }` in two places: in `createAppointment` and in the global error handler, which also covers status changes that re-activate a cancelled visit. A test asserts that the response body contains no `23P01` / `exclusion` / `tsrange` text.
4. **Audit row written for a status change that could fail.** `updateAppointmentStatus` logged the audit row _before_ the update. **Fixed:** the audit row is now written after the update succeeds (tested).
5. **`getAvailableDatesInRange` was N×M.** It ran 4 queries per provider per day: 360+ queries for a 90-day window, and 5.8 s at p50 on a busy calendar. **Fixed:** per-day slot computation is now one pure function, shared by `getAvailableSlots` and the range endpoint. The range endpoint loads everything in 5 queries.
6. **F1.2 was marked ✅ but was not reachable.** `WaitlistModal` and `RecurringConflictModal` were imported nowhere. There was no staff UI to book a series and no API to cancel one. **Fixed:** waitlist entry on fully booked dates; staff "New recurring series" and "Cancel series" buttons; new `POST /appointments/recurring/:seriesId/cancel`.
7. **Patients could not cancel or reschedule at all.** The booking review also hard-coded "cancel free up to 24h prior" whatever the clinic's policy was. **Fixed:** patient Reschedule/Cancel on `/account/appointments/[id]`. The service's real cancellation window and fee are shown on review, in the cancel dialog and on the staff sheet, and a late-cancellation fee is reported after cancelling.
8. **A taken slot looked like a failure.** The pages showed "Booking failed. Please try again." or "Failed to hold slot", and an expired prepay reservation was a dead end. **Fixed:** the user is sent back to the time picker with a calm notice and refreshed times (book page, in-nav modal, reschedule dialog). The payment page offers "Pick a new time".
9. **Accessibility:** the waitlist and conflict modals had no dialog role, and their labels were not linked to inputs. axe also flagged dialog description text at about 4.5:1 contrast (borderline), so it now uses a darker colour.
10. **A test wrote overlapping appointments.** `auditAndMonitoring.int.test.ts` inserted random multi-day appointments for one provider. The new constraint rejects them, so the test now uses distinct slots.

---

## 3. What was built (files)

### Backend

| File                                                                                                 | Change                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/migrations/20261014000000_appointment_no_overlap/migration.sql`                              | **New.** `btree_gist`; a pre-check that refuses to run over existing overlaps (with a clear message); the `Appointment_time_order` CHECK; the `Appointment_provider_no_overlap` EXCLUDE (statuses ≠ CANCELLED/RESCHEDULED, `[)` ranges so back-to-back slots are allowed) |
| `scripts/ops/find-appointment-overlaps.sql`                                                          | **New.** Read-only report of the rows that block the migration (IDs and times only)                                                                                                                                                                                       |
| `prisma/schema.prisma`                                                                               | Doc comment on `Appointment`: the constraint lives in the migration. `prisma migrate diff` shows no drift                                                                                                                                                                 |
| `src/utils/bookingConflict.ts`                                                                       | **New.** `isAppointmentOverlapError` (Prisma P2010 / unknown-request shapes) and `slotTakenError()` (409 `conflict`)                                                                                                                                                      |
| `src/middleware/errorHandler.ts`                                                                     | Maps overlap violations from any path to a clean 409                                                                                                                                                                                                                      |
| `src/services/appointmentService.ts`                                                                 | Constraint → 409 mapping; atomic reschedule (`rescheduleFromAppointmentId`); audit after the status write; `cancelRecurringSeries`; the appointment detail includes the service cancellation policy (not PHI)                                                             |
| `src/services/availabilityService.ts`                                                                | Pure `computeProviderDaySlots` + `loadBlockers` (3 set queries); `getAvailableSlots` and the set-based `getAvailableDatesInRange` both use them                                                                                                                           |
| `src/config/prisma.ts`                                                                               | `onPrismaOperation(listener)`: model + operation names only, never arguments. Used to count queries in tests                                                                                                                                                              |
| `src/routes/appointments.ts`, `controllers/appointmentController.ts`, `validation/module2Schemas.ts` | `POST /appointments/recurring/:seriesId/cancel` (SUPER_ADMIN, FRONT_DESK; clinic-scoped; Zod-validated; audited)                                                                                                                                                          |
| `src/tests/integration/scheduling.int.test.ts`                                                       | **New.** 22 tests (B1.1–B1.4, series cancel, policy on detail)                                                                                                                                                                                                            |
| `src/tests/integration/legacyAvailability.ts`                                                        | **New.** Verbatim pre-B1.3 code, used only as the reference in tests                                                                                                                                                                                                      |
| `src/tests/integration/availability.bench.int.test.ts`                                               | **New.** Opt-in benchmark (`SCHEDULING_BENCH=1`); skipped in CI                                                                                                                                                                                                           |
| `src/tests/integration/auditAndMonitoring.int.test.ts`                                               | Uses non-overlapping fixture slots                                                                                                                                                                                                                                        |

### Frontend

| File                                                                                     | Change                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/bookingErrors.ts`                                                                   | **New.** `isSlotUnavailableError` (409 / `expired_hold` / `invalid_slot`), `bookingErrorMessage`, `SLOT_TAKEN_MESSAGE`                                 |
| `lib/cancellationPolicy.ts`                                                              | **New.** `cancellationTerms` / `describeCancellationPolicy`, which mirror the backend fee rule                                                         |
| `components/appointments/CancelAppointmentDialog.tsx`                                    | **New.** States the policy before confirming; reports a late fee                                                                                       |
| `components/appointments/PatientAppointmentActions.tsx`                                  | **New.** Patient Reschedule/Cancel, shown only for upcoming live visits                                                                                |
| `components/appointments/RecurringSeriesDialog.tsx`                                      | **New.** Staff weekly-series booking from live availability; conflict review (keep the partial series or cancel it)                                    |
| `components/appointments/CancelSeriesDialog.tsx`                                         | **New.** Staff "cancel the whole series"                                                                                                               |
| `components/calendar/RescheduleDialog.tsx`                                               | Works for patient and staff appointments; in-place slot-taken recovery; passes the new appointment's id back                                           |
| `components/calendar/AppointmentSheet.tsx`                                               | Shared cancel dialog with policy; "Cancel series" for front desk/admin; no cancel for completed / no-show visits                                       |
| `components/booking/BookingModal.tsx`, `app/(public)/book/[serviceId]/page.tsx`          | Slot-taken recovery (keeps the chosen date); real policy text; waitlist entry on fully booked dates                                                    |
| `app/(public)/payment/[appointmentId]/page.tsx`                                          | An expired reservation offers "Pick a new time" (IDs-only link)                                                                                        |
| `app/(public)/account/appointments/[id]/page.tsx`                                        | Hosts `PatientAppointmentActions`                                                                                                                      |
| `app/dashboard/appointments/page.tsx`, `app/dashboard/provider/calendar/page.tsx`        | "New recurring series", "Weekly series" badge, "Cancel series"                                                                                         |
| `components/WaitlistModal.tsx`, `components/RecurringConflictModal.tsx`                  | Dialog roles, linked labels, clearer button text                                                                                                       |
| `lib/patientApi.ts`, `lib/recurringApi.ts`, `lib/types/booking.ts`                       | `getClinicPatients`, `cancelRecurringSeries`, policy and series fields                                                                                 |
| `e2e/schedulingMock.ts`                                                                  | **New.** A stateful scheduling API mock with knobs (`failNextBooking`, `stealOnHold`, `fullyBooked`, `seriesConflictWeeks`), plus the PHI-in-URL probe |
| `e2e/booking.spec.ts`, `e2e/waitlist-recurring.spec.ts`, `e2e/cancel-reschedule.spec.ts` | **New.** 9 browser tests, including axe scans of the new dialogs                                                                                       |
| `e2e/mockApi.ts`, `e2e/helpers.ts`                                                       | `role` / `signedIn` options; shared `expectNoSeriousA11yViolations` (waits for dialog animations)                                                      |
| `tests/unit/scheduling.test.ts`                                                          | **New.** 6 unit tests for the two helpers                                                                                                              |

Also: `.github/workflows/deploy.yml` (step labels only), `frontend/playwright.config.ts` (comment), and the plan statuses.

---

## 4. Verification: commands and results

All commands run from the repo root in **Git Bash**, not PowerShell (see §9 "Opening Git Bash on Windows 10"). They need Docker and pnpm (`corepack pnpm …` works if `pnpm` is not on PATH).

### 4.0 One-time local setup

```bash
docker run -d --name mf-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:18
docker exec mf-pg psql -U postgres -c "create database mf_it"
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it pnpm exec prisma migrate deploy
docker exec mf-pg psql -U postgres -c "ALTER ROLE medoflow_app WITH LOGIN PASSWORD 'app_local_pw'"
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it
```

### 4.1 Gate commands (what CI runs)

```bash
cd backend
pnpm run typecheck                          # → exit 0
pnpm run lint                               # → exit 0 (0 warnings)
node scripts/check-synthetic-fixtures.js    # → ✓ synthetic-fixture check passed (52 files scanned)
pnpm run test:coverage                      # → Test Files 14 passed · Tests 128 passed
pnpm run test:integration:coverage          # → Test Files 8 passed | 1 skipped · Tests 106 passed | 1 skipped
                                            #   (skipped = opt-in benchmark); lines 37.9 % ≥ 33 ratchet
node scripts/audit-backend.js               # → ✓ no unaccepted high/critical advisories

cd ../frontend
pnpm run typecheck                          # → exit 0
pnpm run lint                               # → ✔ No ESLint warnings or errors
pnpm run test:coverage                      # → Test Files 12 passed · Tests 77 passed; thresholds met
node scripts/audit-frontend.js              # → ✓ no unaccepted high/critical advisories
```

### 4.2 B1.1 / B1.2 / B1.4: constraint, hold conversion, races

```bash
cd backend
pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/scheduling.int.test.ts
# → Tests 22 passed
#   B1.1 constraint exists · direct INSERT rejected (starts inside / contains) · Prisma insert rejected
#        back-to-back + other provider + CANCELLED/RESCHEDULED allowed · end<start rejected (CHECK)
#        advisory lock still answers the app-level 409 first
#   B1.2 taken slot (app-visible) → 409, hold ACTIVE, no appointment/audit row
#        taken slot visible only to the constraint → 409 "just booked", body has no DB text
#        expired hold → 400 expired_hold · status re-activation into a taken slot → 409, no audit row
#        reschedule overlapping its own old slot works · reschedule into a taken slot → 409, original untouched
#   B1.4 10 concurrent bookings → 1×201, 9×409 · 8 concurrent raw INSERTs → exactly 1 succeeds
#   Series cancel → 4 cancelled + audit row · patient 403 · other clinic 404 · policy on detail
```

The stderr lines `ConnectorError … 23P01 … Appointment_provider_no_overlap` during this run are Prisma's own error log of the refused writes. They are expected. For the app role, Postgres hides the key detail ("Key conflicts with existing key.").

Check the constraint directly in SQL:

```bash
docker exec mf-pg psql -U postgres -d mf_it -Atc \
  "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='\"Appointment\"'::regclass and contype in ('c','x')"
# → Appointment_provider_no_overlap|EXCLUDE USING gist ("providerId" WITH =, tsrange("startTime", "endTime", '[)'::text) WITH &&) WHERE ((status <> ALL (ARRAY['CANCELLED'::"AppointmentStatus", 'RESCHEDULED'::"AppointmentStatus"])))
# → Appointment_time_order|CHECK (("endTime" > "startTime"))
```

The pre-check was demonstrated: on a DB that held one overlapping pair, `migrate deploy` stopped with `B1.1: 0 appointment(s) end before they start and 1 overlapping live appointment pair(s) exist. Resolve them (scripts/ops/find-appointment-overlaps.sql) and re-run the migration.` The demo seed (`seed_demo.ts`, 62 appointments) loads cleanly with the constraint in place.

### 4.3 B1.3: set-based availability

The `B1.3` block of `scheduling.int.test.ts` covers this. Its tests check:

- the output matches the pre-B1.3 code for all providers, each single provider, and with a location;
- day-by-day `getAvailableSlots` matches the old code;
- the query count is **≤ 5 and the same for 7 and 90 days**, where the old code needed more than 10× as many;
- the public summary endpoint returns the same answer;
- an inverted window returns `[]`.

The fixture has three providers in UTC, America/Los_Angeles and Asia/Kolkata. It includes buffer minutes, fully booked days, a block that crosses midnight, active and expired holds, and full-day and partial unavailability.

Benchmark (opt-in):

```bash
SCHEDULING_BENCH=1 pnpm exec vitest run --config vitest.integration.config.ts \
  src/tests/integration/availability.bench.int.test.ts
```

Result recorded 2026-10-14 (local Postgres 18 in Docker; 5 busy providers; 60-day window; 25 runs each; same output asserted first):

| Implementation | p50       | p95          |
| -------------- | --------- | ------------ |
| N×M (old)      | 5823.1 ms | 6323.2 ms    |
| set-based      | 202.2 ms  | **260.0 ms** |

### 4.4 Frontend unit + e2e (F1.1–F1.3)

```bash
cd frontend
pnpm exec vitest run tests/unit/scheduling.test.ts      # → 6 passed

# Linux/macOS/CI:
pnpm test:e2e                                           # → 12 passed
# Windows (Playwright cannot stop its own server there):
#   terminal 1: NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 pnpm exec next build && pnpm test:e2e:serve
#   terminal 2: E2E_EXTERNAL_SERVER=1 pnpm test:e2e
# First time on a machine: pnpm exec playwright install chromium
```

Expected (recorded):

```
✓ F1.1 pick → hold → prepay → confirm
✓ F1.1 an expired hold at confirm → "slot taken" recovery, then books another time
✓ F1.1 a slot taken between listing and holding recovers the same way
✓ F1.1 an expired prepay reservation offers "Pick a new time"
✓ F1.3 reschedule (with a slot-taken retry), then cancel free of charge
✓ F1.3 inside the cancellation window the fee is stated up front and reported
✓ F1.3 past and completed visits offer no reschedule or cancel
✓ idle: … (2)   ✓ MFA: … (1)            ← existing, unchanged
✓ F1.2 a patient joins the waitlist from a fully booked date
✓ F1.2 front desk books a weekly recurring series, then cancels it
12 passed
```

Stability: the 9 new specs passed **45/45** with `--repeat-each=5`.

**No PHI in booking URLs (F1.3):** every scheduling spec ends with `expectNoPhiInUrls`. It checks every URL the page requested or navigated to against the patient's full name, first name, last name, email, email local part and phone (raw, URL-encoded and `+`-encoded). The existing static guard (`tests/unit/staticGuards.test.ts`) still covers every route segment and query parameter in source.

### 4.5 What each flow looks like (summary; the full step-by-step guide is §9)

| Flow                      | Where                                                                                           | What you should see                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prepay booking            | `/book/<serviceId>?clinicId=<id>` as a patient                                                  | Provider → time → **Confirm** (hold) → review with the clinic's policy sentence → `/payment/<id>` countdown → Confirm → `/intake/<id>`                                                |
| Slot taken                | Same; let the 3-minute hold expire on the review screen, or have a second browser book the time | An amber notice "That time was just taken…" on the time picker, the taken time gone, other times bookable. No error toast                                                             |
| Expired prepay            | `/payment/<id>` after 10 minutes                                                                | "Your reservation expired…" and **Pick a new time**                                                                                                                                   |
| Waitlist                  | Book page with a clinician whose date is full                                                   | **Join the waitlist** → dialog → "You're on the waitlist…"                                                                                                                            |
| Recurring series          | `/dashboard/appointments` as front desk                                                         | **New recurring series** → patient / service / clinician / first visit / time / weekly visits → **Book series**. Rows show "Weekly series"; **Cancel series** cancels upcoming visits |
| Patient cancel/reschedule | `/account/appointments/<id>` (upcoming)                                                         | "Need to change this visit?" with the policy; **Reschedule** (dialog) and **Cancel appointment** (policy restated; a late fee is reported)                                            |

### 4.6 Live API smoke (real backend + seeded data, 2026-10-14)

The backend was started with `TENANT_ISOLATION_MODE=enforce` against a scratch DB that was migrated and seeded with `seed_demo.ts`.

| Check                                                 | Result                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /api/v1/health`                                  | `200 … "Medoflow API is operational"`                                                          |
| `GET /public/availability/summary` (30 days)          | `200`, 22 dates in **0.17 s**                                                                  |
| `POST /public/slots/hold`, then the same slot again   | `201` hold, then refused: "Selected slot is no longer available. Please choose another."       |
| Direct SQL INSERT duplicating a live demo appointment | `ERROR: conflicting key value violates exclusion constraint "Appointment_provider_no_overlap"` |

---

## 5. Design notes

- **Why both the lock and the constraint.** The advisory lock serialises bookings for one provider, so the application check answers first with a precise message (proved by a test). The constraint covers every writer that skips that path. Both return the same 409 `conflict`, so clients handle one case.
- **Live statuses** match `ACTIVE_APPOINTMENT_STATUSES`: everything except `CANCELLED` and `RESCHEDULED`. `COMPLETED` and `NO_SHOW` still block, as before. The constraint does not include the provider's buffer minutes. The buffer stays a booking-time rule in availability, as before.
- **Timestamps:** the columns are `timestamp(3)` (UTC by convention), so the constraint uses `tsrange`.
- **Set-based availability keeps the old semantics exactly.** That includes one existing quirk: unavailability blocks are built on the server's local clock (`setHours`). A test pins the equivalence. Changing the quirk is a separate decision (§8).

---

## 6. What you must do manually

1. **Before this reaches Render (the migration runs on deploy):** check Neon for rows that would block the migration. Run it read-only, as the owner role:

   ```bash
   psql "$NEON_OWNER_URL" -f backend/scripts/ops/find-appointment-overlaps.sql
   ```

   - **Zero rows:** deploy as normal.
   - **Any rows:** cancel or move one appointment of each pair, then deploy. Otherwise the migration stops with the B1.1 message, and Render keeps serving the previous version.
   - The `btree_gist` extension is trusted (PG13+), so the Neon owner role can create it without superuser.

2. Commit the changes and open the PR. Paste §4 output and §7 as evidence. Get peer review.
3. Optional: run the manual local testing guide (§9), or click through §4.5 on the deployed environment after the merge.

---

## 7. Review checklist and HIPAA §2 per-change gate

| Item                  | Answer                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness           | Constraint and app checks agree on live statuses. Reschedule is atomic. Range output equals the old output (tested)                                                  |
| AuthZ                 | Series cancel is SUPER_ADMIN/FRONT_DESK only (patient → 403, tested). Patient cancel/reschedule use the existing endpoints, scoped to the patient's own appointments |
| Tenant scoping        | Series lookup is `{ id, clinicId }` (another clinic → 404, tested). Range queries are clinic-scoped. The tenant guard is enforced in all tests                       |
| Audit                 | `RECURRING_SERIES_CANCELLED` plus one `APPOINTMENT_CANCELLED` per visit. Status-change audit is written only after success                                           |
| PHI in logs           | Error bodies never carry DB text (tested). Prisma's error log names provider IDs and times only. The app role cannot see key details                                 |
| PHI in URLs           | None. Every new link carries IDs only, verified by e2e on every flow                                                                                                 |
| Minimum necessary     | The detail adds only non-PHI policy fields. `GET /patients` returns id/name/email (existing)                                                                         |
| New vendor / PHI path | None. No new dependencies                                                                                                                                            |
| Fixtures              | Synthetic only (scan passes)                                                                                                                                         |

---

## 8. Known limits and open items

- **Rescheduling has no fee rule on the server** (only cancellation does). The UI says the current time is kept until the new one is confirmed. It does not invent a fee.
- **Waitlist from the in-nav modal** hands off to the full booking page, where the waitlist form lives. This avoids a modal inside a modal.
- **Staff calendar sheet** no longer offers Cancel on `COMPLETED` / `NO_SHOW` visits. The server still allows it (unchanged), for example by an admin via the API.
- **Unavailability uses the server's local clock.** This is pre-existing and preserved for equivalence. Moving it to the location timezone should be a separate, tested change.
- **Slot holds** still use their own advisory-lock key. Two holds for one slot are serialised per provider. A hold and a booking racing each other are caught by the active-hold check and, for appointments, by the constraint.

---

## 9. Manual local testing guide

A hands-on script for checking every Component 1 function yourself, on your machine, with real demo data. Part A sets up the stack. Part B tests the backend directly with `curl` (no browser). Part C tests the frontend by clicking through it. Tick the checklist in Part D as you go.

The backend steps in Part B were dry-run on 2026-10-16 against a freshly seeded database. The "Expect" lines show the real output from that run.

**Time needed:** about 15 minutes for setup, 20 for Part B and 40 for Part C.
**Shell:** Git Bash from the repo root. Use `corepack pnpm` wherever `pnpm` is not on PATH.
**Clock note:** the demo clinic's opening hours are defined in `America/Los_Angeles`, and the API returns UTC. Every screen shows appointment times in **one display time zone**, the same on all screens. By default that is your computer's zone; set `NEXT_PUBLIC_DISPLAY_TIMEZONE` in the frontend env (e.g. `America/Los_Angeles`) to pin it. The date picker still means the clinic's calendar day. From India, a clinic day runs from the evening into the next morning, so slots after midnight show their date, e.g. `1:30 AM · Tue, Oct 27`.

> ⚠️ **Run every terminal command in Git Bash, not PowerShell or Command Prompt.**
> The commands use bash syntax: `VAR=value command`, `\` line breaks, shell functions, `$(…)`, `&`/`wait` and `2>/dev/null`. Windows PowerShell 5.1 and `cmd.exe` reject or misread them. The browser steps in Part C don't depend on the shell.

**Opening Git Bash on Windows 10** (it comes with [Git for Windows](https://git-scm.com/download/win); install it with the defaults if `git --version` fails):

- **From File Explorer:** open the `MedoFlow` folder, right-click an empty area and choose **Open Git Bash here**. On Windows 11 it is under **Show more options**.
- **From VS Code:** open the integrated terminal (Ctrl+\`), click the **▾** next to **+**, and pick **Git Bash**. To make it the default, open the Command Palette, run **Terminal: Select Default Profile**, and choose **Git Bash**.
- **From the Start menu:** search for **Git Bash**, then go to the repo: `cd /e/advertout/MedoFlow`. In Git Bash, drive `E:\` is written `/e/` and paths use forward slashes.

**Check you are in the right shell and the tools are there:**

```bash
echo $SHELL           # → /usr/bin/bash   (in PowerShell this prints nothing or errors)
pwd                   # → /e/advertout/MedoFlow
docker --version      # Docker Desktop must be running
node --version        # v20 or later
corepack pnpm --version
```

You need **three Git Bash windows or tabs**: terminal 1 for the backend (A-2), terminal 2 for the frontend (A-3), and terminal 3 for the helpers and Part B (A-5). The helpers from A-5 exist only in the terminal where you pasted them, so paste A-5 again in any new terminal.

**Pasting into Git Bash:** paste with **Shift+Insert** or right-click → **Paste** (Ctrl+V doesn't paste in the standalone Git Bash window; it does in the VS Code terminal). Paste a whole code block at once; multi-line blocks run as written.

### Part A — Set up the stack

> **One database name, used everywhere.** Every block below reads the database name from the variable `DB`. The default is `mf_manual`, a throwaway copy that leaves your normal dev data alone. To test against another database that already has the demo seed (for example your `medoflow` dev DB), set `DB` to that name **in every terminal** before running anything else, and skip the drop/create/seed lines in A-1:
>
> ```bash
> export DB=medoflow     # only if you are NOT using the default mf_manual
> ```
>
> If A-2, A-5 and Part B disagree about `DB`, the backend and your checks look at different databases. The IDs in A-5 then come out empty, and B-4 fails with `HTTP 400 · Valid ISO datetime is required`. A-5 now stops early with a clear message instead.

**A-1. Database: a dedicated, seeded copy** (this does not touch your normal dev DB):

```bash
export DB=${DB:-mf_manual}
docker start mf-pg 2>/dev/null || docker run -d --name mf-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:18
docker exec mf-pg psql -U postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB corepack pnpm exec prisma migrate deploy
docker exec mf-pg psql -U postgres -c "ALTER ROLE medoflow_app WITH LOGIN PASSWORD 'app_local_pw'"
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB corepack pnpm exec ts-node prisma/seed_demo.ts
```

Expect: `All migrations have been successfully applied.`, then the seed's persona table at the end.

Using an existing database instead? Run only the `export DB=…`, `migrate deploy` and `ALTER ROLE` lines. The drop/create line would **erase** that database.

**A-2. Backend** (terminal 1, port 4302). The inline variables override `backend/.env` for this run only. The app connects as the non-owner role, so row-level security is live, as in production:

```bash
export DB=${DB:-mf_manual}
cd /e/advertout/MedoFlow/backend     # absolute, uppercase drive — see the Windows note in A-3
PORT=4302 \
DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/$DB \
MIGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB \
AUDIT_PURGE_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB \
REDIS_URL= \
corepack pnpm run dev
```

Expect: `[db] connected as "medoflow_app" — row-level security is enforced`. If port 4302 is taken, stop whatever is using it, or use another port everywhere below.

**A-3. Frontend** (terminal 2, port 3000):

```bash
cd /e/advertout/MedoFlow/frontend    # absolute path: Git Bash maps /e to E:\ (uppercase)
NEXT_PUBLIC_API_URL=http://localhost:4302 corepack pnpm dev
```

> **Windows: start `next dev` from an uppercase-drive path.** If the terminal's working directory is `e:\…` (lowercase drive), webpack bundles Next's router twice and every page fails with `invariant expected app router to be mounted`. This happens with VS Code terminals when the workspace was opened as `e:\advertout\MedoFlow`. The absolute `cd /e/advertout/MedoFlow/frontend` above avoids it. If you already hit the error, see Part F.

Open <http://localhost:3000>. `backend/.env` already allows `http://localhost:3000` (CORS).

**A-4. Demo logins.** Every password is `Demo1234!`.

| Persona                  | Email                                  | Use it for                             |
| ------------------------ | -------------------------------------- | -------------------------------------- |
| Patient (main)           | `emma@everwell.demo`                   | Booking, waitlist, reschedule, cancel  |
| Patient (second browser) | `liam@everwell.demo`                   | "Someone else took the slot" tests     |
| Front desk               | `jordan@everwell.demo`                 | Recurring series, staff cancel         |
| Super admin              | `alex@everwell.demo`                   | Status changes                         |
| Provider                 | `sarah@everwell.demo` (Dr. Sarah Chen) | Works Mon–Fri, 08:00–17:00 clinic time |

Sign in at <http://localhost:3000/?auth=login>. Staff accounts have no MFA enrolled in the seed.

**A-5. Shell helpers + IDs** (terminal 3). Paste the whole block. You can re-paste it in any new terminal:

```bash
unalias node 2>/dev/null || true    # Git Bash may wrap node in winpty, which breaks piped output
export DB=${DB:-mf_manual}          # must match the DB the backend in A-2 uses
export API=http://localhost:4302/api/v1
export PGQ="docker exec -i mf-pg psql -U postgres -d $DB -At"
# api METHOD PATH [TOKEN] [JSON] → prints the body, then "HTTP <status>"
api() {
  local a=(-s -X "$1" -H 'x-medoflow-client: web' -H 'content-type: application/json')
  [ -n "$3" ] && a+=(-H "authorization: Bearer $3")
  [ -n "$4" ] && a+=(--data "$4")
  curl "${a[@]}" -w '\nHTTP %{http_code}\n' "$API$2"
}
# … | val 'JS expression over d (the JSON body)'
val() { command node -e 'const L=require("fs").readFileSync(0,"utf8").trim().split("\n");L.pop();const d=JSON.parse(L.join("\n"));console.log(eval(process.argv[1]))' "$1"; }
# … | brief → "HTTP <status> · <code> · <message>" (hides the dev-mode stack trace)
brief() { command node -e 'const L=require("fs").readFileSync(0,"utf8").trim().split("\n");const s=L.pop();let d={};try{d=JSON.parse(L.join("\n"))}catch{};console.log([s,d.code,d.message].filter(Boolean).join(" · "))'; }
login() { api POST /auth/login "" "{\"email\":\"$1\",\"password\":\"Demo1234!\"}" | val 'd.data.accessToken'; }

CLINIC=$($PGQ -c "select id from \"Clinic\" where name='Everwell Longevity Clinic'")
SVC=$($PGQ -c "select id from \"Service\" where name='Initial Physiotherapy Assessment' and \"clinicId\"='$CLINIC'")   # 60 min
PROV=$($PGQ -c "select p.id from \"Provider\" p join \"User\" u on u.id=p.\"userId\" where u.email='sarah@everwell.demo'")
LOC=$($PGQ -c "select id from \"Location\" where \"clinicId\"='$CLINIC' order by \"createdAt\" limit 1")
EMMA_ID=$($PGQ -c "select id from \"User\" where email='emma@everwell.demo'")
LIAM_ID=$($PGQ -c "select id from \"User\" where email='liam@everwell.demo'")
SOPH_ID=$($PGQ -c "select id from \"User\" where email='sophia@everwell.demo'")
# A weekday at least 4 days out (outside a 24h cancellation window)
D=$(node -e 'let d=new Date();d.setDate(d.getDate()+4);while([0,6].includes(d.getDay()))d.setDate(d.getDate()+1);console.log(d.toISOString().slice(0,10))')
EMMA=$(login emma@everwell.demo); DESK=$(login jordan@everwell.demo); ADMIN=$(login alex@everwell.demo)
book() { api POST /appointments "$1" "{\"providerId\":\"$PROV\",\"serviceId\":\"$SVC\",\"locationId\":\"$LOC\"${4:+,\"patientId\":\"$4\"},\"startTime\":\"$2\",\"endTime\":\"$3\"}"; }
# Stop here if anything is missing: wrong DB name, unseeded DB, or backend not running
for v in CLINIC SVC PROV LOC EMMA_ID LIAM_ID SOPH_ID; do [ -n "${!v}" ] || echo "❌ $v is empty — is DB=$DB the seeded database the backend uses?"; done
for v in EMMA DESK ADMIN; do [ "${!v}" != "undefined" ] && [ -n "${!v}" ] || echo "❌ login for $v failed — is the backend from A-2 running on $API?"; done
echo "DB=$DB CLINIC=$CLINIC SVC=$SVC PROV=$PROV D=$D token=${EMMA:0:10}…"
echo "Booking page:  http://localhost:3000/book/$SVC?clinicId=$CLINIC&providerId=$PROV"
```

Expect: **no `❌` lines**, then the database name, four ids, a date, a token prefix such as `eyJhbGciOi…`, and the booking-page URL that Part C uses. If you see a `❌`, fix the cause it names and paste the block again; Part B will not work until it is clean.

Access tokens expire. If a step later returns `401`, re-run the line that sets `EMMA=… DESK=… ADMIN=…`.

### Part B — Backend checks (API + database)

Run each block in terminal 3, in order. Later steps reuse variables from earlier ones.

**B-1. Health**

```bash
api GET /health | brief
```

Expect: `HTTP 200 · Medoflow API is operational`

**B-2. Slots for one day (set-based availability engine)**

```bash
SLOTS=$(api GET "/public/availability?clinicId=$CLINIC&serviceId=$SVC&providerId=$PROV&date=$D")
echo "$SLOTS" | val 'd.data.slots.length+" slots, first "+d.data.slots[0].start+" … last "+d.data.slots.at(-1).start'
S1=$(echo "$SLOTS" | val 'd.data.slots[0].start'); E1=$(echo "$SLOTS" | val 'd.data.slots[0].end')
S2=$(echo "$SLOTS" | val 'd.data.slots[4].start'); E2=$(echo "$SLOTS" | val 'd.data.slots[4].end')
S3=$(echo "$SLOTS" | val 'd.data.slots[8].start'); E3=$(echo "$SLOTS" | val 'd.data.slots[8].end')
echo "S1=$S1 E1=$E1"
```

Expect: `17 slots, first <D>T15:00:00.000Z … last <D>T23:00:00.000Z`. That is 08:00–16:00 Los Angeles, every 30 minutes, each one hour long. The last line shows `S1` and `E1` as ISO times. If it shows `undefined` or nothing, or the first line errors, B-4 onwards will fail with `Valid ISO datetime is required`. In that case, go back to A-5 and clear its `❌` lines. Many slots may already be taken, for example after a second run on the same database. Fewer than 9 slots means `S3` is empty: pick a later `D` and re-run B-2, e.g. `D=$(node -e 'let d=new Date();d.setDate(d.getDate()+11);while([0,6].includes(d.getDay()))d.setDate(d.getDate()+1);console.log(d.toISOString().slice(0,10))')`.

**B-3. Which dates have availability, 30-day window (B1.3)**

```bash
SD=$(node -e 'console.log(new Date(Date.now()+864e5).toISOString().slice(0,10))'); ED=$(node -e 'console.log(new Date(Date.now()+30*864e5).toISOString().slice(0,10))')
curl -s -w "\nHTTP %{http_code} in %{time_total}s\n" "$API/public/availability/summary?clinicId=$CLINIC&serviceId=$SVC&startDate=$SD&endDate=$ED" | tail -c 200
```

Expect: `HTTP 200` in well under a second (dry run: 0.18 s). Only weekdays appear in `availableDates`.

**B-4. Slot hold, then a second hold on the same slot (B1.2)**

```bash
HOLD='{"clinicId":"'$CLINIC'","providerId":"'$PROV'","serviceId":"'$SVC'","locationId":"'$LOC'","timezone":"America/Los_Angeles","startTime":"'$S1'","endTime":"'$E1'"}'
R=$(api POST /public/slots/hold "" "$HOLD"); echo "$R" | brief; HOLD_ID=$(echo "$R" | val 'd.data.hold.id')
api POST /public/slots/hold "" "$HOLD" | brief
```

Expect: `HTTP 201 · Slot hold created`, then `HTTP 409 · invalid_slot · Selected slot is no longer available. Please choose another.`

**B-5. Book with the hold (patient)**

```bash
R=$(api POST /appointments "$EMMA" '{"providerId":"'$PROV'","serviceId":"'$SVC'","locationId":"'$LOC'","startTime":"'$S1'","endTime":"'$E1'","slotHoldId":"'$HOLD_ID'"}')
echo "$R" | brief; A1=$(echo "$R" | val 'd.data.appointment.id'); echo "$R" | val 'd.data.appointment.status'
```

Expect: `HTTP 201 · Appointment created` and `CONFIRMED`.

**B-6. Double-booking the same slot is refused**

```bash
book "$DESK" $S1 $E1 $LIAM_ID | brief
```

Expect: `HTTP 409 · conflict · Provider has a conflicting appointment in this time slot`

**B-7. Race: two bookings for one slot at the same moment (B1.4)**

```bash
( book "$DESK" $S2 $E2 $LIAM_ID | brief ) & ( book "$DESK" $S2 $E2 $SOPH_ID | brief ) & wait
```

Expect: exactly one `HTTP 201 · Appointment created` and one `HTTP 409 · conflict · …`, in either order.

**B-8. The database itself refuses overlaps (B1.1).** Both statements run inside `BEGIN … ROLLBACK`, so they leave no data behind:

```bash
# Overlapping (starts 15 min into A1): must fail
$PGQ -c "BEGIN; INSERT INTO \"Appointment\" (id,\"clinicId\",\"providerId\",\"serviceId\",\"patientId\",\"startTime\",\"endTime\",\"priceAtBooking\",\"updatedAt\") SELECT 'manual-overlap',\"clinicId\",\"providerId\",\"serviceId\",\"patientId\",\"startTime\"+interval '15 minutes',\"endTime\"+interval '15 minutes',1,now() FROM \"Appointment\" WHERE id='$A1'; ROLLBACK;"
# Back-to-back (starts exactly when A1 ends): must succeed
$PGQ -c "BEGIN; INSERT INTO \"Appointment\" (id,\"clinicId\",\"providerId\",\"serviceId\",\"patientId\",\"startTime\",\"endTime\",\"priceAtBooking\",\"updatedAt\") SELECT 'manual-adjacent',\"clinicId\",\"providerId\",\"serviceId\",\"patientId\",\"endTime\",\"endTime\"+interval '30 minutes',1,now() FROM \"Appointment\" WHERE id='$A1'; ROLLBACK;"
```

Expect: first `ERROR: conflicting key value violates exclusion constraint "Appointment_provider_no_overlap"`, then `INSERT 0 1`.

**B-9. An expired hold gets a clear, recoverable error**

```bash
H3=$(api POST /public/slots/hold "" "$(echo "$HOLD" | sed "s/$S1/$S3/;s/$E1/$E3/")" | val 'd.data.hold.id')
$PGQ -c "update \"SlotHold\" set \"expiresAt\"=now()-interval '1 minute' where id='$H3'"
api POST /appointments "$EMMA" '{"providerId":"'$PROV'","serviceId":"'$SVC'","locationId":"'$LOC'","startTime":"'$S3'","endTime":"'$E3'","slotHoldId":"'$H3'"}' | brief
```

Expect: `HTTP 400 · expired_hold · Slot hold expired or invalid. Please select the slot again.`

**B-10. Re-activating a cancelled visit into a taken slot → clean 409, no audit row (B1.2)**

```bash
api POST /appointments/$A1/cancel "$EMMA" '{"reason":"manual test"}' | brief      # emma frees the slot
book "$DESK" $S1 $E1 $LIAM_ID | brief                                             # liam takes it
api PUT /appointments/$A1/status "$ADMIN" '{"status":"CONFIRMED"}' | brief        # try to revive emma's
$PGQ -c "select status, (select count(*) from \"AuditLog\" where \"entityId\"='$A1' and action='UPDATE' and \"fieldChanged\"='status') from \"Appointment\" where id='$A1'"
```

Expect, in order:

1. `HTTP 200 · Appointment cancelled`
2. `HTTP 201 · Appointment created`
3. `HTTP 409 · conflict · This time slot was just booked by someone else. Please choose another time.` (the message from the database-constraint path, with no DB error text)
4. `CANCELLED|0`

**B-11. Reschedule into a time overlapping the visit's own old slot (atomic reschedule)**

```bash
R=$(book "$EMMA" ${D}T20:00:00.000Z ${D}T21:00:00.000Z); echo "$R" | brief; A2=$(echo "$R" | val 'd.data.appointment.id')
api POST /appointments/$A2/reschedule "$EMMA" '{"newStartTime":"'${D}T20:30:00.000Z'","newEndTime":"'${D}T21:30:00.000Z'"}' | brief
$PGQ -c "select status, \"rescheduledToId\" is not null from \"Appointment\" where id='$A2'"
A3=$($PGQ -c "select \"rescheduledToId\" from \"Appointment\" where id='$A2'")
```

Expect: `HTTP 201`, then `HTTP 200 · Appointment rescheduled`, then `RESCHEDULED|t`.

**B-12. Cancellation policy on the detail, and the late-cancellation fee**

```bash
# A 30-day window with a $25 fee makes any visit "late"
$PGQ -c "update \"Service\" set \"cancellationWindowHours\"=720, \"cancellationFeeType\"='FIXED', \"cancellationFeeValue\"=25 where id='$SVC'"
api GET /appointments/$A3 "$EMMA" | val 'JSON.stringify(d.data.appointment.service)'
api POST /appointments/$A3/cancel "$EMMA" '{"reason":"late test"}' | val '"lateCancellation="+d.data.lateCancellation+" fee="+JSON.stringify(d.data.cancellationFee)'
```

Expect: the service JSON includes `"cancellationWindowHours":720,"cancellationFeeType":"FIXED","cancellationFeeValue":"25"`, then `lateCancellation=true fee={"type":"FIXED","value":"25","amount":"25"}`.

**B-13. Recurring series: create, refused for patients, cancelled by staff**

```bash
W=$(node -e 'let d=new Date();d.setDate(d.getDate()+8);while(d.getDay()!==3)d.setDate(d.getDate()+1);console.log(d.toISOString().slice(0,10))')   # a Wednesday
R=$(api POST /appointments/recurring "$DESK" '{"providerId":"'$PROV'","serviceId":"'$SVC'","locationId":"'$LOC'","patientId":"'$EMMA_ID'","startTime":"'${W}T18:00:00.000Z'","endTime":"'${W}T19:00:00.000Z'","frequency":"WEEKLY","numberOfSessions":4}')
echo "$R" | val '"appointments="+d.data.appointments.length+" conflicts="+d.data.conflicts.length'; SERIES=$(echo "$R" | val 'd.data.appointments[0].recurringSeriesId')
api POST /appointments/recurring/$SERIES/cancel "$EMMA" '{}' | brief
api POST /appointments/recurring/$SERIES/cancel "$DESK" '{"reason":"manual test"}' | val '"cancelled "+d.data.cancelledAppointmentIds.length'
$PGQ -c "select count(*) from \"AuditLog\" where \"entityId\"='$SERIES' and action='RECURRING_SERIES_CANCELLED'"
```

Expect: `appointments=4 conflicts=0`, then `HTTP 403 · Insufficient permissions` for the patient, then `cancelled 4`, then `1`.

**B-14. Prepaid booking + payment confirm**

```bash
$PGQ -c "update \"Service\" set \"requirePrepayment\"=true where id='$SVC'"
R=$(book "$EMMA" ${D}T22:00:00.000Z ${D}T23:00:00.000Z); A4=$(echo "$R" | val 'd.data.appointment.id')
echo "$R" | val '"status="+d.data.appointment.status+" clientSecret="+(d.data.clientSecret?"present":"none")'
api POST /payments/$A4/demo-confirm "$EMMA" | brief
$PGQ -c "select status, \"paymentStatus\" from \"Appointment\" where id='$A4'"
```

Expect: `status=PENDING_PAYMENT clientSecret=none`, then `HTTP 200 · Demo Payment confirmed`, then `CONFIRMED|PAID`. `clientSecret` is `none` because local runs have no Stripe key. With `STRIPE_SECRET_KEY` set to a test key it is `present`.

**B-15. Automated backend proof (optional, same as CI):** §4.1 and §4.2.

**Reset before Part C** (makes the service free again with a 24-hour policy, and keeps B's bookings out of the way):

```bash
$PGQ -c "update \"Service\" set \"requirePrepayment\"=false, \"cancellationWindowHours\"=24, \"cancellationFeeType\"='FIXED', \"cancellationFeeValue\"=25 where id='$SVC'"
```

### Part C — Frontend checks (browser)

Use **Browser A** (normal window) for Emma and **Browser B** (incognito or another browser) for Liam or Jordan. Keep DevTools open in Browser A, on the **Network** tab with **Preserve log** on, for C-14.

**C-1. Book a free visit (booking page)**

1. In Browser A, sign in as `emma@everwell.demo` at <http://localhost:3000/?auth=login>.
2. Open the booking page URL printed in A-5 and click **Sarah Chen**.
3. Pick a weekday 3 or more days out. Click a time, then the **Confirm** button that appears next to it. Note the time you clicked; C-7 and C-8 must show the same clock time for the same slot.
4. On **Review & Confirm**, read the grey policy box.
   - Expect: "Free cancellation until <date/time>. After that, a $25.00 fee applies."
5. Click **Confirm visit · $150**.
   - Expect: "You're booked, Emma." with the visit details and **Add to calendar**.

**C-2. Slot taken while you were on Review**

1. Browser A: repeat C-1 steps 2–3 for a new time and stop on **Review & Confirm**.
2. Terminal: expire Emma's hold, as if the 3-minute reservation ran out:
   ```bash
   $PGQ -c "update \"SlotHold\" set \"expiresAt\"=now()-interval '1 minute' where status='ACTIVE'"
   ```
3. Browser B: sign in as `liam@everwell.demo`, open the same booking URL, and book **that same time** (it is offered again now).
4. Browser A: click **Confirm visit**.
   - Expect: you are back on the time picker, with an amber box: "That time was just taken. Please pick another — the times shown are still open."
   - Expect: that time is no longer listed, and there is **no** red "Booking failed" toast.
5. Pick another time, then Confirm → Confirm visit.
   - Expect: "You're booked".

**C-3. Slot taken between choosing and confirming the time**

1. Browser A: on the time list, click a time **once**, so it turns grey and **Confirm** appears. Don't press Confirm yet.
2. Browser B (Liam): book that same time.
3. Browser A: press **Confirm**.
   - Expect: the same amber notice, and the time disappears from the list.

**C-4. Prepaid booking → payment → confirmed**

1. Terminal: `$PGQ -c "update \"Service\" set \"requirePrepayment\"=true where id='$SVC'"`
2. Browser A: book a new time as in C-1.
   - Without Stripe keys you land on "You're booked" (no payment page is opened). This is expected locally; see B-14.
   - With Stripe test keys set (`STRIPE_SECRET_KEY` in the backend, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in the frontend), you go straight to `/payment/<id>`.
3. Without keys, open the payment page yourself:

   ```bash
   echo "http://localhost:3000/payment/$($PGQ -c "select id from \"Appointment\" where \"patientId\"='$EMMA_ID' and status='PENDING_PAYMENT' order by \"createdAt\" desc limit 1")"
   ```

   - Expect: "Complete your booking", the amount, and a **Time remaining to confirm** countdown of about 10:00.

4. Click **Demo: Simulate Payment**.
   - Expect: you are taken to `/intake/<id>`, and in **Account → Appointments** the visit shows as confirmed.

**C-5. Expired prepaid reservation → "Pick a new time"**

1. Book another prepaid time (C-4 step 2) and open its `/payment/<id>` page.
2. Terminal: `$PGQ -c "update \"Appointment\" set \"bookingHoldExpiresAt\"=now()-interval '1 minute' where status='PENDING_PAYMENT'"`
3. Reload the payment page.
   - Expect: "Your reservation expired and the time was released.", a **Pick a new time** button, and disabled payment buttons.
4. Click **Pick a new time**.
   - Expect: the booking page for the same service. The URL holds only ids.
5. Terminal: `$PGQ -c "update \"Service\" set \"requirePrepayment\"=false where id='$SVC'"` (back to free for the rest of Part C).

**C-6. Waitlist on a fully booked day**

1. Browser A: open the booking page URL, click **Sarah Chen**, and pick a **Sunday** (Dr. Chen doesn't work Sundays).
   - Expect: "No availability" and a **Join the waitlist** button.
2. Click it. The **Join waitlist** dialog opens with the date pre-filled. Set the start time to `08:00` and the end time to `12:00`, then click **Join waitlist**.
   - Expect: the toast "You're on the waitlist. We'll email you if a time opens up." and the dialog closes.
3. Terminal: `$PGQ -c "select status, \"preferredDate\"::date, \"preferredStartTime\", \"preferredEndTime\" from \"WaitlistEntry\" order by \"createdAt\" desc limit 1"`
   - Expect: `WAITING|<that Sunday>|08:00|12:00`
4. Variant: choose **Any Available Provider** instead.
   - Expect: "Choose a specific clinician to join their waitlist." and no button.

**C-7. In-nav booking modal (same behaviour, different screen)**

1. Browser A: click **Book appointment** in the top navigation. Choose **Initial Physiotherapy Assessment**, then **Dr. Sarah Chen**, a date and a time.
   - Expect: the slot buttons show the **same clock times** as the booking page in C-1 for the same day. Below them is "times shown in <your zone name>", e.g. "India Standard Time".
   - Expect: the Review step shows the time range in that zone, the row "<your zone name> (your time)", and the policy sentence instead of a fixed "24h" line.
2. On Review, run the C-2 step 2 SQL (expire holds), have Browser B book that time, then click **Confirm booking**.
   - Expect: the modal returns to the Schedule step with the amber notice, on the **same date** you had picked.
3. Pick a Sunday.
   - Expect: "Fully booked" and **Join the waitlist for Dr. Chen**, which closes the modal and opens the booking page (where the waitlist form is).

**C-8. Patient reschedule**

1. Browser A: go to **Account → Appointments** (<http://localhost:3000/account/appointments>) and click **View** on an upcoming visit from C-1.
   - Expect, in the right column: "Need to change this visit?" with "Free cancellation until … After that, a $25.00 fee applies.", plus **Reschedule** and **Cancel appointment**.
2. Click **Reschedule**. The dialog says "Currently <time>. Your current time is kept until the new one is confirmed." Pick a time and click **Reschedule**.
   - Expect: the toast "Appointment rescheduled", the URL changes to the **new** appointment id, and the page shows the new time.
3. Go back to the list.
   - Expect: the old visit shows as _Rescheduled_.
4. Slot-taken variant: open Reschedule again and click a time (it is now held for you). Then in the terminal run the C-2 expire SQL, have Browser B (Liam) book that time, and click **Reschedule** in Browser A.
   - Expect: an amber "That time was just taken…" inside the dialog, with the time removed. Your original visit is unchanged.

**C-9. Patient cancel — free, then late**

1. On an upcoming visit 4 or more days away, click **Cancel appointment**.
   - Expect: the dialog shows the grey "Free cancellation until …" box and an optional **Reason** field.
2. Click **Cancel appointment** in the dialog.
   - Expect: the toast "Appointment cancelled", the status becomes Cancelled, and the Reschedule/Cancel panel disappears.
3. Late case. Terminal: `$PGQ -c "update \"Service\" set \"cancellationWindowHours\"=720 where id='$SVC'"`, then reload another upcoming visit's page.
   - Expect: "This visit is inside the cancellation window — cancelling now incurs a $25.00 fee." (in amber in the dialog).
4. Cancel it.
   - Expect: the toast "Appointment cancelled. A late-cancellation fee of $25.00 applies."
5. Terminal: `$PGQ -c "update \"Service\" set \"cancellationWindowHours\"=24 where id='$SVC'"`

**C-10. Past and completed visits have no actions**

1. Browser A: in **Account → Appointments**, open a visit in the past (the seed includes completed ones).
   - Expect: no "Need to change this visit?" panel, and no Reschedule/Cancel buttons.

**C-11. Staff: book a weekly recurring series**

1. Browser B: sign out, then sign in as `jordan@everwell.demo`. Go to **Appointments** (<http://localhost:3000/dashboard/appointments>).
2. Click **New recurring series**, then fill in:
   - **Patient:** Emma Hartwell
   - **Service:** Initial Physiotherapy Assessment
   - **Clinician:** Sarah Chen
   - **First visit:** a weekday next week
   - **Weekly visits:** 4
3. Click a time, then **Book series**.
   - Expect: the toast "Recurring series booked — 4 weekly visits". Four rows show a purple **Weekly series** badge.
4. Conflict variant: first book Emma (C-1, Browser A) into the **third week's** date at the same time. Then create the series.
   - Expect: a dialog "Some dates could not be booked", listing that date with the reason, and "3 appointments were created."
   - **Proceed with 3 bookings** keeps them. **Cancel the whole series** removes them.

**C-12. Staff: cancel a series**

1. On any **Weekly series** row, click **Cancel series**, then confirm with **Cancel series** in the dialog ("Cancel the whole series?").
   - Expect: the toast "Series cancelled — N upcoming visits cancelled", and those rows show Cancelled.
2. Terminal check:

   ```bash
   $PGQ -c "select action, \"newValue\" from \"AuditLog\" where action='RECURRING_SERIES_CANCELLED' order by \"createdAt\" desc limit 1"
   ```

   - Expect: `RECURRING_SERIES_CANCELLED|{"cancelledCount": N}`

**C-13. Staff calendar sheet**

1. Browser B (Jordan): open <http://localhost:3000/dashboard/provider/calendar> and click an upcoming appointment.
   - Expect: the sheet shows a policy line, **Reschedule** and **Cancel**. **Cancel series** also appears if the visit belongs to a series.
2. Click **Cancel**.
   - Expect: the dialog names the patient ("This cancels … for Emma Hartwell") and shows the policy box.
3. Open a completed appointment.
   - Expect: no Reschedule or Cancel.

**C-14. No patient details in any URL (F1.3)**

1. Browser A, DevTools → **Network** (Preserve log on, from C-1 onwards). Type each of these into the **Filter** box in turn: `emma`, `Hartwell`, `everwell.demo`.
   - Expect: **no requests listed**. The filter matches URLs, and patient details travel only in request bodies.
2. Look back at the address bar URLs you visited.
   - Expect: only ids (`/book/<id>?clinicId=<id>…`, `/payment/<id>`, `/account/appointments/<id>`).

**C-15. Keyboard and screen-reader basics**

1. In each new dialog (Join waitlist, Reschedule, Cancel appointment, New recurring series, Cancel series), use **Tab** to move through the fields and buttons.
   - Expect: focus stays inside the dialog, every field has a visible label, and **Esc** closes it.

### Part D — Checklist

| #   | Function                                             | Backend (Part B) | Frontend (Part C)   | Pass? |
| --- | ---------------------------------------------------- | ---------------- | ------------------- | ----- |
| 1   | Availability for a day / a date range                | B-2, B-3         | C-1                 | ☐     |
| 2   | Slot hold blocks a second hold                       | B-4              | C-3                 | ☐     |
| 3   | Booking with a hold                                  | B-5              | C-1                 | ☐     |
| 4   | No double-booking (app, race, database)              | B-6, B-7, B-8    | C-2                 | ☐     |
| 5   | Expired / taken slot → clean recovery                | B-9, B-10        | C-2, C-3, C-7       | ☐     |
| 6   | Prepay → payment → confirmed                         | B-14             | C-4                 | ☐     |
| 7   | Expired prepay → "Pick a new time"                   | —                | C-5                 | ☐     |
| 8   | Waitlist                                             | —                | C-6, C-7            | ☐     |
| 9   | Reschedule (atomic, slot-taken retry)                | B-11             | C-8                 | ☐     |
| 10  | Cancellation policy stated + late fee                | B-12             | C-1, C-8, C-9, C-13 | ☐     |
| 11  | No actions on past/completed visits                  | —                | C-10, C-13          | ☐     |
| 12  | Recurring series create / conflicts / cancel / authZ | B-13             | C-11, C-12          | ☐     |
| 13  | No PHI in URLs                                       | —                | C-14                | ☐     |
| 14  | Dialog accessibility                                 | —                | C-15                | ☐     |

### Part E — Clean up

```bash
# Stop the dev servers (Ctrl+C in terminals 1 and 2), then drop the throwaway test database.
# Only if you used the default mf_manual — never run this against your dev DB.
docker exec mf-pg psql -U postgres -c "drop database if exists mf_manual with (force)"
```

**If something fails:** note the step id and copy the `brief` output, or the screenshot plus the failing request from the Network tab. Check terminal 1 for the backend log line. Re-run A-1 for a clean database at any time. For known problems, see Part F first.

### Part F — Troubleshooting

| Symptom                                                                                                                            | Cause                                                                                                                                                                                                                               | Fix                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every page shows **`invariant expected app router to be mounted`** (at `AuthProvider` → `useRouter`)                               | Windows drive-letter casing. `next dev` was started from `e:\…`, while the pnpm symlinks resolve to `E:\…`, so webpack loads Next's router modules twice and the two copies don't share the router context. This is not a code bug. | Stop the dev server (Ctrl+C), then run `cd /e/advertout/MedoFlow/frontend && rm -rf .next` and start it again with the A-3 command. For a permanent fix, reopen the workspace with an uppercase drive (`code E:\advertout\MedoFlow`, or File → Open Folder and pick `E:`). |
| B-4 returns **`HTTP 400 · Valid ISO datetime is required`**                                                                        | `S1`/`E1` are empty because the IDs in A-5 came from a different database than the one the backend uses (`DB` mismatch), or B-2 was not run in this terminal                                                                        | `export DB=<the backend's database>`, paste A-5 again (it must print no `❌`), then run B-2 and check `S1=`/`E1=` show ISO times                                                                                                                                           |
| `val` / `brief` print **nothing at all**, `stdin is not a tty`, or `D=` is empty in A-5                                            | Git for Windows can alias `node` to `winpty node.exe` in interactive terminals, and `winpty` cannot read piped input. A-5 now starts with `unalias node`, and the helpers use `command node`.                                       | Paste the current A-5 block again in that terminal (it removes the alias first).                                                                                                                                                                                           |
| A-5 prints `❌ login for … failed`                                                                                                 | The backend from A-2 is not running, or it is on a different port                                                                                                                                                                   | Check terminal 1, and that `curl -s $API/health` returns JSON                                                                                                                                                                                                              |
| Console: **"A tree hydrated but some attributes of the server rendered HTML didn't match"** on `<html>` (e.g. `data-lt-installed`) | A browser extension (LanguageTool, Grammarly, a password manager) edits `<html>`/`<body>` before React loads                                                                                                                        | Fixed: the root layout sets `suppressHydrationWarning` on `<html>` and `<body>`. If the message names another element, it is a real bug: report it                                                                                                                         |
| The same slot shows **different times on different screens**                                                                       | Fixed: all appointment screens use one display zone (`frontend/lib/timezone.ts`)                                                                                                                                                    | Restart the frontend after changing `NEXT_PUBLIC_DISPLAY_TIMEZONE`; `NEXT_PUBLIC_*` values are read at start/build time                                                                                                                                                    |
| Backend won't start: `EADDRINUSE :::4302`                                                                                          | Another process is already on 4302                                                                                                                                                                                                  | Stop it, or use another port in A-2, A-3 and A-5                                                                                                                                                                                                                           |

How to confirm the casing problem is gone. With the dev server running, open a page once, then:

```bash
for c in main-app.js app-pages-internals.js; do curl -s "http://localhost:3000/_next/static/chunks/$c"; done \
  | grep -o 'components/navigation\.js?[0-9a-f]*' | sort -u
```

Expect **one** line. Two lines with different suffixes (for example `components/navigation.js?5e490` and `…?5e491`, which is what the broken setup shows) mean the router is still bundled twice.
