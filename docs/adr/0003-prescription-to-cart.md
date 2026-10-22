# ADR 0003 — Prescription → Cart: mapping, clinician confirmation, scope guard and card on file (B5)

**Status:** Accepted by engineering, implemented · 2026-10-17 · **Deciders:** CTO (Khush), Security Officer, Medical Director (scope guard) · **Signature:** pending (below) · **Related:** [ADR 0001](0001-phi-hosting.md), [ADR 0002](0002-field-level-encryption.md), PRD §9.1, HIPAA checklist §3.7

## Context

Prescription → Cart is the product moat. When a provider recommends products during a visit, the patient should find them in their clinic's cart, and should be able to pay in one action with the card they already used to book.

Four risks shape the design:

| Risk                                                                             | Consequence if ignored                                    |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| The AI mishears or invents a product                                             | A patient is sold something the provider never prescribed |
| An order the catalog cannot match is dropped                                     | A provider's instruction silently disappears              |
| A controlled / prescription drug reaches a frictionless cart                     | Dispensing outside the e-prescribe and pharmacy rules     |
| Card data or extra patient data reaches MedoFlow or Stripe beyond what is needed | PCI scope grows; minimum-necessary (HIPAA) is broken      |

## Decision

### 1. Mapping layer: deterministic, never drops (B5.1)

- The scribe prompt also returns `orders: [{ name, quantity }]` (appended to every template, not only the fallback prompt).
- `rxMappingService.mapOrders` matches each order against the clinic's own **active** catalog, in this order:
  1. SKU named in the order;
  2. exact name or alias (case and punctuation insensitive);
  3. a product name or alias mentioned in the order text (longest mention wins);
  4. the order is a shortened product name (`"omega 3"` → `"Omega 3 Softgels"`);
  5. token overlap (Jaccard ≥ 0.6) with dose, unit and frequency words ignored.
- A tie is `AMBIGUOUS`; no match is `UNMAPPED`. Both route to `MANUAL`.
- **Every order produces exactly one line.** Nothing is dropped; the provider sees unmatched items and can map them.
- A deterministic matcher was chosen over an LLM matcher. It is explainable and testable, it sends no catalog data to an LLM, and the clinician-confirm step catches whatever it gets wrong.

### 2. Clinician confirmation is a hard gate (B5.2)

- Detected products are stored as an `RxOrderProposal` (status `PENDING`). The order text is PHI and is sealed by field-level encryption (`RxOrderLine.rawText`, ADR 0002).
- A cart is built only from a proposal that is `CONFIRMED`, with a recorded `confirmedById` and `confirmedAt`.
  - `buildCartFromProposal` refuses anything else (`409 RX_NOT_CONFIRMED`), whoever calls it.
- Confirmation requires `acknowledged: true`. The UI sends this only after the provider ticks "I confirm these products for this patient". Lines not named in `confirmedLineIds` become `REMOVED`, and an unmapped line cannot be confirmed.
- Only the proposal's own provider can confirm it. Another provider, or another clinic, gets a 404.
- Audited:
  - `RX_PROPOSAL_CREATED`, `RX_PROPOSAL_EDITED`, `RX_CART_CONFIRMED` and `RX_CART_BUILT` record ids and counts only, never product text.
  - Patient decisions are `CART_ITEM_DECISION`.

### 3. "Approve & send" is one transaction (B5.3)

- `POST /ai-scribe/session/:id/approve` accepts an optional `rxConfirmation`.
- The note approval, the confirmation and the cart build commit together. If any step fails (e.g. an unmapped line was confirmed), the note stays unapproved.
- Approving **without** `rxConfirmation` builds no cart. The provider can still send later with `POST /rx-cart/proposals/:id/confirm`, which needs the same explicit confirmation.
- Cart items carry provenance: `rxOrderLineId` (unique, so the build is idempotent), `prescribedByProviderId` and `patientDecision`.
  - The patient must accept or decline each prescribed item before paying.
  - Declined items are never charged.
  - On the invoice, a prescribed item is attributed to the prescribing provider.

### 4. Scope guard: prescription products never reach the cart (B5.5)

- `Product.fulfillmentClass` is one of `SUPPLEMENT | OTC | AESTHETIC | RX_NON_SCHEDULED | RX_SCHEDULED`. Existing products default to `SUPPLEMENT`; clinics must reclassify their prescription items.
- `RX_*` lines are routed to `EPRESCRIBE`. The build creates a `Prescription` with status `PENDING_EPRESCRIBE` for them, never a cart item.
- **Conservative choice:** `RX_NON_SCHEDULED` is also routed to e-prescribe, not only scheduled drugs. Changing that needs a Medical Director decision.
- The same guard holds at every entry point:
  - `POST /carts/items` and every checkout refuse `RX_*` products with `422 RX_ROUTE_EPRESCRIBE`;
  - the public storefront does not list them.
- There is no e-prescribing vendor yet. The `PENDING_EPRESCRIBE` queue is the hand-off point for that integration.

### 5. Card and address on file are saved at booking (B5.4)

- The booking PaymentIntent is created with the patient's Stripe Customer and `setup_future_usage: 'off_session'`.
  - The Stripe Customer is created per clinic and patient, with **metadata ids only**: no name or email (minimum necessary).
  - Stripe's Payment Element shows the consent wording for saving the card.
- After a successful payment (the confirm call or the webhook), the card is remembered: `rememberCardFromPaymentIntent` asks **Stripe** whether the intent succeeded, then stores only the Stripe payment-method id, brand, last 4 and expiry.
  - Card data never touches MedoFlow, so PCI scope stays SAQ-A.
  - The shipping address is stored in `PatientCommerceProfile` and sealed by field-level encryption.
- One-click checkout charges the saved card off session (`off_session: true, confirm: true`, with an idempotency key per invoice).
  - `succeeded`: fulfilment runs through the same idempotent handler as the webhook, so the later webhook is a no-op.
  - Card declined or authentication required: `402`, the payment is recorded `FAILED`, the invoice is `CANCELLED` and the cart stays active.
  - No card or address on file: `409`, and the UI shows the regular Stripe Elements checkout.

## Consequences

- **+** No product reaches a patient's cart without a named clinician confirming it. The confirmation is audited and transactional with the note approval.
- **+** Scheduled and other prescription drugs cannot be bought from the cart or the storefront, whatever the client sends.
- **+** A returning patient pays in one action, and MedoFlow never handles card numbers.
- **−** Clinics must classify products. Until they do, everything is `SUPPLEMENT` (cart-eligible). Onboarding should prompt for it.
- **−** The deterministic matcher misses heavy paraphrases. These surface as `UNMAPPED` for the provider to map, which is the intended failure mode.
- **−** `Prescription.notes` (which now also records the routed product) is still plaintext, as ADR 0002 already noted. Extend field-level encryption to it in the next iteration.
- **Follow-ups:**
  - an e-prescribing vendor integration (Surescripts/DoseSpot) that consumes `PENDING_EPRESCRIBE`;
  - Stripe Customer clean-up on patient off-boarding (data lifecycle, B0.6.7);
  - a patient UI to remove the saved card.

## Evidence

- Unit:
  - `backend/src/tests/rxMapping.test.ts`: mapping correctness, no drops, ambiguity, routing.
  - `backend/src/tests/rxCartConfirm.test.ts`: confirmation gate, idempotent build.
  - `backend/src/tests/commerceValidation.test.ts`: approve and address schemas.
  - `backend/src/tests/criticalRemediation.test.ts`: the booking intent saves the card.
- Integration, real Postgres with RLS and encryption: `backend/src/tests/integration/rxCart.int.test.ts` (17 tests).
- Frontend:
  - `frontend/tests/components/rxCart.test.tsx`;
  - `frontend/e2e/rx-cart.spec.ts`;
  - the opt-in live run `frontend/e2e/live-rx-cart.spec.ts`.
- Walkthrough and manual guide: `development-log-docs/commerce-pres-cart-WALKTHROUGH-AND-VERIFICATION.md`.

## Sign-off

| Role             | Name | Date | Signature |
| ---------------- | ---- | ---- | --------- |
| CTO              |      |      |           |
| Security Officer |      |      |           |
| Medical Director |      |      |           |
