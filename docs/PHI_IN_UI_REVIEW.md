# PHI-in-UI review (F0.3)

**Reviewed:** 2026-10-14 against branch `feat/f0-frontend-foundation` · **Scope:** every route under `frontend/app`, plus `lib/`, `components/`, `hooks/` and `contexts/` · **Sign-off:** pending (see bottom)

"PHI" follows the development plan: patient name, email, phone, DOB and address; notes, transcripts and summaries; appointments, intake answers, files and prescriptions.

## F0.3.1 — No PHI in URLs or query strings

**Rule:** paths and query strings carry opaque ids (cuid), join tokens or clinic slugs only, never a patient identifier.

| Check                                          | Result                                                                                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamic route segments (`app/**/[x]`)          | `id`, `appointmentId`, `patientId`, `serviceId`, `token`, … are all ids or opaque tokens ✓                                                                                          |
| Query params read by pages (`useSearchParams`) | `auth`, `returnUrl`, `reason`, `clinicId`, `clinic`, `providerId`, `appointmentId`, `openWebsite`, `token`, `code`/`state`/`scope` (Google OAuth) ✓                                 |
| **Fixed:** `GET /public/patients/check?email=` | The patient's email was in the API URL, where it ends up in server logs, proxies and browser history. It is now `POST /public/patients/check { email }` (backend and both callers). |
| **Fixed:** `/payment/:id?clientSecret=…`       | The Stripe PaymentIntent client secret was put in the page URL. The payment page never read it, so it has been removed.                                                             |
| Staff patient search                           | Filters client-side; no search term is sent in a URL ✓                                                                                                                              |
| `returnUrl`                                    | Contains app paths only (ids), never names or emails ✓                                                                                                                              |

**Automated guard:** `frontend/tests/unit/staticGuards.test.ts` › "F0.3.1 no PHI in URLs" fails CI on any of these:

- a query string with a PHI-named parameter (`email=`, `name=`, `phone=`, `dob=`, …);
- `URLSearchParams.set/append` or an axios `params` object with a PHI-named key;
- a dynamic segment that is not an id, token or slug.

## F0.3.2 — No PHI in client logs, toasts or thrown messages

| Check           | Result                                                                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `console.*`     | **Was** 24 calls, several logging whole Axios errors. Those errors carry the request body, the `Authorization` header and the response body. **Now** all go through `lib/clientLog.ts`, which prints only a fixed context plus `{name, status, code, masked message}`. ESLint `no-console` is an error everywhere else. |
| Toasts          | 188 call sites reviewed. Interpolated toasts show **product** names only (`Added ${item.name} to cart`); none interpolates patient data ✓                                                                                                                                                                               |
| Thrown messages | The only template-literal `throw` is `Unknown section type: ${type}` (site-builder enum) ✓. Server error messages are generic by design (B0.3.5). `lib/apiErrors.ts` maps 5xx and network failures to fixed sentences.                                                                                                  |
| Error boundary  | `DashboardErrorBoundary` logs through `clientLog` (no component stack, no props) ✓                                                                                                                                                                                                                                      |

**Automated:**

- `frontend/tests/unit/phiScrub.test.ts`: an Axios error carrying a name, email, phone, transcript and JWT logs none of them.
- ESLint `no-console` in `frontend/.eslintrc.json`.

## F0.3.3 — Client monitoring and analytics

**Today there is none:** no analytics or monitoring SDK, and no third-party script.

**Gate for the future:**

- `frontend/telemetry-allowlist.json` is empty.
- `staticGuards.test.ts` fails if a known telemetry package (Sentry, Datadog RUM, PostHog, Segment, Mixpanel, GA/GTM, Hotjar, LogRocket, FullStory, New Relic, …) or script host appears, unless it is allow-listed with a BAA reference (vendor BAA register, A.6) and `lib/phiScrub.ts#scrubPhi` as its `beforeSend`.
- `phiScrub.test.ts` › "telemetry hook contract" proves an event passed through `scrubPhi` carries no PHI.

## F0.3.4 — Minimum-necessary rendering

| View                                                                           | Fields displayed                     | Backend `select`                                                                                                                           | Result                                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Staff patients list (`/dashboard/patients`, built from `/appointments/clinic`) | name, email, visit history           | `patient: { id, name, email }`                                                                                                             | ✓ matches                                                                                                            |
| Calendars, appointment sheets, provider dashboard                              | patient name                         | `patient: { id, name, email }`                                                                                                             | ✓                                                                                                                    |
| Visit records / scribe                                                         | patient name + note content (needed) | `patient: { id, name, email }`                                                                                                             | ✓                                                                                                                    |
| **Invoices** (front desk, POS, patient billing)                                | patient name, email                  | **was `patient: true`**: the full `User` row, _including the argon2 password hash, MFA secret and recovery codes_, returned to the browser | **Fixed:** `PATIENT_SUMMARY_SELECT = { id, name, email }` on all 5 invoice queries; the payment flow is narrowed too |
| Patient portal appointment detail                                              | published summary only               | the backend nulls the SOAP fields for patients (`sanitizeVisitRecordForPatient`)                                                           | ✓, and the UI never renders internal fields (test below)                                                             |

**Automated:**

- `backend/src/tests/minimumNecessary.test.ts` fails on any new `patient: true` / `user: true` include in services or controllers, outside a three-entry, server-internal allow-list.
- `moneyAndBooking.int.test.ts` › "minimum necessary": the invoice response has only `id`/`name`/`email` and no credential field.
- `frontend/tests/components/portalPhiBoundary.test.tsx`: the portal renders the published summary only, never note sections or a transcript, even if the API sent them.

## F3.3 — Patient file names (added 2026-10-16, Component 3)

**Rule:** a patient file's original name ("Jane-Doe-HIV-result.pdf") is PHI. It is shown in the file list and used as the local download name. It is sent once, in the JSON body of the upload request, and never appears in a URL, a toast, a log line or a storage key.

| Check           | Result                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage keys    | `patient-files/<clinicId>/<patientId>/<uuid>`. **Was** `uploads/<clinic>/<patient>/<sanitised original name>-<ts>.<ext>` on local disk.             |
| Presigned URLs  | Key + signature only; downloads use `Content-Disposition: attachment` with **no** filename. The browser names the file locally with `<a download>`. |
| API routes      | `/files/:id/download-url`, `/files/patient/me/:id/download-url`: ids only.                                                                          |
| Toasts / errors | Fixed sentences ("File uploaded", "You do not have access to this file.") ✓                                                                         |
| Audit rows      | `FILE_UPLOADED` / `FILE_DELETED` record type and size, not the name.                                                                                |
| Preview         | Image `alt` / iframe `title` are "File preview", not the filename.                                                                                  |

**Automated:**

- `frontend/tests/unit/staticGuards.test.ts` › "F3.3": no URL template, string concatenation, toast or `clientLog` call carries `originalName` / `fileName` / `file.name`. It includes positive controls showing that the patterns catch violations.
- `frontend/e2e/patient-files.spec.ts`: every URL the browser requests or navigates to is checked against the filename and the patient's name and email.
- `backend/src/tests/integration/patientFiles.int.test.ts`: storage keys, upload/download URLs and audit rows never contain the filename.

## Manual pass (key flows) — to be repeated by the reviewer

For each persona (admin, provider, front desk, patient), with DevTools open (Console + Network):

1. Sign in, open the dashboard, a patient, an appointment, a visit/scribe screen, an invoice, and the patient portal.
2. **Console:** no names, emails, notes or tokens; only `[medoflow] …` summaries, if anything.
3. **Network → request URLs:** no email, name or phone in any path or query string.
4. **Toasts:** trigger an error (e.g. pay an invoice twice). The message is generic.
5. **Network → `GET /invoices/:id` response:** `patient` has only `id`, `name`, `email`.

## Sign-off

| Role                     | Name | Date | Signature |
| ------------------------ | ---- | ---- | --------- |
| Frontend reviewer        |      |      |           |
| Security/Privacy Officer |      |      |           |
