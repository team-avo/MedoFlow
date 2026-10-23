# Component 5 — Commerce + Prescription → Cart: walkthrough and verification

**Date:** 2026-10-17 · **Branch:** `feat/c5-rx-cart` (from `feat/c3-clinical-records` @ `bdd835d`) · **Data:** synthetic only. The PHI gate stays closed.
**Plan reference:** `arh-agent-docs/development-plan.md` › Part B › Component 5 (B5.1–B5.7, F5.1–F5.4).
**Want to check it yourself?** §9 is a step-by-step manual testing guide: a reset to a clean database, the backend (curl + database), the frontend (browser, with a printed sign-in sheet of every login and URL), and the real-Stripe leg.

---

## 1. Outcome

| Task                              | AC (short)                                                                                | Status                            | Evidence                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B5.1** Mapping layer            | sample scribe orders map to the right clinic SKUs; unmapped items surfaced, never dropped | ✅                                | `rxMapping.test.ts` (8); `rxCart.int.test.ts` B5.1 group (3); live run                                                                                                     |
| **B5.2** Clinician confirm        | no cart without explicit provider confirmation; confirmation audited                      | ✅                                | `rxCartConfirm.test.ts` (8); `rxCart.int.test.ts` (approve without confirmation → no cart; 400/422 refusals roll back); audit rows `RX_CART_CONFIRMED` / `RX_CART_BUILT`   |
| **B5.3** Auto-build cart          | "Approve & send" creates a cart with exactly the confirmed items/quantities               | ✅                                | `rxCart.int.test.ts` ("Approve & send" test); live run + DB query (§4.6)                                                                                                   |
| **B5.4** One-click checkout       | returning patient pays in one action with no re-entry; no card → normal checkout          | ✅ (engineering)                  | `rxCart.int.test.ts` B5.4 group (4, Stripe stubbed in-process); `criticalRemediation.test.ts` (booking intent saves the card). Real Stripe test mode: **owner step**, §9.7 |
| **B5.5** Scope guard              | supplements/OTC/aesthetic → cart; scheduled Rx → e-prescribe path, never the cart         | ✅                                | `rxMapping.test.ts` (routing); `rxCart.int.test.ts` (Rx → `PENDING_EPRESCRIBE`, add-to-cart 422, storefront hides Rx)                                                      |
| **B5.6** Store/cart/checkout      | guest→server sync; every cart write tenant-scoped **+ audited**; minimum-necessary PHI    | ✅ (re-verified, 2 defects fixed) | `rxCart.int.test.ts` (IDOR 404s, `CART_ITEM_*` audit rows) — see §2 #1–#2                                                                                                  |
| **B5.7** Tests                    | mapping, confirm gating, one-click happy/decline covered and green                        | ✅                                | §4                                                                                                                                                                         |
| **F5.1** Detected-products chips  | scribe screen shows removable chips the provider confirms before send (e2e)               | ✅                                | `e2e/rx-cart.spec.ts` (provider); `e2e/live-rx-cart.spec.ts` (real API); `tests/components/rxCart.test.tsx`                                                                |
| **F5.2** Patient cart + one-click | "Prescribed · Dr. X", accept/decline, one-click pay completes (e2e)                       | ✅                                | `e2e/rx-cart.spec.ts` (patient, incl. decline); live run (provenance, decisions, fallback)                                                                                 |
| **F5.3** "On file from booking"   | shipping + card shown as on file; no re-entry fields for a returning patient              | ✅                                | `e2e/rx-cart.spec.ts` (no address/card textbox, no Stripe iframe); unit tests                                                                                              |
| **F5.4** Storefront + drawer      | per-clinic branding; guest→server sync                                                    | ✅ (unchanged)                    | existing; drawer re-verified in the browser (§9.5 F-11)                                                                                                                    |

**Exit criteria (Universal Acceptance Standard)**

| #   | Criterion                                                    | State                                                                                                                   |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | CI gate: typecheck, lint (0 warnings), tests, audit          | ✅ locally, all green (§4.1). CI runs on the PR.                                                                        |
| 2   | Tests prove the behaviour, happy + negative paths            | ✅ 26 new backend unit, 17 new integration, 22 new frontend unit, 3 new e2e, 2 live                                     |
| 3   | No regressions                                               | ✅ every pre-existing suite green (backend 203 → 229 unit, 156 → 173 integration; frontend 149 → 171 unit; e2e 16 → 19) |
| 4   | Peer review                                                  | ⬜ PR not opened yet (no commit made — waiting for your go-ahead)                                                       |
| 5   | HIPAA §2 per-change gate                                     | ✅ §7                                                                                                                   |
| 6   | Verified in a running environment                            | ✅ real API + real frontend on this machine (§4.6, §9). Real Stripe: ⬜ owner step §9.7                                 |
| 7   | No open defects / docs updated / no secrets / synthetic only | ✅ ADR 0003, plan statuses, this doc; secret sweep clean (§4.7)                                                         |

**Not done here (needs you):**

- Run the real-Stripe leg of the manual guide (§9.7) with your Stripe **test** keys. There were no Stripe keys on this machine, so automated tests replace Stripe in-process (no network).
- Apply migration `20261017000000_rx_to_cart` on Neon.
- Classify prescription products in each clinic (`fulfillmentClass`).
- Sign ADR 0003.
- Open the PR (see §6).

---

## 2. Problems found and fixed

1. **Cross-patient cart IDOR.**
   - **Problem.** `PUT /carts/items/:itemId` and `DELETE /carts/items/:itemId` looked items up by id only. `cartService.updateCartItem` / `removeCartItem` ignored the caller's `cartId`, so any authenticated user could change or delete another patient's cart item by id.
   - **Fixed:** items are found with `{ id, cartId: <caller's active cart> }`. Any other id returns 404 (`rxCart.int.test.ts` › IDOR).
2. **Cart writes were not audited** (B5.6 was marked ✅ but its AC says "audited").
   - **Fixed:** these actions now write audit rows with ids, quantities and channel only, never product names:
     - `CART_ITEM_ADDED`, `CART_ITEM_UPDATED`, `CART_ITEM_REMOVED`
     - `CART_CLEARED`, `CART_CHECKOUT`, `CART_ITEM_DECISION`, `CART_ONE_CLICK_FAILED`
3. **Demo checkout double-counted revenue.**
   - **Problem.** `demoCheckoutCart` wrote **two** PAID `Payment` rows per order.
   - **Fixed:** it now writes one. Demo checkout also goes through the shared checkout rules (decisions, scope guard).
4. **"Approve" never sent its body.**
   - **Problem.** `frontend/lib/aiScribeApi.ts › approveSession` built a body and then posted without it.
   - **Fixed:** it now sends `{ rxConfirmation }`. The route validates the body with Zod (strict, optional).
5. **Nothing stopped prescription products being sold from the cart.**
   - **Problem.** Any product could be added and checked out, and the storefront listed everything.
   - **Fixed:** this is the B5.5 scope guard:
     - add-to-cart and every checkout path return `422 RX_ROUTE_EPRESCRIBE`;
     - the public product list and product page exclude `RX_*`.
6. **Product create/update had no validation.**
   - **Problem.** `PUT /products/:id` passed `req.body` straight into `prisma.product.update`.
   - **Fixed:** strict Zod schemas now cover create and update, including the new `fulfillmentClass` / `aliases`. Unknown fields such as `clinicId` are rejected (`commerceValidation.test.ts`).
7. **The booking card was never kept, and a real Stripe payment never reached the server without a webhook.**
   - **Problem.** After Stripe's Payment Element succeeded, the page navigated away without telling the API. Locally, with no `stripe listen`, the booking stayed `PENDING_PAYMENT`.
   - **Fixed:**
     - The page now calls `POST /payments/:id/confirm` after success. The webhook still does the same, idempotently.
     - The booking PaymentIntent saves the card (`setup_future_usage: off_session`).
     - The server asks Stripe directly before it stores the card summary.
8. **The AI Scribe console was unreachable.**
   - **Problem.** `/dashboard/provider/visits/[id]/scribe` was not linked from anywhere and had no demo path.
   - **Fixed:** an **AI Scribe console** button on the provider appointment page, and **Demo: simulate conversation** on the console. That makes the full Rx→Cart flow testable without Ollama or Redis.
9. **Accessibility** (found by the new axe checks in the e2e specs, before release).
   - **Problem.** Removed chips had too little colour contrast, and the "on file" block misused `<dl>`.
   - **Fixed:** both corrected. axe now reports no serious violations on the panel or the one-click block.

---

## 3. What was built (files)

### Backend

| File                                                                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma` + `migrations/20261017000000_rx_to_cart/`                                 | **Product:** `fulfillmentClass` enum and `aliases`. **New models:** `RxOrderProposal`, `RxOrderLine`, `PatientCommerceProfile`. **CartItem:** `rxOrderLineId` (unique), `prescribedByProviderId`, `patientDecision`. **Prescription:** `status` (`DRAFT \| PENDING_EPRESCRIBE \| SENT`) and `rxOrderLineId`. **RLS:** row-level-security policies and explicit `medoflow_app` grants on the 3 new tables. |
| `src/services/rxMappingService.ts` (new)                                                         | B5.1 deterministic mapper and routing (`routeFor`, `parseScribeOrders`)                                                                                                                                                                                                                                                                                                                                   |
| `src/services/rxCartService.ts` (new)                                                            | Proposal upsert from scribe orders, provider line edits, `confirmProposal`, `buildCartFromProposal` (hard gate), audit, "send later"                                                                                                                                                                                                                                                                      |
| `src/services/patientCommerceService.ts` (new)                                                   | Stripe customer (ids only), `rememberCardFromPaymentIntent`, shipping address, one-click checkout (off-session, decline handling)                                                                                                                                                                                                                                                                         |
| `src/services/cartService.ts`                                                                    | IDOR fix, audit on every write, scope guard, patient decisions, shared `preparePayableCart` / `createCartInvoice`, demo-checkout double-payment fix, provenance include                                                                                                                                                                                                                                   |
| `src/services/aiScribeService.ts`                                                                | `approveDraft(…, { rxConfirmation })`: approve + confirm + build in one transaction; simulate also yields orders                                                                                                                                                                                                                                                                                          |
| `src/queues/aiScribeQueue.ts`                                                                    | Every scribe prompt now asks for `orders`; they are parsed and turned into a proposal (failures never block the note)                                                                                                                                                                                                                                                                                     |
| `src/services/paymentService.ts`, `src/controllers/webhookController.ts`                         | Booking intent saves the card; confirm and webhook remember it                                                                                                                                                                                                                                                                                                                                            |
| `src/controllers/rxCartController.ts`, `src/routes/rxCart.ts` (new)                              | `GET /rx-cart/catalog`, `GET /rx-cart/sessions/:sessionId/proposal`, `PUT /rx-cart/proposals/:id/lines`, `POST /rx-cart/proposals/:id/confirm` (provider only)                                                                                                                                                                                                                                            |
| `src/routes/carts.ts`, `src/controllers/cartController.ts`                                       | Patient: `PATCH /carts/items/:itemId/decision`, `GET /carts/one-click`, `POST /carts/one-click-checkout`, `PUT /carts/shipping-address`                                                                                                                                                                                                                                                                   |
| `src/validation/rxCartSchemas.ts` (new)                                                          | Zod for the approve body, confirmation, line edits, decision, shipping address, product create/update                                                                                                                                                                                                                                                                                                     |
| `src/routes/products.ts`, `services/productService.ts`, `controllers/productController.ts`       | Validated catalog fields incl. classification                                                                                                                                                                                                                                                                                                                                                             |
| `src/controllers/publicController.ts`                                                            | Storefront hides `RX_*` products                                                                                                                                                                                                                                                                                                                                                                          |
| `src/config/prisma.ts`, `src/utils/fieldCrypto.ts`, `src/services/fieldEncryptionMaintenance.ts` | New clinic-scoped models registered; `RxOrderLine.rawText` and the shipping address sealed; `ops:encrypt-phi` covers them                                                                                                                                                                                                                                                                                 |
| `scripts/seed-e2e-live.ts`                                                                       | Classified catalog, an open visit for the Rx flow, two bookings awaiting payment                                                                                                                                                                                                                                                                                                                          |
| Tests (new)                                                                                      | `rxMapping.test.ts`, `rxCartConfirm.test.ts`, `commerceValidation.test.ts`, `integration/rxCart.int.test.ts`; `criticalRemediation.test.ts` extended                                                                                                                                                                                                                                                      |

### Frontend

| File                                                                                              | Change                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/rxCart/DetectedProductsPanel.tsx` (new)                                               | F5.1 chips (remove / restore, route badge), unmapped items with "map to product", confirmation checkbox; `rxApproval()` builds the "Approve & send" payload                               |
| `app/dashboard/provider/visits/[id]/scribe/page.tsx`                                              | Panel in the editor, **Approve & send** (saves the draft, then approves with the confirmation), **Demo: simulate conversation**                                                           |
| `app/dashboard/provider/appointments/[id]/consultation/page.tsx`                                  | Same panel and "Approve & send" in the consultation room (inline card and modal)                                                                                                          |
| `app/dashboard/provider/appointments/[id]/page.tsx`                                               | **AI Scribe console** link                                                                                                                                                                |
| `components/store/CartModal.tsx`                                                                  | "Prescribed · Dr. X" badge, Accept / Decline, one-click in the drawer footer                                                                                                              |
| `components/store/OneClickPay.tsx` (new)                                                          | F5.2/F5.3: card + address "On file from booking", one action, recoverable decline, fallback                                                                                               |
| `app/(public)/checkout/page.tsx`                                                                  | One-click by default for eligible patients ("Use a different card" opens Elements); provenance + decisions; declined items not charged                                                    |
| `components/store/ShippingAddressForm.tsx` (new), `lib/schemas/commerce.ts` (new)                 | Address form, Zod mirror of the API (shared cases)                                                                                                                                        |
| `app/(public)/payment/[appointmentId]/page.tsx`                                                   | Address capture at booking, "card saved" notice, server confirm after a Stripe success                                                                                                    |
| `app/(public)/account/billing/page.tsx`                                                           | "Card & shipping on file" card                                                                                                                                                            |
| `components/products/AddProductModal.tsx`, `app/dashboard/products/page.tsx`, `lib/productApi.ts` | Classification + aliases; classification badge on product cards                                                                                                                           |
| `hooks/useCart.tsx`, `lib/rxCartApi.ts` (new), `lib/aiScribeApi.ts`                               | Provenance fields, `setDecision`, payable subtotal; API client                                                                                                                            |
| Tests (new)                                                                                       | `tests/components/rxCart.test.tsx`, `tests/unit/commerceSchemas.test.ts`, `e2e/rx-cart.spec.ts` + `e2e/rxCartMock.ts`, `e2e/live-rx-cart.spec.ts`; `e2e/mockApi.ts` gains a PROVIDER role |

**Also changed:**

- `shared/validation-cases/commerce.json`: backend ↔ frontend parity cases for the address.
- `docs/adr/0003-prescription-to-cart.md`.
- `arh-agent-docs/development-plan.md` statuses.
- Prettier formatting:
  - lint-staged would apply it on commit anyway;
  - a few older files that were not Prettier-clean were reformatted as a whole while being edited (`scribe/page.tsx`, `lib/aiScribeApi.ts`, `routes/aiScribe.ts`, `lib/productApi.ts`, `AddProductModal.tsx`, `products/page.tsx`), mostly removed semicolons, so their diffs look larger than the functional change.

### API at a glance

| Method & path                                                                    | Who      | Purpose                                                      |
| -------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `POST /ai-scribe/session/:id/approve` `{ rxConfirmation? }`                      | provider | "Approve & send"; without the confirmation, no cart is built |
| `GET /rx-cart/sessions/:sessionId/proposal`                                      | provider | Detected products                                            |
| `PUT /rx-cart/proposals/:id/lines`                                               | provider | Quantity, remove, map to product, add                        |
| `POST /rx-cart/proposals/:id/confirm` `{ confirmedLineIds, acknowledged: true }` | provider | Send later (note already approved)                           |
| `GET /rx-cart/catalog`                                                           | provider | Products to map to                                           |
| `PATCH /carts/items/:itemId/decision` `{ decision }`                             | patient  | Accept / decline a prescribed item                           |
| `GET /carts/one-click`                                                           | patient  | Card + address on file                                       |
| `POST /carts/one-click-checkout`                                                 | patient  | Pay with the card on file                                    |
| `PUT /carts/shipping-address`                                                    | patient  | Save the address (booking page / Billing)                    |

---

## 4. Verification: commands and results

All commands run from Git Bash on 2026-10-17. Use `corepack pnpm` wherever `pnpm` is not on your PATH.

### 4.0 One-time local setup

```bash
docker start mf-pg                                   # postgres:18 on 55432, db mf_it, role medoflow_app
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it corepack pnpm exec prisma migrate deploy
# → applied 20261017000000_rx_to_cart
corepack pnpm exec prisma migrate diff --from-url postgresql://postgres:postgres@localhost:55432/mf_it \
  --to-schema-datamodel prisma/schema.prisma --exit-code
# → exit 0 (no drift)
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it
```

### 4.1 Gate commands (what CI runs)

```bash
# backend/
corepack pnpm run typecheck                    # → clean (src + tests)
corepack pnpm run lint                         # → 0 problems
node scripts/check-synthetic-fixtures.js       # → ✓ passed (65 files scanned)
corepack pnpm run test:coverage                # → 20 files, 229 passed · lines 21.55% (floor 17)
corepack pnpm run test:integration:coverage    # → 12 passed | 1 skipped files · 173 passed, 1 skipped · lines 47% (floor 33)
node scripts/audit-backend.js                  # → ✓ no unaccepted high/critical advisories

# frontend/
corepack pnpm run typecheck                    # → clean
corepack pnpm run lint                         # → ✔ No ESLint warnings or errors
corepack pnpm run test:coverage                # → 18 files, 171 passed
node scripts/audit-frontend.js                 # → ✓ no unaccepted high/critical advisories
corepack pnpm exec next build                  # → exit 0
```

> The audit scripts call `pnpm`. Where only corepack is available, a two-line shim in the gitignored `node_modules/.shim/` was put on PATH for the run and deleted afterwards.

### 4.2 B5.1 mapping

```bash
corepack pnpm exec vitest run src/tests/rxMapping.test.ts
# → Tests 8 passed
```

Proven:

- A sample orders array maps to the right SKUs by SKU, alias, mention inside the text, short name and token overlap. Quantities are kept.
- 3 orders give 3 lines, in order. Unmapped lines are `UNMAPPED` / `MANUAL`, never dropped.
- A tie is `AMBIGUOUS`, with both candidates listed. The mapper never guesses.
- `RX_SCHEDULED` and `RX_NON_SCHEDULED` route to `EPRESCRIBE`. Only supplement, OTC and aesthetic route to `CART`.
- LLM output shapes are parsed and quantities clamped (1–99). The order count is capped at 25.

### 4.3 B5.2 / B5.3 confirmation and cart build

```bash
corepack pnpm exec vitest run src/tests/rxCartConfirm.test.ts src/tests/commerceValidation.test.ts
# → Tests 18 passed
corepack pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/rxCart.int.test.ts
# → Tests 17 passed   (run twice in a row: 17/17 both times — fixtures are per-run)
```

Proven against Postgres with RLS and enforce mode:

- **Mapping:**
  - Scribe orders become a proposal of 4 lines, one of them unmapped.
  - Clinic B's identical SKU is never matched.
  - Order text is stored as `fle:v1:…` ciphertext.
- **Isolation:**
  - Another clinic's provider gets `proposal: null` and 404 on edit and confirm.
  - A patient gets 403.
- **Refusals:**
  - `acknowledged: false` returns 400.
  - Confirming an unmapped line returns 422, and the note stays `DRAFT_GENERATED`: the whole approval rolled back.
- **Edits:** the provider re-quantities a line, which is audited as `RX_PROPOSAL_EDITED`.
- **"Approve & send":**
  - The cart holds **exactly** magnesium × 3 and arnica × 1, each `PENDING` with provenance.
  - Tramadol becomes a `Prescription(PENDING_EPRESCRIBE)` and is not in the cart.
  - The unconfirmed line is `REMOVED`.
  - `RX_CART_CONFIRMED` and `RX_CART_BUILT` audit rows contain no product names.
- **Repeat confirm:** confirming a sent proposal again returns 409.
- **Approve without confirmation:**
  - The note is final, but the proposal stays `PENDING` and there are 0 cart items and no `RX_CART_BUILT` row.
  - "Send later" without acknowledgement returns 400; with it, the cart is built.

### 4.4 B5.4 / B5.5 / B5.6 checkout, scope guard and cart writes

Proven in the same integration file, with Stripe replaced in-process:

- **Scope guard:** adding tramadol returns 422 `RX_ROUTE_EPRESCRIBE`, and the public storefront lists magnesium but not tramadol.
- **IDOR:** patient B → PUT / DELETE / PATCH-decision on patient A's item returns 404, and the item is unchanged.
- **Audit:** add → update → delete writes `CART_ITEM_ADDED`, `CART_ITEM_UPDATED`, `CART_ITEM_REMOVED`.
- **Pending decisions:** checkout while prescribed items are undecided returns 409 `RX_DECISION_REQUIRED`.
- **No card:** `GET /carts/one-click` reports `NO_CARD_ON_FILE`, and one-click returns 409.
- **Card saved at booking:**
  - Paying a booking through `POST /payments/:id/confirm` saves the card after the API retrieves the intent from Stripe.
  - `PUT /carts/shipping-address` saves the address.
  - The address is sealed at rest, and `CARD_ON_FILE_SAVED` and `SHIPPING_ADDRESS_SAVED` are audited.
- **Decline:**
  - The response is 402; the cart stays ACTIVE and the payment row is `FAILED`.
- **One-click success:**
  - Stripe is called with the saved `customer` + `payment_method`, `off_session: true, confirm: true`.
  - The invoice is PAID with **only** the accepted magnesium × 3 (declined arnica not charged) and attributed to the prescribing provider.
  - The payment is PAID and the cart CHECKED_OUT.

`criticalRemediation.test.ts` additionally proves the booking PaymentIntent is created with the patient's `customer` and `setup_future_usage: 'off_session'`.

### 4.5 Frontend unit, component and e2e

```bash
cd frontend
corepack pnpm exec vitest run tests/components/rxCart.test.tsx tests/unit/commerceSchemas.test.ts
# → Tests 22 passed
```

**Playwright on Windows, two terminals.**

- Terminal 1: `NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 corepack pnpm exec next build && corepack pnpm test:e2e:serve`
- Terminal 2: `E2E_EXTERNAL_SERVER=1 corepack pnpm exec playwright test`

```
✓ F5.1 provider removes, maps and confirms detected products, then "Approve & send"
✓ F5.2 / F5.3 patient accepts / declines prescribed items and pays with the card on file
✓ F5.2 without a card on file the cart falls back to the regular checkout
… all earlier specs …
19 passed, 4 skipped (the two opt-in live suites)
--repeat-each=5 e2e/rx-cart.spec.ts → 15 passed
```

What the e2e specs check:

- **Provider:**
  - "Approve & send" stays disabled until the provider confirms.
  - The request body is **exactly** the chips left on screen; the removed arnica is absent.
  - The mapped turmeric is included.
- **Patient:**
  - There are no address or card text fields and no Stripe iframe.
  - The pay button stays disabled until accept/decline.
  - A decline shows an alert and the button stays usable.
  - A success shows the confirmation screen with only the accepted item.
- **Both:**
  - axe finds no serious violations.
  - No patient name, address or product name appears in any URL.

### 4.6 Live front-end ↔ back-end check (no mocks)

**Setup:**

- **Backend:** the real API on `:4302` against `mf_it`.
  - Connected as `medoflow_app`, so RLS is enforced.
  - Field encryption is on, with a throwaway key.
  - No Stripe key.
- **Frontend:** built against the API and served on `:4310`.
- **Seed:** `scripts/seed-e2e-live.ts`.

```bash
cd backend
node -e "const c=require('crypto');const h=()=>c.randomBytes(32).toString('hex');console.log('FIELD_ENCRYPTION_KEYS=live1:'+h()+'\nJWT_SECRET='+h()+'\nFILE_BLOB_SIGNING_SECRET='+h()+'\nMFA_ENCRYPTION_KEY='+h()+'\nE2E_LIVE_PASSWORD=Synthetic-Live-'+c.randomBytes(6).toString('hex'))" > uploads/.live-env
set -a; . uploads/.live-env; set +a
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it corepack pnpm exec ts-node --transpile-only scripts/seed-e2e-live.ts > uploads/.live-seed.json
PORT=4302 NODE_ENV=development FIELD_ENCRYPTION_ACTIVE_KID=live1 CORS_ORIGIN=http://127.0.0.1:4310 \
  DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it S3_ACCESS_KEY_ID= S3_SECRET_ACCESS_KEY= REDIS_URL= \
  TENANT_ISOLATION_MODE=enforce corepack pnpm exec ts-node --transpile-only src/server.ts
# → [field-encryption] keys loaded (active "live1", 1 total) · [db] connected as "medoflow_app" — row-level security is enforced

cd ../frontend    # second terminal
NEXT_PUBLIC_API_URL=http://127.0.0.1:4302 corepack pnpm exec next build && node scripts/e2e-server.js 4310
# third terminal (frontend/)
set -a; . ../backend/uploads/.live-env; set +a
E2E_LIVE_API=http://127.0.0.1:4302 E2E_LIVE_SEED="$(cat ../backend/uploads/.live-seed.json)" E2E_EXTERNAL_SERVER=1 \
  corepack pnpm exec playwright test e2e/live-rx-cart.spec.ts
```

```
✓ provider: scribe detects products, provider maps + confirms, "Approve & send" builds the cart
✓ patient: sees "Prescribed · Dr. X", accepts / declines, and (no card yet) gets the regular checkout
2 passed
```

The same spec also passed (2/2) against the **dev server on `http://localhost:3000`** started exactly as in §9.3. That is the setup the manual guide uses.

**What the live run did:**

- **Provider:**
  - Signed in through the UI, started a scribe session and simulated the conversation.
  - Saw the four detected products; tramadol was badged e-Prescribe and the turmeric complex was unmatched.
  - Mapped the turmeric to _Turmeric Curcumin_.
  - Found "Approve & send" disabled until the box was ticked, then sent.
- **Patient:**
  - Saw three items "Prescribed · Dr. Synthetic Provider" and no tramadol.
  - Accepted two and declined one; the total became $66.00.
  - With no card on file, was offered **Secure Checkout**.

**Stored values afterwards** (read with the owner role):

| Table          | What is stored                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `RxOrderLine`  | `rawText` = `fle:v1:live1:RxOrderLi…` (ciphertext) on all 4 lines; 3 × `CART/CONFIRMED`, 1 × `EPRESCRIBE/CONFIRMED`          |
| `CartItem`     | Arnica Gel 1 `DECLINED`, Magnesium Glycinate 2 `ACCEPTED`, Turmeric Curcumin 1 `ACCEPTED`, all with `prescribedByProviderId` |
| `Prescription` | 1 × `PENDING_EPRESCRIBE` linked to the tramadol line                                                                         |
| `AuditLog`     | `RX_PROPOSAL_CREATED` 1, `RX_PROPOSAL_EDITED` 1, `RX_CART_CONFIRMED` 1, `RX_CART_BUILT` 1, `CART_ITEM_DECISION` 3            |

### 4.7 No secrets in the change

- `gitleaks` is not installed on this machine. CI's "Secret scan (git history)" step runs it on the PR.
- A regex sweep (Stripe `sk_/pk_/whsec_`, AWS keys, private keys, 64-hex strings, Slack/GitHub tokens) over all 54 changed and new files found only the pre-existing `pk_test_placeholder` fallbacks.
- Test fixtures use `example.test` emails, `cus_synthetic_…` / `pi_synthetic_…` ids and no card numbers. `check-synthetic-fixtures.js` passes.
- Throwaway env and seed files lived in the gitignored `backend/uploads/` and `backend/.env.manual.local`, and were deleted after the runs.

### 4.8 What each flow looks like (manual click-through)

| Flow               | Where                                                                          | What you should see                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detected products  | Provider › appointment › **AI Scribe console** → _Demo: simulate conversation_ | "Detected products" panel: chips _Magnesium Glycinate × 2 · Cart_, _Arnica Gel × 1 · Cart_, _Tramadol × 1 · e-Prescribe_; amber box "Not matched to your catalog…" with _Turmeric complex × 1_ and a product picker |
| Approve & send     | same                                                                           | Button disabled + "Confirm the detected products before sending" until the box is ticked; then toast "Note approved · N products sent to the patient's cart" and a green "Sent: …" summary                          |
| Classification     | Admin › Products                                                               | Badge on each card (_Supplement_, _Prescription (scheduled)_…); _Add Product_ has a Classification select and "Also known as"                                                                                       |
| Patient cart       | Clinic site › cart icon, or `/checkout`                                        | "Prescribed · Dr. Synthetic Provider" badge, **Accept** / **Decline**; declined items are struck through: "Declined — not charged"                                                                                  |
| One-click          | `/checkout` (card on file)                                                     | "Ships to … · On file from booking", "Visa •••• 4242 · On file from booking", **Pay $X with card on file**; no card fields                                                                                          |
| Fallback           | `/checkout` (no card)                                                          | **Secure Checkout** (Stripe Elements) and the demo button, as before                                                                                                                                                |
| Address at booking | `/payment/<appointment>`                                                       | "Shipping address for products your provider prescribes (optional)" form; the card notice under the Stripe form                                                                                                     |
| On file            | Account › Billing                                                              | "Card & shipping on file"                                                                                                                                                                                           |

---

## 5. Design notes

The full decision record is ADR 0003 (`docs/adr/0003-prescription-to-cart.md`). In short:

- **Deterministic mapping, not an LLM.**
  - It is explainable and testable, and sends no catalog data to an LLM.
  - Failures show up as `UNMAPPED` for the provider to resolve, never as a silent drop.
- **The confirmation is a hard, server-side gate.**
  - `buildCartFromProposal` refuses anything but a `CONFIRMED` proposal with a recorded confirmer.
  - The UI checkbox only produces the `acknowledged: true` the API insists on.
  - Approval, confirmation and cart build share one transaction.
- **Scope guard in depth.** The mapper routes `RX_*` to e-prescribe, and the cart, every checkout and the storefront each refuse it independently.
  - Non-scheduled Rx is also routed to e-prescribe. This is a conservative default for the Medical Director to confirm.
- **Card on file stays at Stripe (PCI SAQ-A).**
  - MedoFlow stores the Stripe ids, brand, last 4 and expiry only.
  - The Stripe Customer carries metadata ids, not the patient's name or email (minimum necessary).
  - The card is remembered only after the API itself confirms with Stripe that the payment succeeded.
- **"Paid" is server-confirmed.**
  - One-click fulfils only when Stripe's server-side confirmation returns `succeeded`, through the same idempotent handler as the webhook.
  - The client never marks anything paid.
- **Minimum necessary in the cart.**
  - The cart shows the prescriber's name only, not their profile.
  - Audit rows carry ids and counts, not product names (verified by D-6).

---

## 6. What you must do manually

| #   | Who                                     | Step                                                                                                                                    | How to verify                                                                                |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | You                                     | Run the real-Stripe leg (§9.7) with your Stripe **test** keys                                                                           | S-1 … S-6 ticked in §9.10; attach the Stripe dashboard screenshot of the off-session payment |
| 2   | Owner                                   | Apply `20261017000000_rx_to_cart` on Neon (`prisma migrate deploy` with the owner URL)                                                  | `prisma migrate status` → up to date; nothing to backfill (new tables/columns only)          |
| 3   | Clinic admins                           | Classify prescription products (Products › edit, or `fulfillmentClass` via the API). Until then every existing product is `SUPPLEMENT`. | The badge on each product card                                                               |
| 4   | CTO, Security Officer, Medical Director | Sign ADR 0003 (and confirm the non-scheduled-Rx routing choice)                                                                         | Signature table filled                                                                       |
| 5   | You                                     | Say the word and I commit to `feat/c5-rx-cart` and open the PR into `development` on `team`                                             | CI green on the PR                                                                           |

**Declare B5/F5 complete when** steps 1–4 are done and the PR is merged with CI green.

---

## 7. Review checklist and HIPAA §2 per-change gate

| Item                      | Answer                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Correctness**           | Confirmation, cart build and approval are one transaction. The build is idempotent (unique `rxOrderLineId`). Declined items are never charged. One-click uses a per-invoice idempotency key.                            |
| **AuthZ**                 | `/rx-cart/*` is PROVIDER only, and only for the proposal's own provider (others get 404). The patient endpoints are PATIENT only and act on the caller's own active cart (IDOR fixed).                                  |
| **Tenant scoping**        | The 3 new models are in `CLINIC_SCOPED_MODELS` with RLS policies. Every query names its clinic. The integration suite runs in enforce mode with RLS, and cross-clinic access returns 404.                               |
| **Audit**                 | Proposal created / rebuilt / edited / confirmed / built; every cart write; decisions; one-click success and failure; card saved; address saved. Ids and counts only.                                                    |
| **PHI in logs**           | No order text, address or product name is logged. Stripe errors are logged server-side only for non-card failures, without the request body.                                                                            |
| **PHI in URLs**           | Ids only. The e2e and live specs assert that no patient name, address or product name appears in any URL.                                                                                                               |
| **Minimum necessary**     | The cart exposes the prescriber's first and last name only. The Stripe Customer has no name or email. The one-click status returns the patient's own address only.                                                      |
| **Encryption at rest**    | `RxOrderLine.rawText` and the shipping name, lines, city and postcode are sealed (ADR 0002 envelope). `Prescription.notes` stays plaintext, as already listed in ADR 0002 for the next iteration.                       |
| **New vendor / PHI path** | No new vendor. **Stripe** (already used) now holds a Customer per patient (ids only) and a saved card; it is a payment processor, and card data never touches MedoFlow. Note this in the BAA register entry for Stripe. |
| **Fixtures**              | Synthetic only (`example.test`, `Synthetic …`, `cus_synthetic_…`). No card numbers in code. Stripe test cards appear only in this guide.                                                                                |

---

## 8. Known limits and open items

- **Real Stripe not exercised by me.** There were no Stripe keys on this machine. Every automated test replaces Stripe in-process at the SDK boundary. The real off-session charge, decline and 3-D Secure behaviour are covered by §9.7, which you run.
- **No e-prescribing vendor.** Rx items wait as `Prescription.status = PENDING_EPRESCRIBE`. They appear in the existing prescription lists with the note "routed to e-prescribe", and nothing sends them anywhere yet. That is a follow-up integration (Surescripts/DoseSpot).
- **`POST /payments/:id/confirm` still trusts the client** to have paid. This was already the case and is tracked under B4. The new card-saving step does verify with Stripe, so no card is stored for an unpaid intent.
- **One cart per patient per clinic.** `GET /carts` uses the patient's home clinic. A patient who belongs to several clinics sees prescribed items only in the clinic they are signed in to (pre-existing cart model).
- **Shipping is not priced, and inventory is not reserved before a one-click charge.** Both are pre-existing; stock is decremented at fulfilment.
- **No patient UI to remove a saved card yet.** Support can remove it in the Stripe dashboard.
- **The consultation room's own "Demo: simulate" button** only appears in a narrow state (pre-existing). Use the AI Scribe console for demos; it is the path the guide and the live spec use.
- **Old products default to `SUPPLEMENT`** and must be reclassified (owner step 3).

---

## 9. Manual local testing guide

Follow this guide to check by hand that every Component 5 function works on your machine, both backend and frontend.

**Time needed:** about 15 minutes for setup, 20 for the curl and database checks, 25 for the browser, and 15 for the Stripe leg.

- **Validated:** every terminal command below (§9.2–§9.4, §9.6, §9.9) was run verbatim on 2026-10-23 against this branch, in Git Bash, starting from the §9.2 step 0 reset. The "Expect" values are the recorded results.
  - The browser steps (§9.5) were driven with Playwright on the same dev setup (`localhost:3000` + the API from `.env.manual.local`), using the sign-in links that §9.2 step 4 prints, and passed.
  - **§9.7 (real Stripe) was not run**: it needs your Stripe test keys.
- **Data:** synthetic only. Nothing here touches a real patient or a live Stripe account.

Each check has an id: `B-…` backend API, `F-…` frontend browser, `D-…` database, `S-…` Stripe test mode. Tick them off in the **result sheet (§9.10)**; any ✗ is a defect. If something fails, look in **§9.11 Troubleshooting** first.

**What you will test**

| Function                                                                | Backend                     | Frontend      | Database |
| ----------------------------------------------------------------------- | --------------------------- | ------------- | -------- |
| Scribe orders → clinic SKUs; unmapped surfaced, never dropped (B5.1)    | B-1 – B-3, B-8              | F-1, F-2, F-5 | D-1, D-7 |
| Nobody else can see or change a proposal                                | B-4, B-5                    | —             | —        |
| No cart without explicit, audited confirmation (B5.2)                   | B-6, B-7, B-10, B-19 – B-21 | F-3, F-6      | D-5, D-6 |
| "Approve & send" builds exactly the confirmed items (B5.3, F5.1)        | B-9                         | F-4 – F-7     | D-3      |
| Scope guard: Rx → e-prescribe, never the cart or storefront (B5.5)      | B-9, B-13                   | F-8 – F-10    | D-4      |
| Patient cart: provenance, accept / decline, declined not charged (F5.2) | B-11, B-12, B-15            | F-11 – F-13   | D-3      |
| Cart writes owner-only + audited (B5.6)                                 | B-14                        | —             | D-5      |
| No card → regular checkout (B5.4)                                       | B-16, B-17                  | F-14          | —        |
| Address saved at booking, encrypted (F5.3)                              | B-18                        | F-15, F-16    | D-2      |
| Card saved at booking + one-click pay + decline (B5.4, F5.2, F5.3)      | S-6                         | S-1 – S-5     | S-6      |

### 9.1 Before you start

You need:

- Docker Desktop running, with the `mf-pg` Postgres container (B0 walkthrough §4.0 creates it);
- Node 20 or later;
- Git Bash;
- Chrome and Microsoft Edge (two browsers, see §9.5);
- this branch checked out with dependencies installed (`corepack pnpm install` at the repo root).

For §9.7 you also need a **Stripe test-mode** secret key (`sk_test_…`) and publishable key (`pk_test_…`). They live only in gitignored files and shell variables; you type them at a hidden prompt.

Ports used:

- `55432`: Postgres (`mf-pg` container)
- `4302`: API
- `3000`: frontend

> ⚠️ **Run every terminal command in Git Bash**, not PowerShell or Command Prompt. The commands use bash syntax (`VAR=value cmd`, `$( … )`, functions, heredocs).
>
> - **Three terminals.** You need three Git Bash windows or tabs, all started in the repo (`cd /e/advertout/MedoFlow`):
>   - **terminal 1:** backend;
>   - **terminal 2:** frontend;
>   - **terminal 3:** setup, the curl checks and the database checks.
> - **Pasting.** In the standalone Git Bash window, paste with **Shift+Insert** or right-click → **Paste**; Ctrl+V does not paste there. Paste each code block whole.

> **Git Bash on Windows: the commands call `node.exe`, not `node`, on purpose.**
>
> - In an interactive Git Bash window, `node` is an alias for `winpty node.exe`.
> - winpty refuses to run inside `$( … )` or a pipe. It prints `stdout is not a tty` and returns nothing, so the variables come out empty.
> - Keep `node.exe` when you copy these commands.

> **Use `localhost` for both apps, never a mix of `localhost` and `127.0.0.1`.** The sign-in refresh cookie only survives a page reload when the app and the API share the same host name.

> **Start the apps from an uppercase drive path** (`cd /e/advertout/MedoFlow/...`, as written below). If the terminal's directory is `e:\…` with a lowercase drive (common in VS Code), `next dev` bundles the router twice. Every page then fails with `invariant expected app router to be mounted` (§9.11).

### 9.2 One-time setup (terminal 3)

**0. Reset: start from a clean slate.** Run this every time you start the guide, including the first time.

- It stops anything left over from an earlier run.
- It deletes the previous run's throwaway files.
- It drops and recreates the dedicated manual-test database **`mf_manual`**, an empty copy just for this guide. Your dev data (`medoflow`) and the integration-test database (`mf_it`) are never touched.

First stop any backend or frontend still running from a previous session: press Ctrl+C in terminals 1 and 2. Then, in terminal 3:

```bash
cd /e/advertout/MedoFlow/backend
# Stop anything still listening on the API / frontend ports (no output = nothing was running)
powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 4302,3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue; 'stopped process ' + \$_ }"
# Remove the previous run's throwaway files
rm -f .env.manual.local uploads/.manual-seed-*.json uploads/.manual-signin-c.txt
# Drop and recreate the manual-test database
docker start mf-pg
DB=mf_manual
case "$DB" in mf_manual|mf_manual_*) ;; *) echo "✗ refusing to drop $DB — the reset only drops mf_manual*"; DB=;; esac
[ -n "$DB" ] && docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
```

Expect:

- `stopped process <pid>` for each app that was still running; nothing if none was;
- `mf-pg`;
- `DROP DATABASE`, then `CREATE DATABASE`. On the very first run, a harmless `NOTICE: database "mf_manual" does not exist, skipping` comes in between.

> **Testing against a database that already has data instead** (e.g. your `medoflow` dev database)? Skip this reset. In step 1, set `DB=medoflow`. The synthetic clinics are separate tenants and never mix with existing data.

**1. Apply the migrations and enable the app role.** Every later step uses the database chosen in step 0. That covers the API, the seed and the `psql` checks; they read it through `MANUAL_DB` in the env file.

```bash
# same terminal as step 0 (uses $DB)
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB corepack pnpm exec prisma migrate deploy
docker exec mf-pg psql -U postgres -c "ALTER ROLE medoflow_app WITH LOGIN PASSWORD 'app_local_pw'"
```

Expect:

- `All migrations have been successfully applied.`, with `20261017000000_rx_to_cart` the last one. Prisma also prints `Environment variables loaded from .env`; that is harmless, because the `DATABASE_URL` on the command line wins;
- `ALTER ROLE`.

> If you change `DB` later, re-run steps 2–4 **and** restart the backend (§9.3). Users seeded into one database cannot sign in to an API reading another one, and every login fails with `Invalid email or password`.

**2. A throwaway env file for this test.**

- `backend/.env.manual.local` is gitignored (`.env.*.local`), so it can never be committed. Your normal `backend/.env` is not touched.
- The Stripe secret key is read at a **hidden prompt**: nothing appears while you type or paste, and it never reaches the screen or your shell history.
- Press **Enter** without typing to skip it. §9.7 then cannot run; everything else can.

```bash
# still in backend/, same terminal as steps 0–1 (uses $DB)
H() { node.exe -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"; }
read -rsp "Stripe TEST secret key (sk_test_…, Enter to skip): " STRIPE_KEY; echo
case "$STRIPE_KEY" in sk_test_*|"") ;; *) echo "✗ not a test key (must start sk_test_) — ignored"; STRIPE_KEY=;; esac
cat > .env.manual.local <<EOF
# Local manual testing only (gitignored). Throwaway values.
PORT=4302
NODE_ENV=development
MANUAL_DB=${DB:?set DB first (step 1)}
DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/${DB}
CORS_ORIGIN=http://localhost:3000
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
STRIPE_SECRET_KEY=$STRIPE_KEY
STRIPE_WEBHOOK_SECRET=
MANUAL_PASSWORD=Synthetic-Manual-$(node.exe -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
EOF
unset STRIPE_KEY
# Self-check: every required value must be present and non-empty.
bad=0; for re in '^MANUAL_DB=.' '^DATABASE_URL=.*/[A-Za-z_]+$' '^JWT_SECRET=.' '^MFA_ENCRYPTION_KEY=.' \
  '^FILE_BLOB_SIGNING_SECRET=.' '^FIELD_ENCRYPTION_KEYS=k1:.' '^MANUAL_PASSWORD=Synthetic-Manual-.'; do
  grep -qE "$re" .env.manual.local || { echo "✗ missing/empty: $re"; bad=1; }
done; [ $bad = 0 ] && echo "✓ env file OK" || echo "→ fix the cause above (DB set? node.exe?) and re-run this block"
grep -q '^STRIPE_SECRET_KEY=sk_test_' .env.manual.local && echo "Stripe: test key set" || echo "Stripe: no key (§9.7 skipped)"
grep -E '^(MANUAL_DB|MANUAL_PASSWORD)=' .env.manual.local
```

Expect:

- `✓ env file OK`;
- `Stripe: test key set` or `Stripe: no key (§9.7 skipped)`;
- `MANUAL_DB=` followed by your database;
- a line like `MANUAL_PASSWORD=Synthetic-Manual-1a2b3c4d`. **This is the password of every seeded user**, browser included.

If you saw `stdout is not a tty` or `DB: set DB first`, the file is incomplete. Set `DB=mf_manual` (step 0) and re-run the whole block; it overwrites the file.

What these settings mean:

- **The API connects as `medoflow_app`**, so row-level security is enforced exactly as in production.
- **Field encryption is on** with a throwaway key.
- **No Redis.** The AI Scribe's real audio pipeline is not used. The console's _Demo: simulate conversation_ produces the same detected products.
- **No Stripe webhook secret.** The booking page tells the API about a successful payment directly (§2 #7), so `stripe listen` is not needed.

**3. Three synthetic clinics.** Each clinic has its own users and data, and the three play different roles:

| Clinic | Used for                                                   |
| ------ | ---------------------------------------------------------- |
| **A**  | the curl checks (§9.4)                                     |
| **B**  | "another tenant", and "approve without products" (B-19–21) |
| **C**  | everything in the browser (§9.5) and Stripe (§9.7)         |

```bash
set -a; . ./.env.manual.local; set +a
for c in a b c; do
  E2E_LIVE_PASSWORD=$MANUAL_PASSWORD DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$MANUAL_DB \
    corepack pnpm exec ts-node --transpile-only scripts/seed-e2e-live.ts > uploads/.manual-seed-$c.json
done
for c in a b c; do node.exe -e "const s=require('./uploads/.manual-seed-$c.json');console.log('clinic $c:', s.clinicId, Object.keys(s.products).length+' products', s.emails.patient)"; done
echo "seeded into: $MANUAL_DB"   # must match MANUAL_DB / DATABASE_URL in .env.manual.local
```

Expect three `clinic a|b|c: <id> 5 products patient.live-…@example.test` lines, then `seeded into:` followed by your database.

What each clinic gets:

- **People:**

  | Role     | Name shown in the app      | Email pattern                        |
  | -------- | -------------------------- | ------------------------------------ |
  | Admin    | Synthetic Admin            | `admin.live-<6 hex>@example.test`    |
  | Provider | **Dr. Synthetic Provider** | `provider.live-<6 hex>@example.test` |
  | Patient  | **Quinn Marlowe**          | `patient.live-<6 hex>@example.test`  |

  All three use the password `$MANUAL_PASSWORD`.

- **Catalog:**

  | Product             | SKU     | Price  | Classification               |
  | ------------------- | ------- | ------ | ---------------------------- |
  | Magnesium Glycinate | MAG-400 | $24    | Supplement                   |
  | Arnica Gel          | ARN-75  | $12.50 | OTC                          |
  | Retinol Night Serum | RET-30  | $48    | Aesthetic                    |
  | **Tramadol**        | TRAM-50 | $9     | **Prescription (scheduled)** |
  | Turmeric Curcumin   | TUR-500 | $18    | Supplement                   |

- **Visits and bookings:**
  - a completed visit with an **open note** (`rxVisitRecordId`) for the Rx→Cart flow;
  - two bookings **awaiting payment** (`payAppointmentIds`), used to save a card in §9.7.

**4. Print your browser sign-in sheet (clinic C).** This prints every login and every URL that §9.5 and §9.7 use, with clinic C's ids already filled in. Each **sign-in link** opens the login form and, after you sign in, goes straight to that page. Re-run this block whenever you need the sheet again.

```bash
set -a; . ./.env.manual.local; set +a
node.exe -e "
const s=require('./uploads/.manual-seed-c.json'), W='http://localhost:3000', P=process.env.MANUAL_PASSWORD;
const go=(p)=>W+'/?auth=login&returnUrl='+encodeURIComponent(p);
console.log('PASSWORD (every user)   '+P+'\n');
console.log('PROVIDER  '+s.emails.provider+'\n  F-1  sign-in link:  '+go('/dashboard/provider/visits/'+s.rxVisitRecordId+'/scribe')+'\n       appointment:   '+W+'/dashboard/provider/appointments/'+s.rxAppointmentId+'\n');
console.log('ADMIN     '+s.emails.admin+'\n  F-8  sign-in link:  '+go('/dashboard/products')+'\n');
console.log('PATIENT   '+s.emails.patient+'\n  F-10 sign-in link:  '+go('/clinic/'+s.clinicId+'/store')+'\n  F-12 checkout:      '+W+'/checkout'+'\n  F-15 payment #1:    '+W+'/payment/'+s.payAppointmentIds[0]+'\n  S-1  payment #2:    '+W+'/payment/'+s.payAppointmentIds[1]+'\n  F-16 billing:       '+W+'/account/billing');
" | tee uploads/.manual-signin-c.txt
```

Expect output shaped like this; your emails, ids and password differ:

```
PASSWORD (every user)   Synthetic-Manual-1a2b3c4d

PROVIDER  provider.live-9f3c21@example.test
  F-1  sign-in link:  http://localhost:3000/?auth=login&returnUrl=%2Fdashboard%2Fprovider%2Fvisits%2Fcm…%2Fscribe
       appointment:   http://localhost:3000/dashboard/provider/appointments/cm…

ADMIN     admin.live-9f3c21@example.test
  F-8  sign-in link:  http://localhost:3000/?auth=login&returnUrl=%2Fdashboard%2Fproducts

PATIENT   patient.live-9f3c21@example.test
  F-10 sign-in link:  http://localhost:3000/?auth=login&returnUrl=%2Fclinic%2Fcm…%2Fstore
  F-12 checkout:      http://localhost:3000/checkout
  F-15 payment #1:    http://localhost:3000/payment/cm…
  S-1  payment #2:    http://localhost:3000/payment/cm…
  F-16 billing:       http://localhost:3000/account/billing
```

The sheet is also saved to `backend/uploads/.manual-signin-c.txt` (gitignored). Keep it open next to the browser.

### 9.3 Start the apps

**Terminal 1 — backend**

```bash
cd /e/advertout/MedoFlow/backend
set -a; . ./.env.manual.local; set +a
corepack pnpm exec ts-node --transpile-only src/server.ts
```

Wait for these lines (30–60 s):

```
[field-encryption] keys loaded (active "k1", 1 total)
[db] connected as "medoflow_app" — row-level security is enforced
Medoflow server running on port 4302 (development)
```

These are expected and harmless:

- repeated `AggregateError … internalConnectMultiple` lines: the AI-scribe queue looking for Redis;
- `[WARN]` lines about S3 and alerts;
- `[WARN]` lines about Stripe, if you skipped the key.

**Terminal 2 — frontend**

```bash
cd /e/advertout/MedoFlow/frontend
read -rsp "Stripe TEST publishable key (pk_test_…, Enter to skip): " PK; echo
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$PK NEXT_PUBLIC_API_URL=http://localhost:4302 corepack pnpm dev
```

- Expect `✓ Ready`, then open `http://localhost:3000`.
- The first page you open takes 10–30 s to compile; later pages are faster.
- `NEXT_PUBLIC_*` values are read when the dev server starts. If you add the key later, stop it (Ctrl+C) and run the block again.

### 9.4 Backend checks with curl (terminal 3)

Paste this helper block once into terminal 3. It loads the env, reads the seed files and signs four users in. If you open a new terminal later, paste it again there: the helpers only exist in the window where you pasted them.

```bash
cd /e/advertout/MedoFlow/backend
set -a; . ./.env.manual.local; set +a
API=http://localhost:4302/api/v1
A() { node.exe -p "require('./uploads/.manual-seed-a.json').$1"; }
B() { node.exe -p "require('./uploads/.manual-seed-b.json').$1"; }
j() { node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let o=JSON.parse(d);for(const k of process.argv[1].split('.'))o=o?.[k];console.log(typeof o==='object'?JSON.stringify(o):o)})" "$1"; }
call() { local t=$1; shift; curl -s -H 'Content-Type: application/json' -H 'x-medoflow-client: web' -H "Authorization: Bearer $t" "$@"; }
code() { local t=$1; shift; curl -s -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' -H 'x-medoflow-client: web' -H "Authorization: Bearer $t" "$@"; }
login() { curl -s $API/auth/login -H 'Content-Type: application/json' -H 'x-medoflow-client: web' -d "{\"email\":\"$1\",\"password\":\"$MANUAL_PASSWORD\"}" \
  | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let o={};try{o=JSON.parse(d)}catch{};if(o.data&&o.data.accessToken)console.log(o.data.accessToken);else console.error('login failed for '+process.argv[1]+': '+(o.message||d||'no response — is the backend running on :4302?'))})" "$1"; }
lines() { call $PROV $API/rx-cart/sessions/$SID/proposal | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{for(const l of JSON.parse(d).data.proposal.lines)console.log([l.id,l.matchedProduct?.name??'('+l.rawText+')',l.quantity,l.route,l.matchStatus,l.decision].join(' | '))})"; }
line() { lines | grep "$1" | cut -d' ' -f1; }
PSQL="docker exec mf-pg psql -U postgres -d $MANUAL_DB -At -c"

PROV=$(login "$(A emails.provider)"); PAT=$(login "$(A emails.patient)")
BPROV=$(login "$(B emails.provider)"); BPAT=$(login "$(B emails.patient)")
echo "${#PROV} ${#PAT} ${#BPROV} ${#BPAT}"     # four numbers around 300 = all four signed in
```

Expect four numbers around `300` and no `login failed` line.

> Access tokens expire after 15 idle minutes. If calls start returning `401` or `undefined`, re-run the last two `…=$(login …)` lines.

**If you see `login failed for …: Invalid email or password`**, the seeded users and the running API are not using the same database or password:

- **Database.** `grep MANUAL_DB .env.manual.local` must name the database you seeded into (§9.2 step 3 printed `seeded into: …`).
- **Restart.** The backend in terminal 1 must have been (re)started **after** the env file was last written.
- **Password.** If you re-ran §9.2 step 2, `MANUAL_PASSWORD` changed. Re-run step 3 to seed users with the new password, then step 4.
- **Rate limit.** After repeated failed logins the API answers `Too many attempts. Please try again in 15 minutes.` The counter is in memory, so restarting terminal 1 clears it.

> Product ids are keyed by SKU, and SKUs contain a dash, so read them with brackets: `A "products['TUR-500']"`. Writing `A products.TUR-500` subtracts 500 and returns nothing useful.

**Detected products (B5.1)**

```bash
# B-1  provider starts a scribe session on the open visit
SID=$(call $PROV $API/ai-scribe/session/start -d "{\"visitRecordId\":\"$(A rxVisitRecordId)\"}" | j data.session.id); echo $SID
# B-2  simulate the conversation (detects magnesium, arnica, tramadol, a turmeric complex)
call $PROV -X POST $API/ai-scribe/session/$SID/simulate | j data.session.status
# B-3  the proposal
lines
PID=$(call $PROV $API/rx-cart/sessions/$SID/proposal | j data.proposal.id)
MAG=$(line Magnesium); ARN=$(line Arnica); TRAM=$(line Tramadol); TUR=$(line Turmeric)
```

| Check | Expect                                                                                                                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B-1   | a session id (`cm…`)                                                                                                                                                                                                                                         |
| B-2   | `DRAFT_GENERATED`                                                                                                                                                                                                                                            |
| B-3   | 4 lines, in this order: `Magnesium Glycinate \| 2 \| CART \| MATCHED \| PENDING`, `Arnica Gel \| 1 \| CART \| MATCHED`, `Tramadol \| 1 \| EPRESCRIBE \| MATCHED`, `(Turmeric complex) \| 1 \| MANUAL \| UNMAPPED` — the unmatched order is kept, not dropped |

**Who may see the proposal**

```bash
# B-4  a provider of clinic B: sees nothing, cannot edit
call $BPROV $API/rx-cart/sessions/$SID/proposal | j data.proposal
code $BPROV -X PUT $API/rx-cart/proposals/$PID/lines -d '{"lines":[]}'
# B-5  the patient cannot use provider endpoints
code $PAT $API/rx-cart/sessions/$SID/proposal
```

| Check | Expect             |
| ----- | ------------------ |
| B-4   | `null`, then `404` |
| B-5   | `403`              |

**Confirmation gate (B5.2) and "Approve & send" (B5.3)**

```bash
# B-6  confirmation not acknowledged
code $PROV $API/ai-scribe/session/$SID/approve -d "{\"rxConfirmation\":{\"proposalId\":\"$PID\",\"confirmedLineIds\":[\"$MAG\"],\"acknowledged\":false}}"
# B-7  confirming the unmapped line is refused — and the note is NOT approved
call $PROV $API/ai-scribe/session/$SID/approve -d "{\"rxConfirmation\":{\"proposalId\":\"$PID\",\"confirmedLineIds\":[\"$TUR\"],\"acknowledged\":true}}" | j code
call $PROV $API/ai-scribe/session/$SID | j data.session.status
# B-8  map the turmeric complex to "Turmeric Curcumin"
call $PROV -X PUT $API/rx-cart/proposals/$PID/lines -d "{\"lines\":[{\"id\":\"$TUR\",\"productId\":\"$(A "products['TUR-500']")\"}]}" > /dev/null; lines
# B-9  Approve & send: magnesium, tramadol, turmeric — arnica left out
call $PROV $API/ai-scribe/session/$SID/approve -d "{\"rxConfirmation\":{\"proposalId\":\"$PID\",\"confirmedLineIds\":[\"$MAG\",\"$TRAM\",\"$TUR\"],\"acknowledged\":true}}" | j data.session.rxCart
lines
# B-10 it cannot be sent twice
call $PROV $API/rx-cart/proposals/$PID/confirm -d '{"confirmedLineIds":[],"acknowledged":true}' | j code
```

| Check | Expect                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-6   | `400`                                                                                                                                                     |
| B-7   | `line_unmapped`, then `DRAFT_GENERATED` (whole approval rolled back)                                                                                      |
| B-8   | the 4th line is now `Turmeric Curcumin \| 1 \| CART \| MATCHED`                                                                                           |
| B-9   | `{"cartId":"…","cartItemIds":["…","…"],"prescriptionIds":["…"]}` — 2 cart items, 1 e-prescribe; then decisions `CONFIRMED, REMOVED, CONFIRMED, CONFIRMED` |
| B-10  | `proposal_closed`                                                                                                                                         |

**Patient cart (B5.3, B5.5, B5.6)**

```bash
# B-11 the patient's cart
call $PAT $API/carts | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{for(const i of JSON.parse(d).data.cart.items)console.log([i.id,i.product?.name,i.quantity,i.patientDecision,i.prescribedBy&&('Dr. '+i.prescribedBy.firstName+' '+i.prescribedBy.lastName)].join(' | '))})"
ITEM_MAG=$(call $PAT $API/carts | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.cart.items.find(i=>i.product.name.startsWith('Magnesium')).id))")
ITEM_TUR=$(call $PAT $API/carts | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.cart.items.find(i=>i.product.name.startsWith('Turmeric')).id))")
# B-12 checkout before accept/decline
call $PAT -X POST $API/carts/checkout | j code
# B-13 scope guard: tramadol cannot be added; the storefront does not list it
call $PAT $API/carts/items -d "{\"itemType\":\"PRODUCT\",\"itemId\":\"$(A "products['TRAM-50']")\",\"quantity\":1}" | j code
curl -s $API/public/clinics/$(A clinicId)/products | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.products.map(p=>p.name).join(', ')))"
# B-14 patient of clinic B tries to change / delete / decide on patient A's item
code $BPAT -X PUT $API/carts/items/$ITEM_MAG -d '{"quantity":40}'
code $BPAT -X DELETE $API/carts/items/$ITEM_MAG
code $BPAT -X PATCH $API/carts/items/$ITEM_MAG/decision -d '{"decision":"ACCEPTED"}'
# B-15 the real patient accepts magnesium, declines turmeric
code $PAT -X PATCH $API/carts/items/$ITEM_MAG/decision -d '{"decision":"ACCEPTED"}'
code $PAT -X PATCH $API/carts/items/$ITEM_TUR/decision -d '{"decision":"DECLINED"}'
```

| Check | Expect                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B-11  | 2 items: `Magnesium Glycinate \| 2 \| PENDING \| Dr. Synthetic Provider` and `Turmeric Curcumin \| 1 \| PENDING \| Dr. Synthetic Provider`; no tramadol, no arnica |
| B-12  | `RX_DECISION_REQUIRED`                                                                                                                                             |
| B-13  | `RX_ROUTE_EPRESCRIBE`, then `Arnica Gel, Magnesium Glycinate, Retinol Night Serum, Turmeric Curcumin` (no Tramadol)                                                |
| B-14  | `404` `404` `404`                                                                                                                                                  |
| B-15  | `200` `200`                                                                                                                                                        |

**Card + address on file (B5.4)**

```bash
# B-16 nothing on file yet
call $PAT $API/carts/one-click | j data.onFile
# B-17 one-click without a card falls back
call $PAT -X POST $API/carts/one-click-checkout | j code
# B-18 shipping address: invalid postcode refused, valid one saved (country upper-cased)
code $PAT -X PUT $API/carts/shipping-address -d '{"name":"Synthetic Patient","line1":"100 Example Street","city":"Testville","state":"CA","postalCode":"9$000","country":"US"}'
call $PAT -X PUT $API/carts/shipping-address -d '{"name":"Synthetic Patient","line1":"100 Example Street","city":"Testville","state":"CA","postalCode":"90000","country":"us"}' | j data.onFile.shippingAddress
```

| Check | Expect                                                                                                                                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-16  | `{"eligible":false,"reason":"NO_CARD_ON_FILE","card":null,"shippingAddress":null}`                                                                       |
| B-17  | `NO_CARD_ON_FILE`                                                                                                                                        |
| B-18  | `400`, then `{"name":"Synthetic Patient","line1":"100 Example Street","line2":null,"city":"Testville","state":"CA","postalCode":"90000","country":"US"}` |

**Approve without products, send later (clinic B)**

```bash
# B-19 approve the note with no rxConfirmation
BSID=$(call $BPROV $API/ai-scribe/session/start -d "{\"visitRecordId\":\"$(B rxVisitRecordId)\"}" | j data.session.id)
call $BPROV -X POST $API/ai-scribe/session/$BSID/simulate > /dev/null
call $BPROV -X POST $API/ai-scribe/session/$BSID/approve | j data.session.rxCart
# B-20 no cart was built; the proposal is still pending
call $BPAT $API/carts | j data.cart.items.length
BPID=$(call $BPROV $API/rx-cart/sessions/$BSID/proposal | j data.proposal.id)
call $BPROV $API/rx-cart/sessions/$BSID/proposal | j data.proposal.status
# B-21 send later: refused without acknowledgement, then sent
BARN=$(call $BPROV $API/rx-cart/sessions/$BSID/proposal | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.proposal.lines.find(l=>l.matchedProduct?.name==='Arnica Gel').id))")
code $BPROV $API/rx-cart/proposals/$BPID/confirm -d "{\"confirmedLineIds\":[\"$BARN\"]}"
call $BPROV $API/rx-cart/proposals/$BPID/confirm -d "{\"confirmedLineIds\":[\"$BARN\"],\"acknowledged\":true}" | j data.rxCart
call $BPAT $API/carts | j data.cart.items.length
```

| Check | Expect                                                                          |
| ----- | ------------------------------------------------------------------------------- |
| B-19  | `null` (approved, nothing sent)                                                 |
| B-20  | `0`, then `PENDING`                                                             |
| B-21  | `400`, then `{"cartId":"…","cartItemIds":["…"],"prescriptionIds":[]}`, then `1` |

### 9.5 Frontend checks in the browser (clinic C)

**Which browser window for whom.** The app keeps one signed-in user per browser profile, so give each persona its own window. Then you never have to sign out in the middle of a flow.

| Persona (clinic C)            | Window                                         | Checks                 |
| ----------------------------- | ---------------------------------------------- | ---------------------- |
| Provider (Synthetic Provider) | **Chrome, normal window**                      | F-1 – F-7              |
| Admin (Synthetic Admin)       | **Chrome, Incognito window** (Ctrl+Shift+N)    | F-8, F-9               |
| Patient (Quinn Marlowe)       | **Microsoft Edge** (or another Chrome profile) | F-10 – F-16, S-1 – S-5 |

In each window, keep **DevTools (F12) → Network** open with **Preserve log** ticked. If a step fails, the failing request is right there.

**How to sign in** (same for every persona):

1. Copy the persona's **sign-in link** from the sheet (§9.2 step 4) into that persona's window and press Enter.
2. The MedoFlow home page opens with a **Sign in** dialog in front of it.
3. **Work email:** paste the persona's email from the sheet, e.g. `provider.live-9f3c21@example.test`.
4. **Password:** paste the `PASSWORD (every user)` value, e.g. `Synthetic-Manual-1a2b3c4d`. It is case-sensitive, with no spaces around it.
5. Click **Sign in**.
6. You land directly on the page named in the link, e.g. the AI Scribe console.

Without a link, `http://localhost:3000/?auth=login` sends staff (provider, admin) to `/dashboard` and patients to `/`.

- **Wrong password, or a user from another database:** the dialog shows `Invalid email or password`; see §9.11.
- **Signing out:** use the avatar or name menu → **Sign out**. You only need it if you reuse a window for another persona.
- **Staying signed in:** sessions end after 15 idle minutes. The app then shows a warning and signs you out; sign in again with the same link.

**Values used below.** Every `<…>` placeholder refers to a line of the sign-in sheet:

| Placeholder         | Sheet line                    |
| ------------------- | ----------------------------- |
| `<PROVIDER link>`   | PROVIDER › `F-1 sign-in link` |
| `<appointment URL>` | PROVIDER › `appointment`      |
| `<ADMIN link>`      | ADMIN › `F-8 sign-in link`    |
| `<PATIENT link>`    | PATIENT › `F-10 sign-in link` |
| `<payment #1 URL>`  | PATIENT › `F-15 payment #1`   |
| `<payment #2 URL>`  | PATIENT › `S-1 payment #2`    |

The values you type into forms are given in full in each step.

**Provider: detected products and "Approve & send" (F5.1)** — Chrome normal window

| #   | Do                                                                                                                                                                                                                | Expect                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | Open `<PROVIDER link>` and sign in as the provider. Click **Start Documentation Session**, then **Demo: simulate conversation**. You can also reach the console from `<appointment URL>` → **AI Scribe console**. | The **AI Scribe Console** page. After the two clicks the SOAP Note Editor fills in (back stiffness), with a **Detected products** panel under the four note fields.                                                                                               |
| F-2 | Look at the panel                                                                                                                                                                                                 | Chips _Magnesium Glycinate × 2_ (CART), _Arnica Gel × 1_ (CART), _Tramadol × 1_ (E-PRESCRIBE, pill icon); an amber box "Not matched to your catalog — map it to a product, or it will not be sent" with _Turmeric complex × 1_ and a **Choose a product…** picker |
| F-3 | Look at **Approve & send** (bottom right of the editor)                                                                                                                                                           | Disabled, with "Confirm the detected products before sending" under it                                                                                                                                                                                            |
| F-4 | Click the **×** on the _Arnica Gel_ chip                                                                                                                                                                          | The chip is struck through and its button becomes ↺ (restore). The summary line reads "On approval: 1 to the patient's cart, 1 to e-prescribe (never the cart)."                                                                                                  |
| F-5 | In the amber box, open **Choose a product…** and pick **Turmeric Curcumin — $18.00**                                                                                                                              | A new chip _Turmeric Curcumin × 1_ (CART) appears, and the amber box disappears. The summary reads "On approval: 2 to the patient's cart, 1 to e-prescribe (never the cart)."                                                                                     |
| F-6 | Tick **I confirm these products for this patient**, then click **Approve & send**                                                                                                                                 | The button enables when ticked. After the click: toast "Note approved · 2 products sent to the patient's cart"                                                                                                                                                    |
| F-7 | Look at the panel again                                                                                                                                                                                           | Green "Sent: 2 to the patient's cart, 1 to e-prescribe". The note fields are read-only and the badge at the top reads **Approved**.                                                                                                                               |

**Admin: product classification (B5.5)** — Chrome Incognito window

| #   | Do                                                                                                                                                                                                                                                        | Expect                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-8 | Open `<ADMIN link>` and sign in as the admin                                                                                                                                                                                                              | The **Products** page: one card per product, each with a classification badge. _Tramadol_ shows a violet **Prescription (scheduled)**; the others read Supplement, OTC or Aesthetic. |
| F-9 | Click **Add Product** and fill the dialog: **Product Name** `Synthetic Codeine Syrup`; **Price ($)** `15`; **Classification** `Prescription (scheduled)`; **Also known as** `codeine linctus`. Leave SKU and Description empty and click **Add Product**. | Toast "Product added successfully"; a new card _Synthetic Codeine Syrup_ with **Prescription (scheduled)**                                                                           |

**Patient: cart, decisions, address (F5.2, F5.3)** — Microsoft Edge

| #    | Do                                                                                                                                                                                                                                                                                                                                                                                                              | Expect                                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-10 | Open `<PATIENT link>` and sign in as the patient                                                                                                                                                                                                                                                                                                                                                                | The clinic's storefront. Since Component 8 the old `/clinic/<id>/store` link redirects to `/s/<id>/store`, so the address bar shows that. Magnesium, Arnica, Retinol and Turmeric are listed; **no Tramadol and no Synthetic Codeine Syrup**. |
| F-11 | Click the cart icon in the clinic header (top right, labelled "Open cart")                                                                                                                                                                                                                                                                                                                                      | The cart dialog lists 2 items, each with a **Prescribed · Dr. Synthetic Provider** badge and **Accept** / **Decline** buttons. The footer shows the subtotal and **Review order**, and no "Pay with card on file" (no card yet).              |
| F-12 | Click **Review order** (it opens `/checkout`). Click **Accept** under Magnesium Glycinate, then **Decline** under Turmeric Curcumin.                                                                                                                                                                                                                                                                            | Magnesium reads "✓ Accepted". Turmeric reads "Declined — not charged" with its price struck through. The **Order Summary** card shows Total Due **$48.00**.                                                                                   |
| F-13 | Under Turmeric, click **Accept instead**, then **Decline instead**                                                                                                                                                                                                                                                                                                                                              | Total Due toggles $66.00 → $48.00                                                                                                                                                                                                             |
| F-14 | Look at the Order Summary card                                                                                                                                                                                                                                                                                                                                                                                  | No card on file, so it shows **Secure Checkout** and **Simulate Demo Payment** (the B5.4 fallback). **Do not pay yet.**                                                                                                                       |
| F-15 | Open `<payment #1 URL>`. Find **Shipping address for products your provider prescribes (optional)** and fill it in: **Full name** `Synthetic Patient`; **Address line 1** `100 Example Street`; **City** `Testville`; **State / region** `CA`; **Postal code** `9$000`; leave **Country (2 letters)** as `US`. Click **Save address**. Then change **Postal code** to `90000` and click **Save address** again. | First: "Postal code is not valid" under the field, and nothing is saved. Then: the form is replaced by "100 Example Street · Testville, CA · 90000 Change".                                                                                   |
| F-16 | Open `http://localhost:3000/account/billing`                                                                                                                                                                                                                                                                                                                                                                    | A **Card & shipping on file** card: "No card on file yet — the card you pay for a booking with is saved here.", and the address from F-15                                                                                                     |

On F-15 without Stripe keys, the payment area below the address shows **Demo: Simulate Payment** / **Confirm & Proceed** instead of a card form. That is expected; don't click them, because §9.7 needs this booking unpaid.

### 9.6 Database checks (terminal 3)

These read the tables with the **owner** role, which bypasses the app: what a database dump or backup would show. They use `$PSQL` and the helpers from §9.4.

```bash
CA=$(A clinicId)
# D-1 order text is ciphertext at rest
$PSQL "SELECT left(\"rawText\", 40) FROM \"RxOrderLine\" WHERE \"clinicId\"='$CA' LIMIT 2"
# D-2 the shipping address is ciphertext; state and card summary are plain
$PSQL "SELECT left(\"shippingLine1\", 40), \"shippingState\", \"cardLast4\" FROM \"PatientCommerceProfile\" WHERE \"clinicId\"='$CA'"
# D-3 the cart holds exactly what the provider confirmed, with the patient's decisions
$PSQL "SELECT p.name, ci.quantity, ci.\"patientDecision\" FROM \"CartItem\" ci JOIN \"Cart\" c ON c.id = ci.\"cartId\" JOIN \"Product\" p ON p.id = ci.\"productId\" WHERE c.\"clinicId\"='$CA' ORDER BY p.name"
# D-4 the scheduled Rx went to the e-prescribe queue
$PSQL "SELECT status, notes FROM \"Prescription\" WHERE \"clinicId\"='$CA' AND \"rxOrderLineId\" IS NOT NULL"
# D-5 audit trail
$PSQL "SELECT action, count(*) FROM \"AuditLog\" WHERE \"clinicId\"='$CA' AND (action LIKE 'RX_%' OR action LIKE 'CART_%' OR action LIKE '%ADDRESS%' OR action LIKE 'CARD_%') GROUP BY action ORDER BY action"
# D-6 no product names or address in audit rows (minimum necessary)
$PSQL "SELECT count(*) FROM \"AuditLog\" WHERE \"clinicId\"='$CA' AND (\"newValue\"::text ILIKE '%magnesium%' OR \"newValue\"::text ILIKE '%tramadol%' OR \"newValue\"::text ILIKE '%Example Street%')"
# D-7 catalog classification
$PSQL "SELECT name, \"fulfillmentClass\" FROM \"Product\" WHERE \"clinicId\"='$CA' ORDER BY name"
```

| Check | Expect                                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1   | `fle:v1:k1:RxOrderLine.rawText:s:…` (twice)                                                                                                         |
| D-2   | `fle:v1:k1:PatientCommerceProfile.shippin…` \| `CA` \| (empty)                                                                                      |
| D-3   | `Magnesium Glycinate\|2\|ACCEPTED` and `Turmeric Curcumin\|1\|DECLINED`                                                                             |
| D-4   | `PENDING_EPRESCRIBE\|Tramadol × 1 — routed to e-prescribe (Rx→Cart scope guard)`                                                                    |
| D-5   | `CART_ITEM_DECISION\|2`, `RX_CART_BUILT\|1`, `RX_CART_CONFIRMED\|1`, `RX_PROPOSAL_CREATED\|1`, `RX_PROPOSAL_EDITED\|1`, `SHIPPING_ADDRESS_SAVED\|1` |
| D-6   | `0`                                                                                                                                                 |
| D-7   | `Arnica Gel\|OTC`, `Magnesium Glycinate\|SUPPLEMENT`, `Retinol Night Serum\|AESTHETIC`, `Tramadol\|RX_SCHEDULED`, `Turmeric Curcumin\|SUPPLEMENT`   |

To run the same checks on clinic C after the browser steps, set `CA=$(node.exe -p "require('./uploads/.manual-seed-c.json').clinicId")` and re-run the block. D-3 then shows clinic C's decisions from F-12.

### 9.7 Real Stripe test mode: card saved at booking, one-click, decline

> ⚠️ **Not run by me.** No Stripe keys were available on the machine that validated this guide. The behaviour is covered by stubbed tests (§4.4); the expected texts below are taken from the code.

**Before you start:**

- `grep -c '^STRIPE_SECRET_KEY=sk_test_' backend/.env.manual.local` must print `1`.
- Terminal 2 must have been started with the `pk_test_…` key.
- If you skipped either:
  1. stop both apps;
  2. redo §9.2 step 2, then steps 3 and 4 (the password changes);
  3. redo §9.3.
- Use **test-mode** keys only. The setup ignores anything that does not start `sk_test_`.

**Filling in Stripe's card form.**

- On the payment page, Stripe shows a **Card** form. If you see tabs (e.g. Card / Link), pick **Card**. If Stripe offers to save the card with Link, untick it.
- Enter:
  - **Card number:** from the table below;
  - **Expiration (MM / YY):** any future date, e.g. `12 / 34`;
  - **CVC:** `123`;
  - **Country:** `United States`;
  - **ZIP:** `90000`.

| Test card number      | Behaviour                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `4242 4242 4242 4242` | Succeeds; can be charged later off session.                                                                                                                  |
| `4000 0027 6000 3184` | Always asks for 3-D Secure: a Stripe test pop-up with **Complete** / **Fail** buttons. An off-session charge is then refused with `authentication_required`. |

Run these in the **patient's Edge window**, after F-12 (magnesium accepted, turmeric declined).

| #   | Do                                                                                                                                                                                                                                                                                                        | Expect                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1 | Open `<payment #2 URL>`. Under the shipping address you see Stripe's card form and the note "Your card is saved securely with Stripe for one-click purchases…". Enter card `4000 0027 6000 3184` with the values above, click **Pay $100.00 & Confirm**, and click **Complete** in the 3-D Secure pop-up. | You land on `/intake/<id>`. Open `http://localhost:3000/account/billing`: **Card & shipping on file** shows **Visa •••• 3184**.                                                                                                                                                          |
| S-2 | Open `http://localhost:3000/checkout`                                                                                                                                                                                                                                                                     | Instead of card fields: "Ships to 100 Example Street · Testville, CA · 90000 — On file from booking", "**Visa •••• 3184** — On file from booking", a white **Pay $48.00 with card on file** button, and "Use a different card"                                                           |
| S-3 | Click **Pay $48.00 with card on file**                                                                                                                                                                                                                                                                    | Red alert: "Your bank needs you to confirm this payment. Use the regular checkout." The items stay in the cart and the button can be pressed again.                                                                                                                                      |
| S-4 | Open `<payment #1 URL>` and pay with `4242 4242 4242 4242`                                                                                                                                                                                                                                                | You land on intake. `/account/billing` now shows **Visa •••• 4242**: the newest booking card replaces the old one.                                                                                                                                                                       |
| S-5 | Open `/checkout` → **Pay $48.00 with card on file**                                                                                                                                                                                                                                                       | "You're all set!" with _Magnesium Glycinate — Qty 2 × $24.00_, total $48.00; the declined turmeric is not charged. In the Stripe dashboard (test mode) › **Payments**: a $48.00 payment. › **Customers**: the new customer has metadata `clinicId` / `patientId` only, no name or email. |
| S-6 | Run the commands below in terminal 3                                                                                                                                                                                                                                                                      | `{"brand":"visa","last4":"4242",…}`, then `FAILED\|CARD_ON_FILE\|1`, `PAID\|CARD\|2`, `PAID\|CARD_ON_FILE\|1`                                                                                                                                                                            |

```bash
# S-6 (terminal 3, backend/, helpers from §9.4 loaded)
C() { node.exe -p "require('./uploads/.manual-seed-c.json').$1"; }
PAT_C=$(login "$(C emails.patient)")
call $PAT_C $API/carts/one-click | j data.onFile.card
$PSQL "SELECT status, \"paymentMethod\", count(*) FROM \"Payment\" WHERE \"clinicId\"='$(C clinicId)' GROUP BY 1, 2 ORDER BY 1, 2"
```

### 9.8 Optional extra checks

- **Consultation room.**
  - Open `<appointment URL>/consultation` for a visit with a ready AI draft.
  - The inline "SOAP Note Draft" card has the same Detected products panel and an **Approve & send** button.
- **The automated suites.** §4.2–§4.5 run in about 10 minutes and need none of the apps above.

### 9.9 Clean up

1. Stop terminals 1 and 2 with Ctrl+C.
   - If a port stays busy on Windows, run in PowerShell: `Get-NetTCPConnection -LocalPort 4302,3000 -State Listen | % { Stop-Process -Id $_.OwningProcess }`
2. Remove the throwaway files (terminal 3):

```bash
cd /e/advertout/MedoFlow/backend
rm -f .env.manual.local uploads/.manual-seed-*.json uploads/.manual-signin-c.txt
unset MANUAL_PASSWORD PK
```

3. Drop the manual-test database (only `mf_manual`, never your dev database):

```bash
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS mf_manual WITH (FORCE)"
```

- **If you used your own dev database** (step 0 skipped): the synthetic clinics stay there, with `example.test` emails and `live-…` slugs. They are separate tenants; leave them.
- **In Stripe test mode:** you can delete the test customers from the dashboard.

Next time you start, §9.2 step 0 does all of this anyway.

### 9.10 Result sheet

| Area                                 | Checks                                    | Pass? |
| ------------------------------------ | ----------------------------------------- | ----- |
| Detected products / mapping          | B-1 – B-3, B-8 · F-1, F-2, F-5 · D-1, D-7 | ☐     |
| Isolation of proposals               | B-4, B-5                                  | ☐     |
| Confirmation gate                    | B-6, B-7, B-10, B-19 – B-21 · F-3, F-6    | ☐     |
| Approve & send builds the cart       | B-9 · F-4 – F-7 · D-3                     | ☐     |
| Scope guard                          | B-9, B-13 · F-8 – F-10 · D-4              | ☐     |
| Patient cart: provenance + decisions | B-11, B-12, B-15 · F-11 – F-13            | ☐     |
| Cart writes owner-only + audited     | B-14 · D-5, D-6                           | ☐     |
| No-card fallback                     | B-16, B-17 · F-14                         | ☐     |
| Address at booking, encrypted        | B-18 · F-15, F-16 · D-2                   | ☐     |
| Real Stripe: card saved, 3-DS, pay   | S-1 – S-6                                 | ☐     |

Tested by: \***\*\_\_\_\_\*\*** · Date: \***\*\_\_\_\_\*\*** · Branch / commit: `feat/c5-rx-cart` @ **\_\_\_\_**

### 9.11 Troubleshooting

| Symptom                                                                                      | Cause                                                                           | Fix                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Sign in dialog says **`Invalid email or password`**, or §9.4 prints `login failed for …` | The users were seeded into another database, or with an older `MANUAL_PASSWORD` | Check that `grep MANUAL_DB backend/.env.manual.local` names the database seeded in §9.2 step 3. Restart terminal 1 after any env change. If you re-ran step 2, re-run steps 3 and 4 and use the **new** sheet. |
| `Too many attempts. Please try again in 15 minutes.`                                         | Login rate limit after repeated failures                                        | Restart terminal 1 (the counter is in memory)                                                                                                                                                                  |
| Commands print nothing, `stdout is not a tty`, or ids are empty                              | `node` instead of `node.exe` inside `$( … )` or a pipe in Git Bash              | Use the blocks as written (`node.exe`)                                                                                                                                                                         |
| A curl check returns `401` or `undefined` after a while                                      | The access token expired (15 idle minutes)                                      | Re-run the `…=$(login …)` lines from §9.4                                                                                                                                                                      |
| Every page shows **`invariant expected app router to be mounted`**                           | `next dev` was started from a lowercase-drive path (`e:\…`)                     | Stop terminal 2, run `cd /e/advertout/MedoFlow/frontend && rm -rf .next`, and start it again as in §9.3                                                                                                        |
| The browser shows no products in the store, or the checkout says your cart is empty          | You are signed in as the wrong persona, or in clinic A/B                        | Check the email in the avatar menu against the **PATIENT** line of the sheet (clinic C)                                                                                                                        |
| F-1: **Start Documentation Session** is missing and the editor shows "Approved"              | That visit was already approved (e.g. you ran F-6 before)                       | Easiest: start over from §9.2 step 0. Or seed a fresh clinic C only: re-run §9.2 step 3 with `for c in c; do …`, then step 4.                                                                                  |
| F-11: no cart icon on the clinic site                                                        | You are not signed in as a patient **of this clinic**                           | Use the PATIENT sign-in link from the sheet                                                                                                                                                                    |
| S-1 shows **Demo: Simulate Payment** instead of a card form                                  | The API has no Stripe secret key, or the frontend has no publishable key        | See "Before you start" in §9.7                                                                                                                                                                                 |
| Backend won't start: `EADDRINUSE :::4302`                                                    | Another process is on 4302                                                      | Run the `powershell.exe … Stop-Process …` line from §9.2 step 0, then start terminal 1 again                                                                                                                   |
