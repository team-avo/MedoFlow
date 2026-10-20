# Component 3 — Clinical records & files: walkthrough and verification

**Date:** 2026-10-16 · **Branch:** `feat/c3-clinical-records` (from `ci/deploy-env` @ `f425a30`) · **Data:** synthetic only. The PHI gate stays closed.
**Plan reference:** `arh-agent-docs/development-plan.md` › Part B › Component 3 (B3.1–B3.3, F3.1–F3.3).
**Want to check it yourself?** §9 is a step-by-step manual testing guide for the backend (API + database) and the frontend (browser), with a result sheet.

---

## 1. Outcome

| Task                                                             | AC (short)                                                                                                                                   | Status                                           | Evidence                                                                                                                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B3.1** S3 hardening                                            | Private bucket; every file access is a time-limited presigned URL that is authorised, tenant-scoped and audited; type/size validated; SSE on | ✅ (live R2 posture run is an owner step, §6)    | `patientFiles.int.test.ts` (13), `fileStorage.test.ts` (15), `scripts/ops/check-bucket-private.js`, migration `20261016000000_patient_file_upload_status` |
| **B3.2** Field-level encryption decision                         | Signed decision; if adopted, transcripts/SOAP/intake encrypted with KMS-managed keys, existing rows migrated, round-trip tested              | ✅ adopted and implemented; 🟨 signature pending | `docs/adr/0002-field-level-encryption.md`, `fieldEncryption.test.ts` (15), `fieldEncryption.int.test.ts` (6), `pnpm run ops:encrypt-phi`                  |
| **B3.3** Plans/prescriptions/intake validated + audited + scoped | Malformed input rejected by Zod; each write audited and clinic-scoped                                                                        | ✅ (was marked ✅ but had no Zod; now built)     | `clinicalRecords.int.test.ts` (31), `clinicalRecordsValidation.test.ts` (45)                                                                              |
| **F3.1** File I/O via presigned URLs                             | `PatientFilesSection` uses backend-issued presigned URLs only; no access outside authorisation                                               | ✅                                               | `fileApi.test.ts`, `patientFilesSection.test.tsx` (7), `e2e/patient-files.spec.ts` (4), live run §4.6                                                     |
| **F3.2** Records UX with Zod parity                              | Plans/prescriptions/intake render and submit with Zod parity; invalid input blocked client-side                                              | ✅                                               | `clinicalRecordsSchemas.test.ts` (shared cases), `recordsForms.test.tsx` (6), live run §4.6                                                               |
| **F3.3** No PHI filenames                                        | No PHI in file URLs or client logs                                                                                                           | ✅                                               | `staticGuards.test.ts` › F3.3 (with positive controls), URL checks in e2e and integration, `docs/PHI_IN_UI_REVIEW.md` › F3.3                              |

**Exit criteria (Universal Acceptance Standard):**

| #   | Criterion                                                        | Status                                                                                                                                             |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CI gate: typecheck, lint 0-warn, tests, audit                    | ✅ locally, every step CI runs (§4.1). The PR has not been opened yet.                                                                             |
| 2   | Tests prove the behaviour (happy path + failure cases)           | ✅ +75 backend unit, +50 backend integration, +72 frontend unit/component, +4 e2e, +2 opt-in live e2e                                              |
| 3   | No regressions                                                   | ✅ backend unit 203/203, integration 156/156 (+1 pre-existing skip), frontend 149/149, e2e 16/16 (+2 opt-in skips)                                 |
| 4   | Peer review                                                      | ⬜ reviewer (checklist §7)                                                                                                                         |
| 5   | HIPAA §2 per-change gate                                         | ✅ §7                                                                                                                                              |
| 6   | Verified in a running environment                                | ✅ the real frontend drove the real API (§4.6). Live R2 posture check is owner step §6.2.                                                          |
| 7   | No open defects / docs updated / no secrets / synthetic fixtures | ✅ (§4.7 secret sweep; fixtures check passes). Docs: ADR 0002, HIPAA checklist, retention policy, PHI-in-UI review, `.env.example`, `render.yaml`. |

**Not done here (needs you):**

- Production settings: Render env vars, the R2 CORS rule, a live R2 posture run, ADR 0002 signatures (§6).
- Nothing is committed yet.

---

## 2. Problems found and fixed

1. **Patient files lived on the API server's local disk.** `config/multer.ts` wrote them to `uploads/<clinic>/<patient>/`. On Render that disk is wiped on every deploy, and every download was streamed through the API. **Fixed:**
   - Files now go to object storage through presigned URLs only.
   - Production refuses to boot without `S3_*`.
   - Legacy rows move with `ops:migrate-patient-files` (tested).
2. **Stored XSS through uploads.** The type check matched on the prefix, so `text/html`, `image/svg+xml` and any `application/*` were accepted. They were then served back with that `Content-Type`. **Fixed:**
   - Exact allow-list.
   - On `complete`, the stored bytes must match the declared type (`utils/fileSniff.ts`). HTML disguised as text or PDF is rejected: 422, the object is deleted and an audit row is written.
   - Downloads are forced to `attachment` with `nosniff`.
3. **Files were written before the access check.** The upload wrote to disk, then checked the patient/visit, which left orphan files on failure. **Fixed:**
   - Patient and visit are checked before any URL is issued.
   - Uploads that are never completed are swept after 1 hour.
4. **Filenames (PHI) were in storage paths, audit rows and `Content-Disposition`.** **Fixed:**
   - Keys are now `patient-files/<clinic>/<patient>/<uuid>`.
   - Audit rows record type and size only.
   - Downloads are named locally by the browser (F3.3).
5. **Download auditing was uneven.** Patients produced 2 rows per download; staff produced no `READ` row and no IP/user-agent. **Fixed:** exactly one `READ` row, with IP and UA, per presigned URL issued.
6. **Frontend upload was broken.** The axios default `Content-Type: application/json` serialised the `FormData` as JSON, so the file became `{}`. **Fixed:** the new presigned flow sends JSON metadata and PUTs the raw `File`.
7. **The Files list crashed as soon as a patient had any file.** `toLocaleDateString(…, { timeStyle })` throws `TypeError: Invalid option : timeStyle`. Found by the new component test. **Fixed:** uses `toLocaleString`.
8. **Download and preview failed silently.** They used raw `fetch` with the bearer token, skipped the refresh interceptor, and had no error handling. **Fixed:**
   - The URL is requested through axios, so the refresh interceptor applies.
   - The bucket fetch sends no credentials.
   - A clear toast is shown for 403 / 404 / expired.
9. **B3.3 had never been built.**
   - None of the plan, prescription or form routes had Zod validation.
   - `createTreatmentPlan` looked the patient up **without a clinic check**, so a plan could be attached to another clinic's patient.
   - A prescription took `patientId` from the body even when it differed from the appointment's patient.
   - Prescriptions were not audited at all.
   - Plan updates audited only `status`.

   **Fixed:** all of these, with tests. Visit create and update (SOAP) also had no audit row; added (section names and version ids only, never the text).

10. **Presigned upload URLs would have been rejected by any real bucket.** Found by a unit test.
    - The AWS SDK signs a CRC32 checksum of the _empty_ presign body into the URL.
    - The SSE header is a signed header that the browser has to send.

    **Fixed:** `requestChecksumCalculation: 'WHEN_REQUIRED'`, and the API returns the exact headers to send.

11. **Smaller fixes:**
    - The 413 handler said "Audio file too large. Maximum size is 50MB." for every upload. It now applies to audio only, with the correct limit.
    - `storageService.deleteAudio` ignored the bucket named in the reference.
    - Scribe audio uploads now request SSE too.
12. **Flaky Component 1 test (pre-existing).** `scheduling.int.test.ts` › "concurrent raw INSERTs" failed about 1 run in 3 under full-suite load. Postgres sometimes resolves the 8-way race with a deadlock abort (`40P01`) instead of `23P01`. "Exactly one admitted" still held. **Fixed:** the assertion accepts `40P01` as a valid refusal.

---

## 3. What was built (files)

### Backend

| File                                                                                                                   | Change                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prisma/migrations/20261016000000_patient_file_upload_status/`                                                         | **New.** `PatientFileStatus` (PENDING/AVAILABLE/REJECTED), `uploadedAt`, index. Existing rows → AVAILABLE.                                                                                                                                                                                                                                                                           |
| `src/services/fileStorage/{types,s3Driver,localDriver,index}.ts`                                                       | **New.** Storage drivers. S3: presigned PUT (signed type, length and SSE) and GET (forced type, `attachment`, no filename), head, ranged read, delete, put. Local: HMAC-signed expiring tokens served by `/files/blob/:token` (dev/CI only; 404 in production).                                                                                                                      |
| `src/services/fileService.ts`                                                                                          | Rewritten: `createUploadIntent`, `completeUpload` (size + magic bytes), staff/patient `download-url`, narrowed listing, soft delete, `sweepStalePendingUploads`.                                                                                                                                                                                                                     |
| `src/controllers/fileController.ts`, `src/routes/files.ts`                                                             | New routes: `POST /files/uploads`, `POST /files/:id/complete`, `GET /files/:id/download-url`, `GET /files/patient/me/:id/download-url`, and the blob stand-ins. Streaming `/download` routes removed. All bodies and params go through Zod.                                                                                                                                          |
| `src/validation/fileSchemas.ts`, `src/utils/fileSniff.ts`, `src/config/fileConstants.ts`                               | **New** / rewritten: exact allow-list, URL TTL (300 s default, 900 s cap), content sniffing.                                                                                                                                                                                                                                                                                         |
| `src/config/multer.ts`                                                                                                 | **Deleted** (patient files no longer pass through the API).                                                                                                                                                                                                                                                                                                                          |
| `src/utils/fieldCrypto.ts`, `src/config/fieldKeys.ts`                                                                  | **New.** AES-256-GCM envelope with key id + column label as associated data. `env` / `aws-kms` key providers.                                                                                                                                                                                                                                                                        |
| `src/config/prisma.ts`                                                                                                 | The query extension seals writes, opens results (including nested relations) and refuses filters on encrypted columns. New `findManyAsStored` for maintenance.                                                                                                                                                                                                                       |
| `src/services/fieldEncryptionMaintenance.ts`, `src/cli/encryptPhiFields.ts`                                            | **New.** Backfill and rotation (`ops:encrypt-phi`).                                                                                                                                                                                                                                                                                                                                  |
| `src/services/patientFileMigration.ts`, `src/cli/migratePatientFiles.ts`                                               | **New.** Legacy disk → object storage (`ops:migrate-patient-files`).                                                                                                                                                                                                                                                                                                                 |
| `src/validation/clinicalRecordsSchemas.ts`                                                                             | **New.** Zod for plans, prescriptions, form templates and responses, plus `answerProblems` (answers vs template).                                                                                                                                                                                                                                                                    |
| `src/routes/{treatmentPlans,prescriptions,forms}.ts`                                                                   | `validateRequest` on every write and on id params.                                                                                                                                                                                                                                                                                                                                   |
| `src/services/{treatmentPlan,prescription,form,visit}Service.ts`, `src/controllers/{form,prescription}Controller.ts`   | Clinic-membership check for plans. Prescription patient must match the appointment. New audits: `PRESCRIPTION_CREATED`, `VISIT_RECORD_CREATED/UPDATED`. Before/after values on plan and template updates.                                                                                                                                                                            |
| `src/config/envValidation.ts`, `src/server.ts`                                                                         | Production is fatal without `S3_*` or without field-encryption keys, or with an invalid `S3_SSE`. Keys are loaded (or KMS-unwrapped) at boot.                                                                                                                                                                                                                                        |
| `src/services/{dataLifecycleService,storageService}.ts`, `src/scheduler/cronJobs.ts`, `src/middleware/errorHandler.ts` | Off-boarding deletes through the drivers. SSE on audio. `deleteAudio` bucket fix. Stale-upload sweep. 413 message fix.                                                                                                                                                                                                                                                               |
| `scripts/ops/check-bucket-private.js`                                                                                  | **New.** Live posture check: anonymous GET refused, presigned works, tampered refused, SSE / public-access block reported.                                                                                                                                                                                                                                                           |
| `scripts/seed-e2e-live.ts`                                                                                             | **New.** Synthetic clinic for the live FE↔BE check. Requires `E2E_LIVE_PASSWORD`; refuses `NODE_ENV=production`.                                                                                                                                                                                                                                                                     |
| Tests                                                                                                                  | **New:** `fileStorage.test.ts`, `fieldEncryption.test.ts`, `clinicalRecordsValidation.test.ts`, `integration/patientFiles.int.test.ts`, `integration/fieldEncryption.int.test.ts`, `integration/clinicalRecords.int.test.ts`. **Updated:** `setup.ts` (throwaway keys, local driver), `auditAndMonitoring` / `dataLifecycle` / `tenantIsolation` (new routes), `scheduling` (§2.12). |

### Frontend

| File                                                                                                         | Change                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/fileApi.ts`                                                                                             | Rewritten: presigned upload (intent → PUT with `credentials: 'omit'` → complete), `getFileDownloadUrl`, `fetchPatientFileBlob`, `downloadPatientFile` (filename applied locally).                                                                                                                                           |
| `lib/fileConstants.ts`                                                                                       | **New.** Mirror of the backend allow-list, size limit and previewable types.                                                                                                                                                                                                                                                |
| `components/PatientFilesSection.tsx`                                                                         | Client-side type/size checks with `accept`. Error toasts with no filenames. Preview dialog (role=dialog, Escape, Close). Date crash fix.                                                                                                                                                                                    |
| `lib/schemas/clinicalRecords.ts`                                                                             | **New.** Mirror of the backend schemas, form-input schemas, `buildAnswersSchema`.                                                                                                                                                                                                                                           |
| `components/records/PrescriptionForm.tsx`                                                                    | **New.** react-hook-form + Zod prescription form, used by `app/dashboard/provider/appointments/[id]/page.tsx`.                                                                                                                                                                                                              |
| `components/CreatePlanModal.tsx`, `components/forms/DynamicFormRenderer.tsx`, `app/dashboard/forms/page.tsx` | Use the shared schemas, plus a final payload check before submit.                                                                                                                                                                                                                                                           |
| `vitest.config.ts`                                                                                           | Coverage now includes the files section, records forms and intake renderer.                                                                                                                                                                                                                                                 |
| Tests                                                                                                        | **New:** `tests/unit/clinicalRecordsSchemas.test.ts`, `tests/unit/fileApi.test.ts`, `tests/components/patientFilesSection.test.tsx`, `tests/components/recordsForms.test.tsx`, `e2e/filesMock.ts`, `e2e/patient-files.spec.ts`, `e2e/live-records.spec.ts` (opt-in). **Updated:** `tests/unit/staticGuards.test.ts` (F3.3). |

**Also changed:**

- `shared/validation-cases/clinical-records.json` (**new**; read by both test suites).
- `backend/package.json` (`@aws-sdk/client-kms`, `ops:*` scripts) and `pnpm-lock.yaml`.
- `backend/.env.example`, `render.yaml` (`FIELD_ENCRYPTION_*`, `S3_SSE`).
- `.github/workflows/deploy.yml` (e2e step name).
- Docs:
  - `docs/adr/0002-field-level-encryption.md` (**new**)
  - `docs/HIPAA_COMPLIANCE_CHECKLIST.md`
  - `docs/DATA_RETENTION_POLICY.md`
  - `docs/PHI_IN_UI_REVIEW.md`

---

## 4. Verification: commands and results

Run from the repo root in Git Bash. You need Docker and pnpm. If `pnpm` is not on PATH, use `corepack pnpm …`. The backend/frontend audit scripts shell out to `pnpm`, so on such a machine put a `pnpm.cmd` containing `@corepack pnpm %*` in a gitignored folder **inside** the repo (e.g. `node_modules/.shim`) and prepend it to PATH.

### 4.0 One-time local setup

```bash
docker start mf-pg   # postgres:18 on 55432, DB mf_it, role medoflow_app (see the B0 walkthrough)
cd backend
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it pnpm exec prisma migrate deploy
# → applies 20261016000000_patient_file_upload_status
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it \
  pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
# → No difference detected.
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it
```

### 4.1 Gate commands (what CI runs)

```bash
cd backend
pnpm run typecheck                         # → clean
pnpm run lint                              # → 0 problems
node scripts/check-synthetic-fixtures.js   # → ✓ synthetic-fixture check passed (61 files scanned)
pnpm run test:coverage                     # → 17 files, 203 passed; lines 20.5 % (floor 17)
pnpm run test:integration:coverage         # → 11 files passed | 1 skipped; 156 passed | 1 skipped; statements 42.5 % (floor 33; was 37.9)
node scripts/audit-backend.js              # → ✓ no unaccepted high/critical (the KMS client adds none)

cd ../frontend
pnpm run typecheck                         # → clean
pnpm run lint                              # → ✔ No ESLint warnings or errors
pnpm run test:coverage                     # → 16 files, 149 passed; statements 32.9 %, branches 80.2 %, functions 56.7 % (floors 19/75/50)
node scripts/audit-frontend.js             # → ✓ no unaccepted high/critical
pnpm exec next build                       # → ✓ Compiled successfully
```

### 4.2 B3.1 — presigned files (backend)

```bash
cd backend
pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/patientFiles.int.test.ts
# → Tests 13 passed
#   intent → PUT → complete: PENDING until verified, opaque key (no filename), FILE_UPLOADED audit with no filename + IP
#   HTML bytes declared as PDF → 422, object deleted, REJECTED, warning audit row
#   PUT with another size or type → 403 (signed); complete before PUT → 409
#   svg / html / >10 MB / empty / "../x.pdf" refused (400) before any URL is issued
#   patients cannot upload; staff cannot upload for another clinic's patient
#   stale PENDING upload swept (object removed, REJECTED)
#   staff + patient download-url: exact bytes, attachment, nosniff, no-store, ≤ 5 min, exactly one READ row each
#   another clinic's staff / patient: 403/404, no URL issued, no READ row, delete refused
#   tampered, wrong-operation (GET URL used to PUT) and expired URLs → 403
#   soft-deleted file → 404; legacy disk file migrated to an opaque key, readable, disk copy removed, idempotent
#   the old streaming /download route is gone (404)
pnpm exec vitest run src/tests/fileStorage.test.ts
# → Tests 15 passed
#   S3 presigned PUT: X-Amz-Expires=300; signed headers include content-length, content-type, x-amz-server-side-encryption;
#     no x-amz-checksum in the URL; no filename; R2 (provider-default) sends no SSE header
#   presigned GET: response-content-type forced, response-content-disposition=attachment
#   TTL capped at 900 s; local tokens: wrong op / expired / tampered refused; path traversal refused
#   magic bytes: PDF/PNG/CSV accepted; HTML-as-PDF, HTML-as-text, NUL bytes, invalid UTF-8 refused
#   production: no S3_* → fatal; bad S3_SSE → fatal
```

### 4.3 B3.2 — field-level encryption

```bash
pnpm exec vitest run src/tests/fieldEncryption.test.ts
# → Tests 15 passed (round trip text + JSON, tamper, column swap, wrong key, rotation, null/sentinel passthrough,
#   registry vs Prisma schema, sealing of create/update/upsert/createMany, nested-result opening, filter refusal,
#   key parsing, KMS unwrap with purpose/kid encryption context, production boot refusal)
pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/fieldEncryption.int.test.ts
# → Tests 6 passed
#   SOAP via API: every column + both versions are fle:v1:… at rest; API returns plaintext incl. versions;
#     VISIT_RECORD_CREATED/UPDATED audit rows carry no note text
#   intake answers sealed at rest, original JSON to staff
#   scribe transcript/aiDraft/timeline/patientSummary and voice transcript/summary sealed; nested include opened
#   where transcript contains … → encrypted_field_filter error
#   tenant export contains plaintext, no envelopes
#   backfill: dry-run changes nothing; run seals legacy plaintext; second run = 0 changes; rotation to a new key
#     re-seals with the new kid and reads still work
```

### 4.4 B3.3 — records validation, audit, scope

```bash
pnpm exec vitest run src/tests/clinicalRecordsValidation.test.ts
# → Tests 45 passed (shared parity cases + answers vs template)
pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/clinicalRecords.int.test.ts
# → Tests 31 passed
#   every shared invalid plan / prescription / template payload → 400 and no row written
#   plan create + update → TREATMENT_PLAN_CREATED / _UPDATED with before/after (name, sessions…), fieldChanged
#   status set directly → 400; another clinic cannot read or discontinue the plan
#   plan for another clinic's patient → 403/404; another clinic's discipline → 404
#   prescription: audited (no note text in the row); patientId ≠ appointment's patient → 400;
#     another clinic's appointment → 404; another clinic's staff see none
#   template create/update audited with before/after; answers missing / wrong type / not an option /
#     required box unticked / unknown field → 400; valid → 201 + audit; patient submitting for someone else → 403;
#     another clinic's template → 404
```

### 4.5 Frontend unit, component and e2e

```bash
cd frontend
pnpm exec vitest run tests/unit/clinicalRecordsSchemas.test.ts tests/unit/fileApi.test.ts \
  tests/components/patientFilesSection.test.tsx tests/components/recordsForms.test.tsx tests/unit/staticGuards.test.ts
# → all pass (part of the 149)
#   fileApi: the API sees only JSON metadata (never the filename in a URL); PUT goes to the presigned URL with the
#     signed headers, credentials 'omit', no Authorization; a refused PUT stops before complete; a 403 on
#     download-url fetches nothing; the filename is used only as the <a download> name
#   PatientFilesSection: svg and >10 MB blocked with no request; valid upload; 403 → "You do not have access to
#     this file."; patient scope; preview opens a blob: URL and closes on Escape; failed preview → toast;
#     no toast contains the filename
#   recordsForms: blank / over-long prescription blocked, valid submitted; plan modal blocks no name /
#     0 sessions / end-before-start, then submits the API shape; intake blocks blank required + unticked consent,
#     submits valid answers
#   staticGuards F3.3: no filename in URL templates, concatenations, toasts or clientLog (with positive controls)
```

E2E (Windows: two terminals):

```bash
# terminal 1
NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 pnpm exec next build && pnpm test:e2e:serve
# terminal 2
E2E_EXTERNAL_SERVER=1 pnpm test:e2e
```

```
✓ F3.1 staff upload → list → download → preview through presigned URLs only
✓ F3.1 disallowed and oversize files are blocked before any request
✓ F3.1 a file outside the user's authorisation is refused with a clear message
✓ F3.1 a patient downloads their own file from the portal
… plus the 12 existing specs (booking, cancel/reschedule, idle, MFA, waitlist/recurring)
16 passed, 2 skipped (the opt-in live specs)
Stability: e2e/patient-files.spec.ts --repeat-each=5 → 20/20
```

Each files spec checks:

- every URL the browser requested or navigated to, against the filename and the patient's name and email;
- that bucket requests carry no `Authorization` or `Cookie`;
- that the saved download has the original filename;
- that the preview dialog passes the axe scan.

### 4.6 Live front-end ↔ back-end check (no mocks)

The real API runs on `:4302` against `mf_it`:

- connected as `medoflow_app`, so RLS applies;
- field encryption on, with a throwaway key;
- local presigned driver.

The real frontend is built against it and served on `:4310`. Secrets are generated in the shell and kept in the gitignored `backend/uploads/`.

```bash
cd backend
node.exe -e "const c=require('crypto');const h=()=>c.randomBytes(32).toString('hex');console.log('FIELD_ENCRYPTION_KEYS=live1:'+h()+'\nJWT_SECRET='+h()+'\nFILE_BLOB_SIGNING_SECRET='+h())" > uploads/.live-env
export E2E_LIVE_PASSWORD=Synthetic-Live-$(node.exe -e "process.stdout.write(require('crypto').randomBytes(6).toString('hex'))")
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it pnpm exec ts-node --transpile-only scripts/seed-e2e-live.ts > uploads/.live-seed.json
set -a; . uploads/.live-env; set +a
PORT=4302 NODE_ENV=development FIELD_ENCRYPTION_ACTIVE_KID=live1 CORS_ORIGIN=http://127.0.0.1:4310 \
  DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it S3_ACCESS_KEY_ID= S3_SECRET_ACCESS_KEY= REDIS_URL= \
  pnpm exec ts-node --transpile-only src/server.ts
# → [field-encryption] keys loaded (active "live1", 1 total) · [db] connected as "medoflow_app" — row-level security is enforced

cd ../frontend    # second terminal
NEXT_PUBLIC_API_URL=http://127.0.0.1:4302 pnpm exec next build && pnpm test:e2e:serve
# third terminal
E2E_LIVE_API=http://127.0.0.1:4302 E2E_LIVE_SEED="$(cat ../backend/uploads/.live-seed.json)" \
  E2E_LIVE_PASSWORD="$E2E_LIVE_PASSWORD" E2E_EXTERNAL_SERVER=1 pnpm exec playwright test e2e/live-records.spec.ts
```

```
✓ provider: SOAP note, file upload/download/preview, prescription, plan — against the real API (10.3s)
✓ patient: downloads their own file and submits the intake form — against the real API (6.5s)
2 passed
```

What the live run did:

- **Provider:**
  - Signed in through the UI and wrote a SOAP draft.
  - Uploaded a PNG named `Quinn-Marlowe-lab-results.png`, then downloaded it (saved under that name) and previewed it as a `blob:` URL.
  - Had an SVG refused client-side.
  - Had a blank prescription blocked, then saved a valid one.
  - Had a nameless plan blocked, then created a valid one.
- **Patient:**
  - Downloaded the file from the portal; the upload control was absent.
  - Had blank required intake answers blocked, then submitted.
- **Every `/files/blob/` request:**
  - carried no `Authorization` or `Cookie`;
  - no URL contained "quinn", "marlowe" or "lab-results".

The same clinic as stored in Postgres, read with the owner role:

| Row                                | Stored value                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VisitRecord.subjective` / `.plan` | `fle:v1:live1:VisitRecord.subje…` / `fle:v1:live1:VisitRecord.plan:…`                                                                                                                         |
| `VisitNoteVersion.subjective`      | `fle:v1:live1:VisitNoteVersion.subjective…`                                                                                                                                                   |
| `FormResponse.responses`           | `"fle:v1:live1:FormResponse.responses:j:…"`                                                                                                                                                   |
| `PatientFile`                      | `AVAILABLE`, `local:patient-files/<clinic>/<patient>/98bd3b87-…` (no filename), `image/png`, 70 bytes                                                                                         |
| `Prescription.notes`               | `Synthetic live Rx: vitamin D 1000 IU daily` (plaintext; out of B3.2 scope, ADR 0002)                                                                                                         |
| `TreatmentPlan`                    | `Synthetic live knee plan`, `ACTIVE`                                                                                                                                                          |
| Audit rows                         | `FILE_UPLOADED` 1, `READ PatientFile` 3 (2 downloads + 1 preview), `READ VisitRecord` 4, `PRESCRIPTION_CREATED` 1, `TREATMENT_PLAN_CREATED` 1, `FORM_RESPONSE_SUBMITTED` 1, `LOGIN_SUCCESS` 2 |

The `VISIT_RECORD_CREATED/UPDATED` audit was added after this live run, prompted by its result (§2.9). It is proven by `fieldEncryption.int.test.ts`.

### 4.7 No secrets in the change

- **Changed files:** all 75 changed or new files were swept for AWS keys, private keys, Stripe/Slack/GitHub tokens, 64-hex strings, JWTs and credentialed DB URLs.
  - The only hits were a pre-existing `.env.example` placeholder (`JAAS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE..."`) and two copied 64-hex test secrets.
  - Those test secrets are now generated at runtime.
- **Generated secrets:** all test keys are generated at runtime (`setup.ts`, unit tests). The live-run secrets stayed in the gitignored `backend/uploads/` and were deleted afterwards.
- **gitleaks:** not installed on this machine. CI's "Secret scan (git history)" step runs it on the PR.

### 4.8 What each flow looks like (manual click-through)

| Flow               | Where                                                              | What you should see                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload             | Provider › appointment › **Full Clinical Record** › Files › Upload | Picker limited to PDF/images/text/CSV. "File uploaded". The file appears with size, date and uploader. Network: `POST /files/uploads`, `PUT <bucket>/…` (no auth), `POST /files/:id/complete`. |
| Bad file           | Same, pick an SVG or a >10 MB file                                 | Toast "This file type is not allowed…" / "The file is larger than 10 MB." No network request.                                                                                                  |
| Download / preview | Download / Preview buttons                                         | `GET /files/:id/download-url`, then `GET <bucket>/…`. The file saves under its real name. The preview opens in a dialog and Escape closes it.                                                  |
| Patient            | Portal › appointment                                               | The same list, Download only, no Upload.                                                                                                                                                       |
| Prescription       | Provider › completed appointment › Prescriptions › Add New         | Saving blank shows "Prescription notes are required".                                                                                                                                          |
| Plan               | Provider › patient › Plans › New Protocol                          | Blank name shows "Plan name is required". End date before start is blocked.                                                                                                                    |
| Intake             | Patient › `/intake/<appointmentId>`                                | Blank required fields show "Required". Select answers must be one of the options.                                                                                                              |

---

## 5. Design notes

- **Bytes never cross an authenticated API route.**
  - The API only issues URLs and inspects objects (head + the first 4 KB).
  - The browser talks to the bucket with no credentials; the signature is the grant.
  - This removes the API from the data path (no memory spikes, no disk) and makes "every access is presigned + audited" true by construction.
- **The local driver is a faithful stand-in.**
  - Same contract as S3: one key, one operation, an expiry, and the exact type and length for PUT.
  - CI and the integration suites exercise the real flow with no bucket.
  - Production cannot use it: boot is fatal without `S3_*`, and the blob routes return 404 when `NODE_ENV=production`.
- **R2 and SSE.** R2 encrypts every object at rest (AES-256) and does not accept `x-amz-server-side-encryption`, so `render.yaml` sets `S3_SSE=provider-default`. On AWS S3 (ADR 0001 option 2/3) set `AES256` or `aws:kms` + `S3_SSE_KMS_KEY_ID`; the SSE header is then signed into every upload URL.
- **The checksum fix matters.** AWS SDK ≥ 3.729 adds a CRC32 of the empty body to presigned PUT URLs by default, which breaks every browser upload against real S3/R2. The unit test now asserts there is no `x-amz-checksum` in the URL.
- **Field encryption is transparent but explicit.**
  - It runs in the same Prisma extension as the tenant guard, so no service code changed.
  - The column label is authenticated, so a value moved to another column fails.
  - Filters on encrypted columns throw instead of silently returning nothing.
  - Seeds and raw-SQL fixtures still write plaintext, which reads fine until `ops:encrypt-phi` seals it.
- **"KMS-managed keys".** The `aws-kms` provider unwraps KMS-generated data keys at boot. The encryption context is `purpose=medoflow-field-encryption, kid=<kid>`, so the key policy and CloudTrail cover every unwrap. Until the PHI host is decided (ADR 0001), the `env` provider keeps keys in Render's secret store; switching is configuration only.
- **One audit row per file access.** The row is written when a URL is issued, which is the moment of authorisation. A URL lives at most 15 minutes and points at one object.
- **Shared validation cases instead of shared code.** The backend uses Zod 4 and the frontend Zod 3, in separate packages. A JSON case file read by both test suites is a stronger guarantee than shared code: drift fails CI on whichever side drifted.

---

## 6. What you must do manually

| #   | Who                    | Step                                                                                                                                                                                                                                                                                                                           | How to verify                                                                                                                                             |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Owner                  | **Before deploying this branch**, set these on Render: `FIELD_ENCRYPTION_KEYS=k1:$(openssl rand -hex 32)`, `FIELD_ENCRYPTION_ACTIVE_KID=k1`, `S3_SSE=provider-default`. Keep a copy of the key in the secret manager **and** with the backup keys (losing it loses the clinical text). Production boot is fatal without these. | Render log: `[field-encryption] keys loaded (active "k1", 1 total)`                                                                                       |
| 2   | Owner                  | Run the R2 posture check with the Render `S3_*` values: `node --env-file=<file with S3_*> scripts/ops/check-bucket-private.js`                                                                                                                                                                                                 | `PASS anonymous GET is refused`, `PASS presigned GET works`, `PASS tampered presigned GET is refused`, `PASS probe deleted`. Attach the output to the PR. |
| 3   | Owner                  | Add a CORS rule to the R2 bucket `medoflow-files`: AllowedOrigins = the frontend origin(s), AllowedMethods = `PUT, GET`, AllowedHeaders = `content-type`, MaxAge 3600.                                                                                                                                                         | An upload from the deployed app completes; no CORS error in DevTools.                                                                                     |
| 4   | Owner                  | After deploy, run the one-off migrations from a Render shell: `pnpm run ops:encrypt-phi -- --dry-run`, then `pnpm run ops:encrypt-phi`; and `pnpm run ops:migrate-patient-files -- --dry-run`, then the real run. Render's disk is ephemeral, so expect `missing` rows: those files were already lost on an earlier deploy.    | `ops:encrypt-phi` shows `failed: 0`, and a second run shows `sealed: 0, resealed: 0`. Migration reports `failed: []`.                                     |
| 5   | CTO + Security Officer | Read and sign `docs/adr/0002-field-level-encryption.md`.                                                                                                                                                                                                                                                                       | Signature table filled in.                                                                                                                                |
| 6   | Reviewer               | Peer review with the §7 checklist; tick the HIPAA §2 gate in the PR. Sign the F3.3 section of `docs/PHI_IN_UI_REVIEW.md`.                                                                                                                                                                                                      | PR approval.                                                                                                                                              |
| 7   | Owner (later)          | When the PHI host lands on AWS (ADR 0001): `FIELD_ENCRYPTION_PROVIDER=aws-kms` with KMS-wrapped data keys, `S3_SSE=aws:kms`. Add both to the BAA register (A.6).                                                                                                                                                               | Boot log shows keys loaded; the posture check passes `object encrypted as configured`.                                                                    |

**Declare B3 complete when** steps 1–5 are done and the posture output is attached.

---

## 7. Review checklist and HIPAA §2 per-change gate

| Item                  | Answer                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness           | Integration-tested against Postgres with RLS + enforce mode. Live run with the real frontend. Content sniffing and the size check guard `complete`.                                                                                                     |
| AuthZ                 | Upload, complete and delete are staff-only. Patient download is limited to own files in a member clinic. Plans and prescriptions keep the provider-ownership checks.                                                                                    |
| Tenant scoping        | Every file and record query is clinic-scoped. Cross-clinic upload, download, delete, plan, prescription, template and response are all refused (tests). Two scope holes fixed (§2.9).                                                                   |
| Audit                 | Upload, reject, download (READ, with IP/UA), delete, plan create/update/complete/discontinue, prescription create, template create/update, form response, visit create/update. Before/after values included; no free text or filenames in audit values. |
| PHI in logs           | No filename in any URL, log line or audit row. The CLIs print counts and ids only. Error messages are fixed sentences.                                                                                                                                  |
| PHI in URLs           | None: ids and signatures only (static guard + e2e + integration).                                                                                                                                                                                       |
| Minimum necessary     | The file listing drops `storagePath` and the uploader's email.                                                                                                                                                                                          |
| New vendor / PHI path | No new vendor. AWS KMS is an option, behind ADR 0001; it needs a BAA register entry before use. Files still go to R2, under the existing PHI gate.                                                                                                      |
| Fixtures              | Synthetic only (`example.test`, "Quinn Marlowe" is the established synthetic probe). Fixture check passes.                                                                                                                                              |

---

## 8. Known limits and open items

- **Not field-encrypted:**
  - Out of scope: prescription notes and treatment-plan goals/notes. They are the candidates for the next iteration (ADR 0002).
  - Still plaintext by design: file names, patient names and emails.
- **No search over encrypted text.** Any future search feature needs an application-side index under the BAA (ADR 0002).
- **Keys are now critical data.** Restore drills (B0.6.4) must restore the field-encryption key along with the database.
- **The preview iframe is not sandboxed.** Chromium refuses to render PDFs in a sandboxed frame. The blob is typed `application/pdf` and its bytes were verified as PDF on `complete`, so no HTML can execute there. Images use `<img>`.
- **The KMS provider is unit-tested against a stub.** It has not run against real AWS KMS; that happens with step 7.
- **`CreatePlanModal` edit (pre-existing behaviour).** When sessions completed reaches the total, the modal calls `/complete` instead of saving the other edits, so those edits are dropped. Left unchanged here. The API alone would save them and auto-complete.
- **The live check uses the local driver.** It does not exercise R2 itself. R2 presigned PUT/GET is covered by the posture script (step 2), together with the earlier D0.4 evidence.
- **Live seed data stays in `mf_it`.** The synthetic live-check clinics remain in the local integration database (harmless; recreate `mf_it` to start clean).

---

## 9. Manual local testing guide

Follow this guide to check by hand that every Component 3 function works on your machine, both backend and frontend. It takes about 45 minutes.

- **Validated:** every backend command and expected result below was run on 2026-10-16 against this branch. The browser steps follow the same flows the live Playwright run (§4.6) passed.
- **Data:** synthetic only. Nothing here touches a real database, bucket or patient.

Each check has an id (`B-…` backend API, `F-…` frontend browser, `D-…` database). Tick them off in the **result sheet (§9.10)**. Any ✗ is a defect.

**What you will test**

| Function                                                               | Backend     | Frontend               | Database  |
| ---------------------------------------------------------------------- | ----------- | ---------------------- | --------- |
| Upload a patient file through a presigned URL                          | B-1 – B-4   | F-3, F-4               | D-3       |
| Reject bad files (type, size, fake content, wrong size/type on PUT)    | B-5 – B-7   | F-5                    | D-3       |
| Download / preview through a short-lived presigned URL                 | B-8 – B-10  | F-6, F-7               | D-4       |
| Who can access a file (patient, other clinic)                          | B-11 – B-14 | F-12, F-15             | —         |
| No filenames / PHI in URLs or audit rows                               | B-3, B-8    | F-9                    | D-3, D-5  |
| Prescriptions, plans, intake forms validated + audited + clinic-scoped | B-15 – B-19 | F-10, F-11, F-13, F-14 | D-4       |
| SOAP notes / intake answers encrypted at rest, plain text in the app   | B-20, B-21  | F-2                    | D-1, D-2  |
| Backfill + key rotation of encrypted fields                            | —           | —                      | D-6 – D-8 |
| Production refuses unsafe settings                                     | §9.8        | —                      | —         |

### 9.1 Before you start

You need:

- Docker Desktop running;
- Node 20;
- Git Bash;
- Chrome;
- this branch checked out with dependencies installed (`corepack pnpm install` at the repo root).

Use `corepack pnpm` wherever `pnpm` is not on your PATH.

Ports used:

- `55432`: Postgres (`mf-pg` container)
- `4302`: API
- `3000`: frontend

Windows reserves 3001 and 3100, so the API does not use them.

> **Use `localhost` for both apps, never a mix of `localhost` and `127.0.0.1`.** The sign-in refresh cookie only survives a page reload when the app and the API share the same host name.

> **Git Bash on Windows: the commands below call `node.exe`, not `node`, on purpose.**
>
> - In an interactive Git Bash window, `node` is an alias for `winpty node.exe`.
> - winpty refuses to run inside `$( … )` or a pipe; it prints `stdout is not a tty` and returns nothing.
> - Keep `node.exe` when you copy these commands. Running `node` directly at the prompt (outside `$( … )` and pipes) is fine.

### 9.2 One-time setup (Git Bash)

**1. Database.** Choose the database once. **Every later step (API, seed, `psql` checks) uses the database you choose here**, through `MANUAL_DB` in the env file.

- `mf_it` is the integration-test database (B0 walkthrough §4.0 creates it).
- To use your own dev database, e.g. one holding demo data, set `DB=medoflow` instead.

Any database in the `mf-pg` container works, as long as the `medoflow_app` role can log in to it.

```bash
docker start mf-pg
cd backend
DB=mf_it        # ← or DB=medoflow (your demo-data database), etc.
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB corepack pnpm exec prisma migrate deploy
# Expect: "No pending migrations to apply." (or it applies 20261016000000_patient_file_upload_status)
```

> If you change `DB` later, re-run steps 2 and 3 **and** restart the backend (§9.3). Users seeded into one database cannot sign in to an API reading another one: every login fails with `Invalid email or password`.

**2. A throwaway env file for this test.** `backend/.env.manual.local` is gitignored (`.env.*.local`), so it can never be committed. Your normal `backend/.env` is not touched.

```bash
# still in backend/, same window as step 1 (uses $DB)
H() { node.exe -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"; }
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
MANUAL_PASSWORD=Synthetic-Manual-$(node.exe -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
EOF
# Self-check: every required value must be present and non-empty.
bad=0; for re in '^MANUAL_DB=.' '^DATABASE_URL=.*/[A-Za-z_]+$' '^JWT_SECRET=.' '^MFA_ENCRYPTION_KEY=.' \
  '^FILE_BLOB_SIGNING_SECRET=.' '^FIELD_ENCRYPTION_KEYS=k1:.' '^MANUAL_PASSWORD=Synthetic-Manual-.'; do
  grep -qE "$re" .env.manual.local || { echo "✗ missing/empty: $re"; bad=1; }
done; [ $bad = 0 ] && echo "✓ env file OK" || echo "→ fix the cause above (DB set? node.exe?) and re-run this block"
grep -E '^(MANUAL_DB|MANUAL_PASSWORD)=' .env.manual.local   # ← database + the password of every seeded user
```

Expect:

- `✓ env file OK`;
- `MANUAL_DB=` followed by the database you chose;
- a password line like `MANUAL_PASSWORD=Synthetic-Manual-1a2b3c4d`.

If you saw `stdout is not a tty` or `DB: set DB first`, the file is incomplete. Set `DB` (step 1) and re-run the whole block: it overwrites the file.

What these settings mean:

- **The API connects as `medoflow_app`**, so row-level security is enforced exactly as in production.
- **The S3 keys are empty.** Files therefore use the _local presigned-URL driver_: same contract as S3, served under `/api/v1/files/blob/<signed token>`, stored in `backend/uploads/patient-files/`.
- **To test against a real bucket instead**, fill in `S3_*` (plus `S3_SSE=provider-default` for R2) and add the CORS rule from §6 step 3. The steps below are the same; the upload/download URLs then point at the bucket.

**3. Two synthetic clinics.** Clinic **A** is where you work; clinic **B** is "another tenant".

```bash
set -a; . ./.env.manual.local; set +a
for c in a b; do
  E2E_LIVE_PASSWORD=$MANUAL_PASSWORD DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$MANUAL_DB \
    corepack pnpm exec ts-node --transpile-only scripts/seed-e2e-live.ts > uploads/.manual-seed-$c.json
done
cat uploads/.manual-seed-a.json
echo "seeded into: $MANUAL_DB"   # must match the database the API uses (DATABASE_URL in .env.manual.local)
# Expect one JSON line: clinicId, appointmentId, templateId, disciplineId, patientId, emails{admin,provider,patient}
```

What each clinic gets:

- an **admin**, a **provider** and a **patient** "Quinn Marlowe" (`…@example.test`), all with the password `$MANUAL_PASSWORD`;
- a **COMPLETED** appointment from yesterday;
- an intake form: _Reason for visit_ (required), _Age_ (number), _I consent to treatment_ (required checkbox).

### 9.3 Start the apps

**Terminal 1 — backend**

```bash
cd backend
set -a; . ./.env.manual.local; set +a
corepack pnpm exec ts-node --transpile-only src/server.ts
```

Wait for these lines (30–60 s):

```
[field-encryption] keys loaded (active "k1", 1 total)
[db] connected as "medoflow_app" — row-level security is enforced
Medoflow server running on port 4302 (development)
```

Two kinds of output are expected and harmless here:

- repeated `AggregateError … internalConnectMultiple` lines: the AI-scribe queue looking for Redis, which this test does not need;
- `[WARN]` lines about Stripe, S3 and alerts.

**Terminal 2 — frontend**

```bash
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:4302 corepack pnpm dev
# Expect "Ready", then open http://localhost:3000
```

### 9.4 Backend checks with curl (terminal 3)

Paste this helper block once into a new Git Bash window. It loads the env, reads the seed files and signs three users in.

```bash
cd backend
set -a; . ./.env.manual.local; set +a
API=http://localhost:4302/api/v1
JSON='content-type: application/json'
A() { node.exe -pe "require('./uploads/.manual-seed-a.json').$1"; }
B() { node.exe -pe "require('./uploads/.manual-seed-b.json').$1"; }
j() { node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(eval('o.'+process.argv[1]))})" "$1"; }
code() { curl -s -o /dev/null -w "%{http_code}\n" "$@"; }
login() { curl -s $API/auth/login -H "$JSON" -d "{\"email\":\"$1\",\"password\":\"$MANUAL_PASSWORD\"}" \
  | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let o={};try{o=JSON.parse(d)}catch{};if(o.data&&o.data.accessToken)console.log(o.data.accessToken);else console.error('login failed for '+process.argv[1]+': '+(o.message||d||'no response — is the backend running on :4302?'))})" "$1"; }
PROV=$(login "$(A emails.provider)"); PAT=$(login "$(A emails.patient)"); BADM=$(login "$(B emails.admin)")
echo "${#PROV} ${#PAT} ${#BADM}"    # three numbers around 300 = all signed in
```

> Sessions expire after 15 idle minutes. If calls start returning `401`, re-run the `PROV=… PAT=… BADM=…` line.

**If you see `login failed for …: Invalid email or password`**, the seeded users and the running API are not using the same database or password:

- **Database.** `grep MANUAL_DB .env.manual.local` must name the database you seeded into (§9.2 step 3 printed `seeded into: …`).
- **Restart.** The backend in terminal 1 must have been (re)started **after** the env file was last written.
- **Password.** If you re-ran §9.2 step 2, `MANUAL_PASSWORD` changed, so re-run step 3 to seed users with the new password.
- **Rate limit.** After repeated failed logins the API answers `login failed …: {"success":false,"error":"Too many attempts. Please try again in 15 minutes."}`, even with the right password. The counter is in memory, so restarting the backend (terminal 1) clears it.

**Files: upload (B-1 – B-4)**

```bash
printf '%%PDF-1.7\n%% synthetic\n%%%%EOF\n' > uploads/manual-test.pdf
SIZE=$(wc -c < uploads/manual-test.pdf)

# B-1 ask for an upload URL
INTENT=$(curl -s $API/files/uploads -H "authorization: Bearer $PROV" -H "$JSON" \
  -d "{\"patientId\":\"$(A patientId)\",\"fileName\":\"Quinn-Marlowe-labs.pdf\",\"mimeType\":\"application/pdf\",\"size\":$SIZE}")
echo "$INTENT" | head -c 200; echo
FID=$(echo "$INTENT" | j data.fileId); UPLOAD=$(echo "$INTENT" | j data.uploadUrl); echo "$UPLOAD"

# B-2 not listed yet (PENDING)
curl -s $API/files/patient/$(A patientId) -H "authorization: Bearer $PROV" | grep -c "$FID"

# B-3 PUT the bytes straight to the presigned URL — note: no Authorization header
code -X PUT "$UPLOAD" -H 'content-type: application/pdf' --data-binary @uploads/manual-test.pdf

# B-4 complete → now listed
curl -s -X POST $API/files/$FID/complete -H "authorization: Bearer $PROV"; echo
curl -s $API/files/patient/$(A patientId) -H "authorization: Bearer $PROV" | head -c 400; echo
```

| Check | Expect                                                                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-1   | `"message":"Upload URL issued"` with `fileId`, `uploadUrl`, `"method":"PUT"`, `headers`, `expiresAt` about 5 min ahead                                         |
| B-2   | `0`                                                                                                                                                            |
| B-3   | `200`. The printed upload URL is `…/files/blob/<long token>` and **does not contain "Quinn" or "labs"**.                                                       |
| B-4   | `{"success":true,"message":"File uploaded",…}`. The listing shows `"originalName":"Quinn-Marlowe-labs.pdf"`, but **no `storagePath` and no uploader `email`**. |

**Files: refusals (B-5 – B-7)**

```bash
# B-5 disallowed type / oversize refused before any URL is issued
code $API/files/uploads -H "authorization: Bearer $PROV" -H "$JSON" \
  -d "{\"patientId\":\"$(A patientId)\",\"fileName\":\"x.svg\",\"mimeType\":\"image/svg+xml\",\"size\":10}"
code $API/files/uploads -H "authorization: Bearer $PROV" -H "$JSON" \
  -d "{\"patientId\":\"$(A patientId)\",\"fileName\":\"big.pdf\",\"mimeType\":\"application/pdf\",\"size\":20000000}"

# B-6 HTML disguised as a PDF is caught at "complete"
printf '<!doctype html><script>alert(1)</script>' > uploads/manual-fake.pdf
I=$(curl -s $API/files/uploads -H "authorization: Bearer $PROV" -H "$JSON" \
  -d "{\"patientId\":\"$(A patientId)\",\"fileName\":\"fake.pdf\",\"mimeType\":\"application/pdf\",\"size\":$(wc -c < uploads/manual-fake.pdf)}")
FAKE=$(echo "$I" | j data.fileId)
code -X PUT "$(echo "$I" | j data.uploadUrl)" -H 'content-type: application/pdf' --data-binary @uploads/manual-fake.pdf
curl -s -X POST $API/files/$FAKE/complete -H "authorization: Bearer $PROV" | head -c 110; echo

# B-7 an upload URL accepts only the exact type and size it was signed for
I=$(curl -s $API/files/uploads -H "authorization: Bearer $PROV" -H "$JSON" \
  -d "{\"patientId\":\"$(A patientId)\",\"fileName\":\"a.pdf\",\"mimeType\":\"application/pdf\",\"size\":$SIZE}")
U=$(echo "$I" | j data.uploadUrl)
code -X PUT "$U" -H 'content-type: image/png' --data-binary @uploads/manual-test.pdf
code -X PUT "$U" -H 'content-type: application/pdf' --data-binary @uploads/manual-fake.pdf
```

| Check | Expect                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-5   | `400`, `400`                                                                                                                                                                    |
| B-6   | The PUT is `200` (bytes arrive), then `complete` returns `{"success":false,"message":"The file content does not match its type"…` (HTTP 422, `"code":"file_content_mismatch"`). |
| B-7   | `403`, `403`                                                                                                                                                                    |

**Files: download (B-8 – B-10)**

```bash
# B-8 staff download URL → exact bytes, served as an attachment
DL=$(curl -s $API/files/$FID/download-url -H "authorization: Bearer $PROV" | j data.url); echo "$DL"
curl -s -D - -o uploads/manual-dl.pdf "$DL" | grep -iE "^HTTP|content-type|content-disposition|nosniff|cache-control"
cmp uploads/manual-test.pdf uploads/manual-dl.pdf && echo "bytes identical"

# B-9 a tampered URL, and a download URL used to upload, are refused
code "${DL%?????}AAAAA"
code -X PUT "$DL" -H 'content-type: application/pdf' --data-binary @uploads/manual-test.pdf

# B-10 the old streaming route is gone
code $API/files/$FID/download -H "authorization: Bearer $PROV"
```

| Check | Expect                                                                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-8   | `HTTP/1.1 200 OK`, `Content-Type: application/pdf`, `Content-Disposition: attachment` (**no filename**), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, then `bytes identical`. The URL contains no filename. |
| B-9   | `403`, `403`                                                                                                                                                                                                                 |
| B-10  | `404`                                                                                                                                                                                                                        |

**Files: who may access (B-11 – B-14)**

```bash
# B-11 the patient can get their own file
curl -s $API/files/patient/me/$FID/download-url -H "authorization: Bearer $PAT" | head -c 80; echo
# B-12 a patient cannot upload
code $API/files/uploads -H "authorization: Bearer $PAT" -H "$JSON" \
  -d "{\"patientId\":\"$(A patientId)\",\"fileName\":\"x.pdf\",\"mimeType\":\"application/pdf\",\"size\":10}"
# B-13 clinic B's admin cannot list, download or delete clinic A's file
curl -s $API/files/patient/$(A patientId) -H "authorization: Bearer $BADM" | head -c 120; echo
code $API/files/$FID/download-url -H "authorization: Bearer $BADM"
code -X DELETE $API/files/$FID -H "authorization: Bearer $BADM"
# B-14 staff cannot upload for another clinic's patient
code $API/files/uploads -H "authorization: Bearer $PROV" -H "$JSON" \
  -d "{\"patientId\":\"$(B patientId)\",\"fileName\":\"x.pdf\",\"mimeType\":\"application/pdf\",\"size\":10}"
```

| Check | Expect                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------- |
| B-11  | `{"success":true,"message":"Download URL issued"…`                                                 |
| B-12  | `403`                                                                                              |
| B-13  | The list is empty (`"files":[]`) or refused, **never A's file**. Download-url `404`, delete `404`. |
| B-14  | `403` (or `404`)                                                                                   |

**Clinical records (B-15 – B-21)**

```bash
# B-15 prescription: blank refused, valid saved
curl -s $API/prescriptions -H "authorization: Bearer $PROV" -H "$JSON" -d "{\"appointmentId\":\"$(A appointmentId)\",\"notes\":\"  \"}" | head -c 90; echo
code $API/prescriptions -H "authorization: Bearer $PROV" -H "$JSON" -d "{\"appointmentId\":\"$(A appointmentId)\",\"notes\":\"Synthetic manual Rx: vitamin D\"}"
# B-16 a prescription cannot name a patient other than the appointment's
code $API/prescriptions -H "authorization: Bearer $PROV" -H "$JSON" -d "{\"appointmentId\":\"$(A appointmentId)\",\"patientId\":\"$(B patientId)\",\"notes\":\"x\"}"
# B-17 treatment plan: malformed refused (all reasons listed), valid created
curl -s $API/treatment-plans -H "authorization: Bearer $PROV" -H "$JSON" \
  -d "{\"patientId\":\"$(A patientId)\",\"disciplineId\":\"$(A disciplineId)\",\"name\":\"\",\"totalSessions\":0,\"startDate\":\"2026-10-01\"}" | head -c 110; echo
code $API/treatment-plans -H "authorization: Bearer $PROV" -H "$JSON" \
  -d "{\"patientId\":\"$(A patientId)\",\"disciplineId\":\"$(A disciplineId)\",\"name\":\"Synthetic manual plan\",\"totalSessions\":6,\"startDate\":\"2026-10-01\"}"
# B-18 a plan cannot be attached to another clinic's patient
code $API/treatment-plans -H "authorization: Bearer $PROV" -H "$JSON" \
  -d "{\"patientId\":\"$(B patientId)\",\"disciplineId\":\"$(A disciplineId)\",\"name\":\"P\",\"totalSessions\":1,\"startDate\":\"2026-10-01\"}"
# B-19 intake: answers that break the template refused, valid answers saved
curl -s $API/forms/respond -H "authorization: Bearer $PAT" -H "$JSON" \
  -d "{\"templateId\":\"$(A templateId)\",\"responses\":{\"age\":\"forty\",\"consent\":false}}" | head -c 140; echo
code $API/forms/respond -H "authorization: Bearer $PAT" -H "$JSON" \
  -d "{\"templateId\":\"$(A templateId)\",\"responses\":{\"reason\":\"Synthetic knee pain\",\"age\":40,\"consent\":true}}"
# B-20 a SOAP note (used by the encryption checks in §9.6)
curl -s $API/visits -H "authorization: Bearer $PROV" -H "$JSON" \
  -d "{\"appointmentId\":\"$(A appointmentId)\",\"subjective\":\"Synthetic manual S: knee pain\",\"plan\":\"Synthetic manual P: rest\"}" | head -c 80; echo
# B-21 the API returns it as plain text
VID=$(curl -s $API/visits/appointment/$(A appointmentId) -H "authorization: Bearer $PROV" | j data.visitRecord.id)
curl -s $API/visits/$VID -H "authorization: Bearer $PROV" | grep -o '"subjective":"[^"]*"' | head -1
```

| Check | Expect                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------- |
| B-15  | `{"success":false,"message":"Prescription notes are required"…` then `201`                                    |
| B-16  | `400`                                                                                                         |
| B-17  | `…"message":"Plan name is required, At least 1 session required"…` then `201`                                 |
| B-18  | `403`                                                                                                         |
| B-19  | `…"Reason for visit is required, Age must be a number, I consent to treatment is required"…` then `201`       |
| B-20  | `{"success":true,"message":"Visit record created"…` (a re-run gives `409` "already exists", which is correct) |
| B-21  | `"subjective":"Synthetic manual S: knee pain"`                                                                |

Error bodies include a `stack` field only because `NODE_ENV=development`. Production returns fixed messages.

### 9.5 Frontend checks in the browser

Open Chrome at `http://localhost:3000`. Keep **DevTools → Network** open for the whole test with **Preserve log** ticked; you search it at F-9.

To sign in, open `http://localhost:3000/?auth=login`, enter the user's email from `uploads/.manual-seed-a.json` and `$MANUAL_PASSWORD`, then click **Sign in**. Sign out (avatar menu) before switching user.

Replace `<appointmentId>` and `<patientId>` with clinic A's values (`cat uploads/.manual-seed-a.json`).

**As clinic A's provider**

| #    | Do                                                                                                                         | Expect                                                                                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1  | Open `/dashboard/provider/appointments/<appointmentId>`                                                                    | The appointment page loads (status Completed).                                                                                                                                                                                                      |
| F-2  | **Start manual note**, or **Edit manually** if B-20 already made one → type a Subjective line → **Save draft** → **Close** | The note text is shown on the page. (In the database it is ciphertext, D-1.)                                                                                                                                                                        |
| F-3  | **Full Clinical Record** → **Files** tab                                                                                   | The list shows the file from B-4 with size, date and "Synthetic Provider". It does not crash.                                                                                                                                                       |
| F-4  | Rename a small PNG or PDF on your disk to e.g. `Quinn-Marlowe-xray.png` → **Upload** → pick it                             | Toast **"File uploaded"**; the file is listed. Network shows `POST …/files/uploads` → `PUT …/files/blob/…` → `POST …/files/<id>/complete`. Click the PUT row: its request headers have **no `Authorization`** and no cookie.                        |
| F-5  | **Upload** an `.svg` file, then a PDF larger than 10 MB                                                                    | Toast **"This file type is not allowed…"**, then **"The file is larger than 10 MB."** No new request appears in Network for either. The picker itself offers only PDF / images / text / CSV.                                                        |
| F-6  | **Download** on your uploaded file                                                                                         | The browser saves it under its **original name** and it opens. Network: `GET …/download-url`, then `GET …/files/blob/…`.                                                                                                                            |
| F-7  | **Preview** on an image or PDF                                                                                             | A dark overlay shows the file. **Escape** (or **Close**) closes it. Text/CSV files have no Preview button.                                                                                                                                          |
| F-8  | Look for a Delete button                                                                                                   | None in the clinical record (delete is disabled there by design; covered by B-13 and the integration tests).                                                                                                                                        |
| F-9  | In Network, type `Quinn`, then `Marlowe`, then `xray` into the filter box                                                  | **No request URL matches any of them.** The filename only travels inside the JSON body of `POST /files/uploads`.                                                                                                                                    |
| F-10 | Close the sheet → **Prescriptions** → **Add New** → **Save Prescription** with the box empty, then with spaces only        | Red **"Prescription notes are required"**, and no `POST /prescriptions` appears in Network. Then type a prescription → **Save Prescription** → toast **"Prescription added"** and it is listed.                                                     |
| F-11 | Open `/dashboard/provider/patients/<patientId>/plans` → **New Protocol** → **Create Plan** with an empty name              | **"Plan name is required"**, no request. Also try an End Date before the Start Date: **"End date cannot be before start date"**. Then fill a name, pick Discipline **Physiotherapy**, 6 sessions → **Create Plan** → the plan appears under Active. |

**As clinic A's patient** (sign out first)

| #    | Do                                                                                                                            | Expect                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| F-12 | Open `/account/appointments/<appointmentId>`                                                                                  | The Files card lists your files with **Download** only, **no Upload**. Download saves the file under its original name. |
| F-13 | Open `/intake/<appointmentId>` → **Submit** with nothing filled; then type only spaces in _Reason for visit_ and submit again | **"Required"** under _Reason for visit_ and _I consent to treatment_ both times; nothing is sent.                       |
| F-14 | Fill _Reason for visit_, tick _I consent_, leave _Age_ empty → **Submit**                                                     | The form completes. (In the database the answers are ciphertext, D-2.)                                                  |

**Cross-tenant in the browser** (optional; B-13 already proves it at the API)

| #    | Do                                                                                                                                                | Expect                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| F-15 | Sign in as clinic **B**'s admin (email in `uploads/.manual-seed-b.json`) and open clinic A's `/dashboard/provider/appointments/<A appointmentId>` | You must **not** see clinic A's patient, note or files: an error / not-found state only. |

### 9.6 Database checks (terminal 3)

These read the tables with the **owner** role, which bypasses the app: what a database dump or backup would show.

```bash
CID=$(A clinicId)
PSQL="docker exec mf-pg psql -U postgres -d $MANUAL_DB -At -c"

# D-1 SOAP note and its version are ciphertext
$PSQL "select left(subjective,45), left(plan,30) from \"VisitRecord\" where \"clinicId\"='$CID'"
$PSQL "select left(v.subjective,45) from \"VisitNoteVersion\" v join \"VisitRecord\" r on r.id=v.\"visitRecordId\" where r.\"clinicId\"='$CID'"
# D-2 intake answers are ciphertext
$PSQL "select left(responses::text,45) from \"FormResponse\" where \"clinicId\"='$CID'"
# D-3 files: opaque key + verification status; bytes on disk carry no filename
$PSQL "select status, \"storagePath\", \"originalName\" from \"PatientFile\" where \"clinicId\"='$CID'"
ls -R uploads/patient-files/$CID
# D-4 audit trail
$PSQL "select action, \"entityType\", count(*) from \"AuditLog\" where \"clinicId\"='$CID' group by 1,2 order by 1"
# D-5 no filename or note text inside any audit row
$PSQL "select count(*) from \"AuditLog\" where \"clinicId\"='$CID' and (coalesce(\"newValue\"::text,'')||coalesce(\"oldValue\"::text,'')) ~* '(quinn|knee|vitamin)'"
```

| Check | Expect                                                                                                                                                                                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1   | Values start `fle:v1:k1:VisitRecord.subjective:s:…` / `fle:v1:k1:VisitNoteVersion.subjective…`. No readable note text.                                                                                                                                                                              |
| D-2   | `"fle:v1:k1:FormResponse.responses:j:…`                                                                                                                                                                                                                                                             |
| D-3   | `AVAILABLE` rows for your uploads and a `REJECTED` row for `fake.pdf` (B-6). `storagePath` = `local:patient-files/<clinic>/<patient>/<uuid>`, with no filename. On disk the files are named by uuid only, and the rejected one is gone. Unfinished intents (B-7) stay `PENDING` until swept (§9.7). |
| D-4   | `FILE_UPLOADED`, `FILE_UPLOAD_REJECTED`, `READ PatientFile` (one per download-url / preview), `PRESCRIPTION_CREATED`, `TREATMENT_PLAN_CREATED`, `FORM_RESPONSE_SUBMITTED`, `VISIT_RECORD_CREATED` (+ `VISIT_RECORD_UPDATED` if you edited the note), `LOGIN_SUCCESS`                                |
| D-5   | `0`                                                                                                                                                                                                                                                                                                 |

**Backfill and key rotation (D-6 – D-8).** This simulates a row written before encryption existed, then rotates keys. `--clinic` limits the run to your test clinic, because the shared test database also holds rows from other test runs sealed with keys you do not have (a full run would report them as `failed`).

```bash
# D-6 put a legacy plaintext value in, then seal it
$PSQL "update \"VisitRecord\" set objective='Synthetic legacy plaintext' where \"clinicId\"='$CID'"
corepack pnpm run ops:encrypt-phi:dev -- --dry-run --clinic $CID | grep -A5 '"VisitRecord"'
$PSQL "select left(objective,40) from \"VisitRecord\" where \"clinicId\"='$CID'"
corepack pnpm run ops:encrypt-phi:dev -- --clinic $CID | grep -A5 '"VisitRecord"'
$PSQL "select left(objective,40) from \"VisitRecord\" where \"clinicId\"='$CID'"
# D-7 a second run changes nothing
corepack pnpm run ops:encrypt-phi:dev -- --clinic $CID | grep -A5 '"VisitRecord"'
```

| Check | Expect                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-6   | Dry run: `"sealed": 1`, and the row still reads `Synthetic legacy plaintext`. Real run: `"sealed": 1, "failed": 0`; the row now reads `fle:v1:k1:VisitRecord.objective:s:…`. |
| D-7   | `"sealed": 0, "resealed": 0, "failed": 0`                                                                                                                                    |

D-8 (rotation):

1. Stop terminal 1 (Ctrl-C).
2. In `.env.manual.local`:
   - add a second key: `FIELD_ENCRYPTION_KEYS=k1:<existing>,k2:<output of openssl rand -hex 32>`;
   - set `FIELD_ENCRYPTION_ACTIVE_KID=k2`.
3. In terminal 3, reload the env (`set -a; . ./.env.manual.local; set +a`) and run `corepack pnpm run ops:encrypt-phi:dev -- --clinic $CID`.
4. Restart terminal 1.

| Check | Expect                                                                                                                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-8   | `"resealed"` ≥ 1 for `VisitRecord`, `VisitNoteVersion` and `FormResponse`, with `"failed": 0`. Re-running D-1 shows `fle:v1:k2:…`. After the restart, the note still reads as plain text: B-21 (after re-running the `login` line), or the page from F-2. |

### 9.7 Optional extra checks

- **A presigned URL expires.**
  1. Stop terminal 1, add `FILE_URL_TTL_SECONDS=5` to `.env.manual.local`, and restart.
  2. Get a URL as in B-8, wait 6 s, then fetch it: `403`.
  3. Remove the line again.
- **Abandoned uploads are swept.** The cron runs every 5 minutes in the running backend.
  1. Take the `fileId` of an intent that was never completed (B-7's `I`).
  2. Backdate it: `$PSQL "update \"PatientFile\" set \"createdAt\"=now()-interval '2 hours' where id='<fileId>'"`.
  3. Within 5 minutes terminal 1 logs `[Cron] Retired 1 incomplete file uploads.` and the row becomes `REJECTED`.
- **Filtering on an encrypted column is refused.** No UI path does this; it is proven by `fieldEncryption.int.test.ts` › "a filter on an encrypted column is refused".
- **Fast yes/no.** The automated suites (§4.1–4.6) cover the same ground.

### 9.8 Production refuses unsafe settings (backend)

```bash
# terminal 3 — does not touch the running backend
NODE_ENV=production DATABASE_URL=x CORS_ORIGIN=x \
  JWT_SECRET=$(node.exe -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") \
  S3_ACCESS_KEY_ID= S3_SECRET_ACCESS_KEY= FIELD_ENCRYPTION_KEYS= \
  node.exe -e "require('ts-node').register({transpileOnly:true}); require('./src/config/envValidation').collectEnvProblems().filter(p=>p.fatal).forEach(p=>console.log('FATAL:', p.message))"
```

Expect:

```
FATAL: S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not set — patient files would be written to local disk
FATAL: FIELD_ENCRYPTION_KEYS is not set — transcripts, SOAP notes and intake answers would be stored unencrypted
```

### 9.9 Clean up

```bash
# terminals 1 and 2: Ctrl-C. If a port stays busy on Windows, in PowerShell:
#   Get-NetTCPConnection -LocalPort 4302,3000 -State Listen | % { Stop-Process -Id $_.OwningProcess }
cd backend
rm -f .env.manual.local uploads/.manual-seed-*.json uploads/manual-*.pdf
```

The synthetic clinics stay in the database you chose (`MANUAL_DB`), with `example.test` emails and `live-…` slugs. They are harmless. On `mf_it`, drop and recreate it to start from zero (B0 walkthrough §4.0). On your own dev database (e.g. `medoflow`), just leave them: they are separate tenants and never mix with your demo data.

### 9.10 Result sheet

| Area                                                     | Checks                            | Pass? |
| -------------------------------------------------------- | --------------------------------- | ----- |
| Upload via presigned URL                                 | B-1 B-2 B-3 B-4 · F-3 F-4         | ☐     |
| Refusals (type / size / fake content / signed size+type) | B-5 B-6 B-7 · F-5                 | ☐     |
| Download & preview                                       | B-8 B-9 B-10 · F-6 F-7            | ☐     |
| Access control & tenant isolation                        | B-11 B-12 B-13 B-14 · F-12 F-15   | ☐     |
| No PHI in URLs / audit rows                              | B-3 B-8 · F-9 · D-3 D-5           | ☐     |
| Records validation (prescription, plan, intake)          | B-15 – B-19 · F-10 F-11 F-13 F-14 | ☐     |
| Encryption at rest, plain text in the app                | B-20 B-21 · F-2 · D-1 D-2         | ☐     |
| Audit trail                                              | D-4                               | ☐     |
| Backfill & key rotation                                  | D-6 D-7 D-8                       | ☐     |
| Production refusal                                       | §9.8                              | ☐     |

Tested by: **\*\***\_\_**\*\*** · Date: \***\*\_\_\*\*** · Branch / commit: \***\*\_\_\*\***
