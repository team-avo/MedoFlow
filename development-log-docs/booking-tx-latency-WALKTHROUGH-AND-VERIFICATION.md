# Booking fails after the move to Aiven: walkthrough and verification

**Date:** 2026-11-02 · **Branch:** `fix/booking-tx-latency` (from `development` @ `ff72768`) · **Data:** synthetic only.
**Trigger:** after the demo database moved from Neon (us-east-2) to Aiven (Singapore), the patient portal could no longer confirm a booking. `POST /public/slots/hold` and `POST /appointments` returned 500 with `P2028 Transaction already closed … timeout 5000 ms, 5234 ms passed`.

---

## 1. Outcome

| Item                                                   | Status       | Evidence                                                                                                                         |
| ------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Root cause found                                       | ✅           | Database was on another continent from the API. Each query is a round trip, and a booking makes ~20 inside one transaction (§2). |
| Slot hold reads availability on its own transaction    | ✅           | Unit test that fails if any global-client read happens inside the hold (§4.2)                                                    |
| Stripe called after the booking commits, not inside it | ✅           | Unit tests for call order and Stripe failure (§4.2)                                                                              |
| Transaction timeout 15 s by default, configurable      | ✅           | `PRISMA_TX_TIMEOUT_MS` / `PRISMA_TX_MAX_WAIT_MS`, unit tested                                                                    |
| Booking works at San Francisco-like latency            | ✅           | Old code 7/8, new code **8/8** through a +25 ms/way proxy (§4.4)                                                                 |
| Production error reproduced locally, then fixed        | ✅           | Old code at +115 ms/way fails with the same P2028 at the same lines as the Render log (§4.4)                                     |
| New Aiven SF database: runbook                         | ✅ rehearsed | Every step rehearsed on a throwaway local database (§6). **The owner runs it against Aiven.**                                    |

## 2. Root cause

Render runs the API in **Ohio**. Neon was in the same AWS region (~1–2 ms per round trip). The Aiven service was in **Singapore** (~220–250 ms). Three things multiply that latency:

1. **The RLS wrapper.** With `TENANT_RLS=on`, every query outside a transaction runs as `BEGIN; set_config(...); <query>; COMMIT` ([prisma.ts](../backend/src/config/prisma.ts), `$allOperations`). That's about 4 round trips, roughly 1 s per read from Singapore.
2. **`createAppointment`** makes about 20 sequential queries in one interactive transaction: advisory locks, hold, service, provider, location, membership upsert, conflict checks, insert, audit. Prisma's default timeout is 5 s. It also called **Stripe over HTTP while the transaction was open**.
3. **`createSlotHold`** opened a transaction, then called `availabilityService.getAvailableSlots`, which used the **global client**. Those 4 reads ran on other pooled connections, each with its own RLS wrapper, while the transaction's 5 s clock kept running.

Aiven itself was not the problem. Its location was.

## 3. What changed (files)

| File                                                                                          | Change                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [backend/src/config/prisma.ts](../backend/src/config/prisma.ts)                               | `interactiveTransactionOptions()`: client-wide `maxWait` 5 s / `timeout` 15 s, overridable by env. Per-call options (e.g. the 120 s data-lifecycle job) still win.                                                                                                                                               |
| [backend/src/services/availabilityService.ts](../backend/src/services/availabilityService.ts) | `getAvailableSlots(params, db = prisma)` and `loadBlockers(…, db)` take an optional executor (`SlotsDb`, the same `Pick<TxClient, …>` idiom as `rxCartService`). Other callers are unchanged.                                                                                                                    |
| [backend/src/services/slotHoldService.ts](../backend/src/services/slotHoldService.ts)         | Passes `tx` to `getAvailableSlots`. The `HOLD_CREATED` audit row is written with `tx.auditLog.create`, so it commits or rolls back with the hold.                                                                                                                                                                |
| [backend/src/services/appointmentService.ts](../backend/src/services/appointmentService.ts)   | The transaction returns `amountToCharge`. After commit, `startAppointmentPayment` creates the PaymentIntent and the PENDING `Payment` row, inside `withPatientSelfEnrollScope` so a newly enrolled patient's clinic stays in scope. A Stripe failure still leaves the appointment in PENDING_PAYMENT, as before. |
| [backend/src/tests/bookingTxLatency.test.ts](../backend/src/tests/bookingTxLatency.test.ts)   | 6 new unit tests (§4.2)                                                                                                                                                                                                                                                                                          |
| [backend/.env.example](../backend/.env.example), [render.yaml](../render.yaml)                | Documents the transaction env vars, the Aiven owner role, and `connection_limit` / `pool_timeout` on `DATABASE_URL`.                                                                                                                                                                                             |

**Not done, on purpose:** moving the read-only lookups out of the booking transaction. Outside a transaction each read costs ~4 round trips (the RLS wrapper). Inside it, a read costs 1. Moving them out would make booking slower, or take 5 pool connections at once on a small free-tier connection cap.

## 4. Verification: commands and results

### 4.1 Gates

```bash
cd backend
corepack pnpm exec tsc --noEmit && corepack pnpm exec tsc --noEmit -p tsconfig.test.json   # → clean
corepack pnpm exec eslint src --max-warnings=0                                            # → clean
corepack pnpm exec prettier --check <changed files>                                       # → clean
corepack pnpm exec vitest run                                                             # → 27 files · 432 passed
```

### 4.2 New unit tests (6)

```bash
corepack pnpm exec vitest run src/tests/bookingTxLatency.test.ts   # → 6 passed
```

- `interactiveTransactionOptions`: defaults, env override, invalid values ignored (3 tests).
- `createSlotHold`: the global `provider` / `appointment` / `slotHold` / `providerUnavailability` / `auditLog` delegates **throw**. The hold still succeeds, and every read and write is recorded on `tx`.
- `createAppointment` with prepayment: event order is exactly `commit → stripe:10000 → payment.create`, and nothing is written through `tx.payment`.
- A Stripe failure after commit still returns the appointment, with `clientSecret` undefined and payment status PENDING.

### 4.3 Integration (real Postgres, `medoflow_app` role, RLS on)

```bash
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it
corepack pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/scheduling.int.test.ts   # → 22 passed
corepack pnpm exec vitest run --config vitest.integration.config.ts                                               # → 15 files · 250 passed, 1 skipped
```

### 4.4 Latency proof (simulated cross-region database)

A small TCP proxy adds a fixed delay each way between the app role and `mf-pg`. The owner (fixture) connection stays direct, as in production, where only the API is far from the database. Proxy source (save it outside the repo):

```js
// latency-proxy.cjs — usage: node latency-proxy.cjs <listenPort> <targetPort> <oneWayMs>
const net = require('net')
const [listenPort, targetPort, oneWayMs] = process.argv.slice(2).map(Number)
const delayed = (dest) => (chunk) =>
  setTimeout(() => !dest.destroyed && dest.write(chunk), oneWayMs)
net
  .createServer((client) => {
    const upstream = net.connect(targetPort, '127.0.0.1')
    client.on('data', delayed(upstream))
    upstream.on('data', delayed(client))
    const close = () => setTimeout(() => (client.destroy(), upstream.destroy()), oneWayMs)
    for (const s of [client, upstream]) {
      s.on('close', close)
      s.on('error', close)
    }
  })
  .listen(listenPort, '127.0.0.1')
```

```bash
node latency-proxy.cjs 55499 55432 25      # or 115 for Singapore-like
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@127.0.0.1:55499/mf_it
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it
corepack pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/scheduling.int.test.ts -t "B1.2|B1.4"
```

The 8 selected tests are B1.2 (slot hold → appointment, through `POST /public/slots/hold` and `POST /appointments`) and B1.4 (the booking race).

| Delay (each way)           | ≈ RTT  | Old code (`ff72768`)                                                                                                                     | New code                                                                                                                                                                    |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| +25 ms (Ohio → SF)         | 50 ms  | **7/8.** The 10-way booking race fails: 12× `P2028 … timeout 5000 ms, 5076 ms passed`, and the losers get 500 instead of 409.            | **8/8** (58.5 s)                                                                                                                                                            |
| +115 ms (Ohio → Singapore) | 230 ms | **1/8.** `P2028` at `tx.slotHold.create` (7.5–8.8 s) and `tx.patientClinicMembership.upsert` (5.27 s), the same lines as the Render log. | **5/8.** No P2028 on a single booking. 3 failures: the 10-way race queues past 15 s on the advisory lock, and 2 multi-call reschedule tests hit vitest's 30 s test timeout. |

So moving the database to SF alone would still have broken simultaneous bookings. The code changes are needed too. Singapore is not a supported setup even with the fix.

## 5. Design notes

- **Why 15 s.** At 50 ms RTT a booking transaction takes ~1–1.5 s, and a 10-deep lock queue on one slot fits inside 15 s (measured: the race passes). A higher value would only hide a misplaced database.
- **Audit row in the transaction.** The hold's audit row used to be written on a separate connection, so it could survive a rolled-back hold. It now commits with the hold. Same action, same fields.
- **Payment after commit.** If the process dies between commit and Stripe, the appointment sits in PENDING_PAYMENT with no `Payment` row. That's the same end state as a Stripe failure before this change. Within the 10-minute booking hold, the existing payment endpoint (`paymentService`) creates the PaymentIntent when none exists yet, so the patient can retry payment.

## 6. What you must do manually: move to the Aiven SF database

Run these in **Git Bash** from the repo root. Keep the URLs in your shell only. Aiven's owner user is `avnadmin`.

Rehearsed on 2026-11-02 against a throwaway local database (PG 18): every command below returned the expected output. The only exception is `ALTER ROLE`, which wasn't run because roles are cluster-wide locally and it would have changed the integration-test password.

```bash
# A0. Shell setup
export NEW_OWNER_URL='postgres://avnadmin:<password>@<host>:<port>/defaultdb?sslmode=require'
psql_() { MSYS_NO_PATHCONV=1 docker run --rm -i postgres:17 psql "$NEW_OWNER_URL" "$@"; }

# A1. Connectivity and facts (note max_conn for A7)
psql_ -c "select version(), current_user, current_setting('max_connections') as max_conn;"
psql_ -c "select name from pg_available_extensions where name = 'btree_gist';"        # → 1 row

# A2. Migrations as the owner (also creates the NOLOGIN role medoflow_app and the RLS policies)
cd backend
DATABASE_URL="$NEW_OWNER_URL" corepack pnpm exec prisma migrate deploy                # → All migrations have been successfully applied.
DATABASE_URL="$NEW_OWNER_URL" corepack pnpm exec prisma migrate status                # → Database schema is up to date!

# A3. Turn on the application role
APP_PW=$(openssl rand -hex 24); echo "$APP_PW"        # store it in your password manager
psql_ -c "ALTER ROLE medoflow_app WITH LOGIN PASSWORD '$APP_PW';"
psql_ -c "select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'medoflow_app';"
#   → medoflow_app | f | f | t

# A4. Seed the demo personas (idempotent; rerunning resets their passwords)
DATABASE_URL="$NEW_OWNER_URL" corepack pnpm exec prisma db seed
#   → "Seed complete — tenant: Demo Tenant / clinic: Demo Clinic", and 5 logins, all test1234
cd ..

# A5. Verify
psql_ -c "select email, role from \"User\" where email like '%@medoflow.test' order by email;"   # → 5 rows
psql_ -c "select count(*) from \"Service\"; select count(*) from \"ProviderAvailability\";"       # → 4 and 10

# A6. The app role can connect
export NEW_APP_URL="postgres://medoflow_app:$APP_PW@<host>:<port>/defaultdb?sslmode=require"
MSYS_NO_PATHCONV=1 docker run --rm -i postgres:17 psql "$NEW_APP_URL" -c "select current_user;"   # → medoflow_app
```

The seed writes no field-encrypted models, so `ops:encrypt-phi` is not needed.

**A7. Render** → medoflow-backend → Environment, then **Save and deploy**:

| Key                        | Value                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | `$NEW_APP_URL` + `&connection_limit=10&pool_timeout=20` (keep it well under A1's `max_conn`) |
| `MIGRATION_DATABASE_URL`   | `$NEW_OWNER_URL`                                                                             |
| `AUDIT_PURGE_DATABASE_URL` | `$NEW_OWNER_URL`                                                                             |

Leave `SEED_ON_DEPLOY` unset. On boot the container runs `migrate deploy` (nothing to apply) and checks that the app role enforces RLS.

**A8. Deploy this branch.** Merge to `development`, and CI deploys it. Then:

```bash
curl -s https://medoflow-backend-6pd5.onrender.com/api/v1/health     # → 200
```

In the browser, log in as `patient@medoflow.test` / `test1234`, pick a slot, then **Review → Confirm**. Expect a confirmed booking. In the Render logs, expect `POST /api/v1/public/slots/hold … 201` and `POST /api/v1/appointments … 201`, and no `prisma:error`.

**A9.** Once A8 passes, remove the Singapore Aiven service. If you need anything from it, `pg_dump` it first.

## 7. Known limits

- **The RLS wrapper costs ~4 round trips per query outside a transaction.** At 50 ms that's ~200 ms per standalone read, so list pages will feel slower than they did on Neon. Reducing it (for example with Prisma's `relationJoins` preview to cut include queries, or by batching reads per request) is separate work.
- **The best region match is still same-region.** Render Oregon is ~20 ms from SF, compared with ~50 ms from Ohio. Changing regions needs a new Render service and deploy hook.
- **Pre-existing:** one `module4Entitlements` unit test makes a real Stripe call with the placeholder key (it gets a 401 and the error is caught). It was not changed here.
