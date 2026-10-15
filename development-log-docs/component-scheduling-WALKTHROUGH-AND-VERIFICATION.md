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

All commands run from the repo root in **Git Bash**. They need Docker and pnpm (`corepack pnpm …` works if `pnpm` is not on PATH).

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

### 4.5 What each flow looks like (for a manual click-through)

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
3. Optional: click through §4.5 on the deployed environment after the merge.

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
