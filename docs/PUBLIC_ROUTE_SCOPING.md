# Public and optional-auth routes: scoping strategy (B0.1.4)

**Status:** reviewed 2026-10-13 against `feat/b0-backend-foundation`. **Owner:** backend.
**Re-review:** whenever a route is added under a `withPublicScope(...)` router, uses `optionalProtect`, or is mounted before `protect`.

## Why these routes are special

Most API routes run behind `protect`. `protect` puts the request in a tenant context that holds the caller's clinics. The Prisma tenant guard (`src/config/prisma.ts`) and Postgres row-level security then reject any query that touches another clinic.

The routes below run without a user, so they run in a **named bypass** (`withTenantBypass` / `withPublicScope`). The guard and RLS let their queries cross clinics. **Each handler must scope its queries itself**, and this document records how each one does it.

Rules for every handler in this list:

1. The target clinic comes from the URL or body (`:id`, `?clinicId`, `body.clinicId`), resolved to an **active** clinic. Every query names that clinic.
2. Only data meant for the public is returned: catalogue, opening hours, published site pages, free slots. No patient data and no clinical data.
3. Nothing is written except slot holds and new accounts.

## Route inventory

| Route                                                                                  | Scope                                            | How it is scoped                                                                                                                                  | Data returned                                                    | Verdict                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| `GET /public/clinics`                                                                  | `public:public_routes`                           | `isActive` clinics only                                                                                                                           | name, slug, branding                                             | ✅                                    |
| `GET /public/clinics/:id`                                                              | same                                             | `resolveClinicId(idOrSlug)` → active clinic                                                                                                       | clinic profile                                                   | ✅                                    |
| `GET /public/clinics/:id/{services,providers,locations,products,packages,memberships}` | same                                             | `where: { clinicId: <resolved>, isActive: true }`                                                                                                 | catalogue. Providers include work email (staff contact, not PHI) | ✅                                    |
| `GET /public/clinics/:id/pages/:slug`                                                  | same                                             | `sitePageService.getPublishedBySlug(clinicId, slug)`: published pages only                                                                        | page content                                                     | ✅                                    |
| `GET /public/products/:id`                                                             | same                                             | `{ id, isActive }`: a product is public catalogue data                                                                                            | product                                                          | ✅                                    |
| `GET /public/availability`, `/availability/summary`                                    | same                                             | `clinicId` is required; provider, service and location are each looked up with `clinicId` + `isActive`                                            | free slots                                                       | ✅                                    |
| `POST /public/slots/hold`, `DELETE /public/slots/hold/:holdId`                         | same                                             | `slotHoldService` checks that service and provider belong to `clinicId`. Release matches `{ id, clinicId }`                                       | hold id + expiry                                                 | 🟨 finding F-2                        |
| `POST /public/patients/check` (email in body, F0.3.1)                                  | same                                             | global `User` lookup by email                                                                                                                     | `{ exists }`                                                     | 🟨 finding F-1 (rate-limited)         |
| `GET /providers/:id/availability`                                                      | `public:provider_availability`                   | provider `{ id, isActive }`, then slots for that provider's clinic                                                                                | free slots                                                       | ✅                                    |
| `GET /consultations/join/:token`, `…/video-token`                                      | `optionalProtect` + `consultation.join_by_token` | the 64-hex join token is the capability. Only the token lookup is bypassed. Expiry is checked, and the response goes through `sanitizeForPatient` | session times, room, patient-safe fields                         | ✅                                    |
| `POST /auth/{register,login,mfa/verify,set-password,refresh-token,logout}`             | `public:auth.*`                                  | look-ups by email or hashed token only. Rate-limited                                                                                              | the caller's own session                                         | ✅                                    |
| `POST /tenants/signup`, `GET /tenants/check-subdomain`, `GET /tenants/resolve`         | `public:tenant_signup`                           | signup creates a new tenant. Resolve returns brand settings for a subdomain                                                                       | brand / availability boolean                                     | ✅                                    |
| `POST /webhooks/stripe`                                                                | `public:stripe_webhook`                          | Stripe signature on the raw body (when `STRIPE_WEBHOOK_SECRET` is set) + event-id idempotency. Handlers act on ids carried in Stripe metadata     | `{ received }`                                                   | ✅ (secret must be set in prod, B4.1) |
| `GET /health`                                                                          | none                                             | no database access                                                                                                                                | uptime, commit                                                   | ✅                                    |

## Findings

- **F-1 — account enumeration via `/public/patients/check`.** It tells an anonymous caller whether an email has a patient account on the platform. The booking flow needs it to choose between login and register, so it stays. **Mitigation (done):** `publicLookupRateLimit` allows 30 requests per 15 min per IP. **Follow-up (F1 booking UX):** drop the endpoint and run a "continue with email" step that never reveals whether the account exists.
- **F-2 — unauthenticated slot holds accept `patientId`.** An anonymous caller can attach a hold to any patient id they know. The hold's audit attribution (`performedById`) then names that patient. No data is exposed and the hold expires in 3 minutes. **Follow-up (B1.2):** ignore `patientId` from unauthenticated callers.

## Spot test

`src/tests/integration/publicRoutes.int.test.ts` calls every public read route for clinic A. It asserts that no clinic-B id appears in any response, and that cross-clinic slot-hold requests (clinic A + clinic-B provider/service/hold) are refused. It runs in CI.

## Sign-off

| Reviewer | Role | Date | Result |
| -------- | ---- | ---- | ------ |
|          |      |      |        |
