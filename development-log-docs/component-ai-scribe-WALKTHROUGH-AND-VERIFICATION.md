# Component 2 — AI Scribe / EMR: walkthrough and verification

**Date:** 2026-10-29 · **Branch:** `feat/c2-ai-scribe` (from `team/development` @ `ccc3934`) · **Data:** synthetic only. The PHI gate stays closed.
**Plan reference:** `arh-agent-docs/development-plan.md` › Part B › Component 2 (B2.1–B2.8, F2.1–F2.6).
**Decision record:** [ADR 0006 — pluggable AI providers and the PHI egress gate](../docs/adr/0006-ai-provider-abstraction-and-phi-egress.md).
**Want to check it yourself?** §9 is a step-by-step manual testing guide. With the built-in mock AI (no key) it covers the backend (curl and database), the browser screens and the production safety gate. Then §9.9–§9.10 run the whole browser flow again against a real AI, on one free Groq key.

---

## 1. Outcome

The scribe now talks to an **interface**, not a vendor. Switching between OpenAI, Azure OpenAI, Groq, Gemini (Developer API or Vertex AI), a self-hosted Ollama + whisper server, or the in-process mock is an `.env` change and a restart. In production the app **refuses to boot** if the scribe would send PHI to a host without a BAA.

| Task                                        | AC (short)                                                                                                  | Status                                 | Evidence                                                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B2.1** Provider-agnostic scribe           | real consult → transcript + draft through a pluggable vendor; self-built path removed; BAA before real data | ✅ engineering · ⬜ vendor BAA (owner) | `services/ai/*`; `aiOpenAiCompatible.test.ts` (23), `aiConfig.test.ts` (18), `aiGoogleAuth.test.ts` (3); live run §4.5. `nodejs-whisper` + hard-wired Ollama removed. Real-key run: ✅ owner, Groq, 2026-10-30 (§9.9–§9.10) |
| **B2.2** Structured output                  | machine-readable orders (name + **dose** + qty) mapped to SKUs                                              | ✅                                     | `scribeAnalysis.test.ts` (16, Zod-validated output, repair pass); `rxMapping.test.ts` (+2 dose); `RxOrderLine.dose` sealed; manual B-11, D-7                                                                                |
| **B2.3** Human in the loop                  | an unreviewed AI draft cannot enter the record                                                              | ✅                                     | `aiScribe.int.test.ts` (record untouched before approval; approval makes no AI call; dead `saveDraftAsVisitNoteVersion` removed)                                                                                            |
| **B2.4** Summary boundary                   | transcript / internal note never published; only the approved summary crosses                               | ✅                                     | `aiScribe.int.test.ts` ("Approve & send"; patient view + portal list carry no note/transcript); manual B-20/B-21, F-12                                                                                                      |
| **B2.5** Immutable versions                 | editing creates a new version; prior versions unmodified                                                    | ✅                                     | DB trigger (migration `20261029000000`); `aiScribe.int.test.ts` (UPDATE refused even for the owner; byte-identical after later visits); manual D-9, F-9                                                                     |
| **B2.6** Minimum necessary + PHI-safe queue | only needed fields; **no PHI in job logs**                                                                  | ✅                                     | `aiScribe.int.test.ts` › B2.6 (canary in transcript + model output → absent from logs, `errorMessage`, BullMQ failure reason; job data = ids only)                                                                          |
| **B2.7** LLM BAAs + zero-retention          | every LLM in a PHI path has a signed BAA register entry                                                     | 🟨 gate built · ⬜ BAAs (owner)        | `egressPolicy.ts` refuses boot without `AI_SCRIBE_BAA_HOSTS`; `aiConfig.test.ts` FR-13 group; BAA register updated (HIPAA checklist §1.2)                                                                                   |
| **B2.8** ⭐ Longitudinal record (new)       | each visit builds on prior approved visits                                                                  | ✅                                     | `longitudinalService.ts`; `aiScribe.int.test.ts` › B2.8 (prompt carries prior A/P, never another clinic's); `LongitudinalPanel`                                                                                             |
| **F2.1** Review + "Approve & send"          | provider sees transcript + summary, edits, one action publishes; chips render                               | ✅                                     | shared `ScribeWorkspace` / `ScribeReviewPanel` on both screens; `aiScribeReview.test.tsx` (19); `e2e/scribe-review.spec.ts`; live spec                                                                                      |
| **F2.2** Consent capture                    | stored server-side; no consent blocks recording                                                             | ✅ (decline added)                     | patient **Decline** + provider verbal attestation; `aiScribe.int.test.ts` › FR-1; e2e decline test                                                                                                                          |
| **F2.3** No unreviewed publish              | no UI path publishes an unreviewed draft                                                                    | ✅                                     | approve gated on note + summary + products; unit + e2e                                                                                                                                                                      |
| **F2.4** Recorder                           | mic grant/deny handled; audio only to our backend over TLS                                                  | ✅                                     | both screens use `useAudioRecorder`; upload progress; unconfigured server disables recording (e2e)                                                                                                                          |
| **F2.5** ⭐ Record over time (new)          | prior visits shown beside the draft                                                                         | ✅                                     | `LongitudinalPanel` (unit + e2e); reads audited                                                                                                                                                                             |
| **F2.6** ⭐ Portal summaries (new)          | patient sees published summaries                                                                            | ✅                                     | `/account/summaries` (was "coming soon"); `accountSummaries.test.tsx`; e2e; live spec                                                                                                                                       |

**Exit criteria (Universal Acceptance Standard)**

| #   | Criterion                                                    | State                                                                                                                                                 |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CI gate: typecheck, lint (0 warnings), tests, audit          | ✅ locally, all green (§4.1). CI runs on the PR.                                                                                                      |
| 2   | Tests prove the behaviour, happy + negative paths            | ✅ 62 new backend unit, 29 new integration, 26 new frontend unit, 5 new e2e, 2 new live                                                               |
| 3   | No regressions                                               | ✅ backend 364 → 426 unit, 221 → 250 integration; frontend 337 → 363 unit; full e2e 57 passed / 0 failed                                              |
| 4   | Peer review                                                  | ⬜ PR to `development` open, awaiting review                                                                                                          |
| 5   | HIPAA §2 per-change gate                                     | ✅ §7                                                                                                                                                 |
| 6   | Verified in a running environment                            | ✅ real API + Postgres (RLS) + Redis + worker + real frontend (§4.5, §9.5–§9.8). Real AI vendor: ✅ Groq, run by the owner on 2026-10-30 (§9.9–§9.10) |
| 7   | No open defects / docs updated / no secrets / synthetic only | ✅ ADR 0006, BAA register, PHI gate, `.env.example`, plan statuses; secret scan §4.7                                                                  |

**Not done here (needs you):**

- ~~Run the real-AI leg (§9.9–§9.10)~~: **done** by the owner on 2026-10-30 with a Groq key, all checks passed. The optional Gemini extra at its end (does Gemini's OpenAI endpoint accept browser webm audio?) is still open.
- Choose the production scribe/LLM vendor, sign its **BAA** with zero-retention in writing (B2.7), then add its host to `AI_SCRIBE_BAA_HOSTS`.
- Set `AI_SCRIBE_*` on Render — and `AI_SCRIBE_DEMO_ENABLED=true` so the hosted demo's "simulate conversation" keeps working (it is off in production by default now; `after-deploy-test.md` X-2 depends on it).
- Apply migration `20261029000000_ai_scribe_providers_and_note_immutability` on Neon.
- Sign ADR 0006. Review and merge the PR.

---

## 2. Problems found and fixed

Verified against the code first — the plan said "self-built OpenAI + Whisper"; the code actually ran a local **Ollama + whisper.cpp**, hard-wired.

1. **Consent was skipped on the direct scribe path.** `/ai-scribe/session/:id/audio` stored and transcribed audio with no consent check; only the consultation room checked. **Fixed:** consent (booking checkbox, patient on the join page, or provider-attested verbal consent) is required wherever audio goes to the AI; a patient's decline always wins (403 / 409).
2. **The patient summary was AI text nobody reviewed.** It was generated at approval time and published without the provider seeing it; when the LLM failed, the clinician's own assessment and plan were silently copied into the patient summary. **Fixed:** the summary is drafted with the note, shown and editable, required before sending; approval makes no AI call and has no fallback.
3. **A dead function could write an unreviewed draft into the record** (`saveDraftAsVisitNoteVersion`), plus five other dead service functions. **Removed.**
4. **FAILED appeared while BullMQ was still retrying**, and the 10-minute timeout neither cancelled the work nor cleared its timer. **Fixed:** FAILED only on the last attempt (or a non-retryable error); timeouts abort the request (`AbortSignal`).
5. **PHI could reach logs.** A JSON parse error logged part of the model output; `errorMessage` contained an internal URL ("Is Ollama running at …"); failed jobs were kept forever. **Fixed:** failures are fixed safe texts/codes (`services/ai/errors.ts`), proven by the B2.6 canary test; `removeOnFail` bounded.
6. **Model output was never validated** (regex + recursive key search; `[object Object]` could land in a note). **Fixed:** Zod schema, one repair pass, else `ai_bad_output`.
7. **`/simulate` (demo shortcut) was live in production** with no guard. **Fixed:** `AI_SCRIBE_DEMO_ENABLED` (on outside production; off in production unless set).
8. **The worker looked sessions up by id alone** inside the tenant bypass. **Fixed:** clinic-scoped lookups (job data carries `clinicId`).
9. **Approving into an already finalized visit was allowed**, and every console visit created a new session. **Fixed:** 409 `visit_finalized`; the open session is resumed.
10. **Only `/approve` had input validation.** **Fixed:** Zod on every scribe route, with size limits (20,000 chars per note section).
11. **A Redis outage in the consultation room was a 500** and left the consultation stuck in PROCESSING; it never reached TRANSCRIPT_READY. **Fixed:** clean 503 + FAILED; the worker moves the consultation to TRANSCRIPT_READY.
12. **`fetchAudioBuffer` fetched any http(s) URL** and the local path could escape `uploads/`. **Fixed:** only our own storage references; path confined to `uploads/`.
13. **Frontend dead ends.** The room's "Demo: simulate conversation" could never appear (and left the editor empty); the call-audio upload path was never wired; FAILED showed only a badge; 503 showed axios's "Request failed with status code 503"; polling never stopped; the patient could not decline; `/account/summaries` was "coming soon"; "Recent Vitals" and "AI High Confidence" were hardcoded. **All fixed** (§3).
14. **Two scribe screens behaved differently** (separate recorders and editors; the console published as a second step, the room auto-published and swallowed failures). **Fixed:** one shared review core.
15. **`nodejs-whisper` carried an accepted high advisory** (braces ReDoS). **Removed** with the self-built path; the backend audit-exception list is now empty.

Found while writing and running the manual guide (§9). The automated suites passed with all three, because their uploads and timings were too tidy:

16. **"Approve & send" failed with "Line not found" after "Regenerate draft".** The worker marked the draft `DRAFT_GENERATED` _before_ it rebuilt the detected products. The review screen loaded the old product lines and kept them, so approval referred to lines that no longer existed. On a first draft the same race could show no products at all. **Fixed:** products are written before the draft is marked ready (worker and demo), and the review screen reloads them whenever a new draft arrives. Tests: `aiScribe.int.test.ts` › "a regenerated draft is marked ready only once its detected products are current"; `aiScribeReview.test.tsx` › "a new draft reloads its detected products". Manual: B-16, F-6 → F-8.
17. **A `.webm` recording picked from disk was refused** ("Audio file type not allowed"). Chrome types a picked file by its extension, so `.webm` arrives as `video/webm`; the server accepted `audio/*` only. Browser recorders save `.webm`. The live spec had passed because it forced `audio/webm`. **Fixed:** `config/audioUpload.ts` treats `video/webm` as `audio/webm`, and the console's file picker also offers `.webm`. Other video types are still refused. Test: `aiScribe.int.test.ts` › "a .webm recording picked from disk … is accepted as audio".
18. **Version history said "No history available" right after approval**, while the versions were still loading. **Fixed:** it says "Loading versions…" until they arrive. Test: `aiScribeReview.test.tsx` › NoteHistoryModal. Manual: F-9.

---

## 3. What was built (files)

**Backend — provider layer (`backend/src/services/ai/`)**

| File                  | Purpose                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`            | `SpeechToTextProvider`, `LlmProvider`, `ProviderDescriptor` (provenance, never keys/URLs)                                                                                         |
| `config.ts`           | `AI_SCRIBE_*` parsing, presets (openai, azure, groq, gemini, vertex-gemini, ollama, whisper-server, custom), demo flag                                                            |
| `openaiCompatible.ts` | one fetch-based adapter: `/chat/completions` (json_schema / json_object), `/audio/transcriptions`, Gemini `chat-audio`, bearer / api-key / Google token auth, cancelling timeouts |
| `googleAuth.ts`       | Vertex AI access tokens (service-account JWT or metadata server), no SDK                                                                                                          |
| `mock.ts`             | deterministic in-process provider for CI / integration / live runs (refused in production)                                                                                        |
| `errors.ts`           | `AiError` safe codes + retryability                                                                                                                                               |
| `egressPolicy.ts`     | the production BAA gate (FR-13), incl. the explicit `AI_SCRIBE_PHI_POLICY=synthetic-data-only` opt-out for the synthetic demo                                                     |
| `registry.ts`         | builds providers once; `scribeCapabilities()`; provenance string                                                                                                                  |

**Backend — scribe**

- `services/scribeAnalysis.ts` — prompt contract, Zod-validated analysis (SOAP, timeline, orders with dose, continuity, patient summary), repair pass, idempotent speaker labelling.
- `services/longitudinalService.ts` — prior-visit digest for the prompt; record-over-time list.
- `queues/aiScribeQueue.ts` — rewritten worker (`processAiScribeJob`, `runScribeJob`).
- `services/aiScribeService.ts`, `controllers/aiScribeController.ts`, `routes/aiScribe.ts`, `validation/aiScribeSchemas.ts` — consent, review, approve & send, capabilities, longitudinal; dead code removed.
- `services/consultationService.ts` + controller + route — `POST /consultations/:id/consent/decline`; 503 on queue outage.
- `controllers/visitController.ts`, `routes/visits.ts` — `GET /visits/me/summaries` (patient).
- `services/rxMappingService.ts`, `rxCartService.ts`, `utils/fieldCrypto.ts` — `dose` (sealed).
- `config/audioUpload.ts` (a `.webm` file picked from disk is typed `video/webm`; treated as audio).
- `config/envValidation.ts` (egress gate at boot), `config/prisma.ts` (`app.op_reason` session variable for the trigger), `services/storageService.ts` (path confinement), `site/services/aiCopyService.ts` (website copy uses the same LLM; business facts only).
- Migration `prisma/migrations/20261029000000_ai_scribe_providers_and_note_immutability/` — `aiProvider`, `sttModel`, `consentSource`, `consentRecordedAt`, `RxOrderLine.dose`, immutability trigger on `VisitNoteVersion`.
- Removed: `services/aiProviderService.ts`, `services/openaiService.ts`, `test_ollama.ts`, deps `nodejs-whisper` and `openai`, the `nodejs-whisper` audit exception.
- `.env.example` — every preset documented; placeholders only.

**Frontend**

- `components/aiScribe/ScribeWorkspace.tsx` (state machine), `ScribeReviewPanel.tsx` (note + patient summary + products + approve & send), `ScribeStatusPanels.tsx` (consent / processing / failed / approved), `LongitudinalPanel.tsx`, `TranscriptCard.tsx`.
- `hooks/useScribeSession.ts` — session + polling with backoff and a 10-minute cap; `useScribeCapabilities`.
- `lib/aiScribeApi.ts` (new types and calls), `lib/apiError.ts` (shared error helper, re-exported from `rxCartApi`), `lib/patientApi.ts` (`getMySummaries`).
- Pages: `dashboard/provider/visits/[id]/scribe` (rewritten), `dashboard/provider/appointments/[id]/consultation` (1,270 → 947 lines, uses the shared core), `(public)/consultation/[token]` (Decline), `(public)/account/summaries` (built).
- `components/rxCart/DetectedProductsPanel.tsx` (dose on chips), `components/visit/NoteHistoryModal.tsx` (explicit order, "Current", "Loading versions…").

**Tests**

- Backend unit: `aiOpenAiCompatible.test.ts`, `aiConfig.test.ts`, `aiGoogleAuth.test.ts`, `scribeAnalysis.test.ts`, `rxMapping.test.ts` (+2), `criticalRemediation.test.ts` (updated).
- Backend integration: `integration/aiScribe.int.test.ts` (29); `integration/setup.ts` sets the mock provider.
- Frontend unit: `tests/components/aiScribeReview.test.tsx`, `tests/components/accountSummaries.test.tsx`, `tests/unit/aiScribeClient.test.ts`.
- e2e: `e2e/scribe-review.spec.ts` + `e2e/scribeMock.ts`; `e2e/live-scribe.spec.ts`; `rx-cart.spec.ts` / `rxCartMock.ts` / `live-rx-cart.spec.ts` updated for the one-call approve and the dose.
- Seed: `backend/scripts/seed-e2e-live.ts` adds a scribe visit booked without consent.

**Docs:** `docs/adr/0006-…`, `docs/HIPAA_COMPLIANCE_CHECKLIST.md` §1.2 (BAA register), `docs/PHI_GATE.md`.

---

## 4. Verification: commands and results

All commands from the repo root unless a `cd` is shown. Machine: Windows, Git Bash, Docker (`mf-pg` Postgres 18 on 55432), `corepack pnpm`.

### 4.1 Gates

```bash
cd backend
corepack pnpm run typecheck                   # → exit 0 (both tsconfigs)
corepack pnpm run lint                        # → 0 problems (--max-warnings=0)
corepack pnpm run test:coverage               # → 26 files · 426 passed · lines 27.85% (floor 17)
export INTEGRATION_DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/mf_it
export INTEGRATION_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/mf_it
corepack pnpm run test:integration:coverage   # → 15 passed | 1 skipped files · 250 passed, 1 skipped · lines 57.84% (floor 33)
cd ../frontend
corepack pnpm run typecheck                   # → exit 0
corepack pnpm run lint                        # → 0 problems
corepack pnpm run test:coverage               # → 29 files · 363 passed · lines 51.42%
```

- The integration log prints `Appointment_provider_no_overlap` constraint errors: those are the scheduling suite's deliberate negative tests (B1.1), not failures.
- On this shared machine `eslint` once ran out of memory; `NODE_OPTIONS=--max-old-space-size=4096` fixes it.
- Baseline flake: `b0Foundation.test.ts › refresh-cookie policy` failed once under full-suite load on the untouched base, passed in isolation and on rerun (364/364). Not related to this change.

### 4.2 New backend unit tests (62)

```bash
cd backend
corepack pnpm exec vitest run src/tests/aiOpenAiCompatible.test.ts src/tests/aiConfig.test.ts src/tests/aiGoogleAuth.test.ts src/tests/scribeAnalysis.test.ts src/tests/rxMapping.test.ts
# → 5 files · 70 passed
```

What they prove: request shapes per vendor style (OpenAI json_schema, Groq/Ollama json_object, Azure api-key, Gemini chat-audio, multipart transcription); HTTP 401/403/400/413/429/5xx/504 → safe codes with correct retryability and **no** provider text, key or host in the message; timeouts and caller signals really cancel; presets and overrides; the production egress gate (unlisted host, Gemini Developer API, plain http, mock; the synthetic-only opt-out downgrades only the BAA checks); Vertex service-account JWT signature and metadata fallback; schema validation, repair pass, no `[object Object]`, dose, prior-visit context, idempotent speaker labels.

### 4.3 Integration (29 new, real Postgres with RLS + tenant guard, mock AI)

```bash
cd backend
corepack pnpm exec vitest run --config vitest.integration.config.ts src/tests/integration/aiScribe.int.test.ts
# → 29 passed
```

Groups: capabilities (no hosts/keys; provider-only) · FR-1 consent (no consent → 403 and nothing queued; booking consent; attested consent audited; decline wins and blocks the consultation recording too; only the patient can decline) · pipeline (ids-only job data; draft with provenance; dose sealed; transcript/draft sealed at rest; audit rows carry provenance, never content; patient sees nothing before approval; a regenerated draft is marked ready only once its products are current; a `.webm` typed `video/webm` is accepted, other video refused) · edits audited by field name only; oversized/unknown fields → 400 · "Approve & send" (one transaction; patient view + portal list carry the summary only; empty summary refused; finalized visit → 409) · B2.5 trigger · FR-11 retries (transient → no FAILED, transcript kept; last attempt → safe FAILED; Retry; non-retryable final at once; queue outage → 503; unconfigured → 503; TRANSCRIPT_READY) · **B2.6 canary** · demo guard 404 · cross-clinic 404 · B2.8 longitudinal (prior A/P in the prompt, no names/emails; other clinic never feeds the digest).

### 4.4 Frontend unit (26 new) and mocked e2e

```bash
cd frontend
corepack pnpm exec vitest run tests/components/aiScribeReview.test.tsx tests/components/accountSummaries.test.tsx tests/unit/aiScribeClient.test.ts
# → 3 files · 26 passed
NEXT_PUBLIC_API_URL=http://127.0.0.1:3999 node node_modules/next/dist/bin/next build --webpack
node scripts/e2e-server.js 4310                         # terminal 2
E2E_EXTERNAL_SERVER=1 corepack pnpm exec playwright test # → 57 passed, 10 skipped (opt-in live specs), 0 failed
```

`e2e/scribe-review.spec.ts` (5): consent → demo draft → review → "Approve & send" (exact body asserted, axe clean); failed run → reason, manual note, Retry; unconfigured server; patient decline from the join link; portal summaries. Every spec asserts no patient name/email or clinical words in any URL.

> **Windows note:** stop the e2e server you started by its PID (`Stop-Process -Id <pid>` in PowerShell) before restarting after a rebuild, and check its log has no `EADDRINUSE` — a stale server serves old chunks and produces misleading failures.

### 4.5 Live front-end ↔ back-end run (no mocks in the browser)

Real API on `:4302` (connected as `medoflow_app` → RLS enforced; field encryption on; local Redis; BullMQ worker running; AI = mock), frontend built against it on `:4310`. The same setup by hand, step by step: §9.3–§9.7.

```
✓ live-rx-cart › provider: scribe detects products, provider maps + confirms, "Approve & send" builds the cart
✓ live-rx-cart › patient: sees "Prescribed · Dr. X", accepts / declines, and (no card yet) gets the regular checkout
✓ live-scribe › provider: consent → upload → AI draft → review → "Approve & send"
✓ live-scribe › patient: the approved summary is in the portal — and nothing else from the visit
4 passed (24.3s)
```

The first live-scribe attempt stopped at "Approve & send" because the draft had detected products the spec had not confirmed — the B5.2 gate doing its job; the spec now confirms them.

### 4.6 Database checks on the live run (D-1 … D-6)

```
D-1 session | APPROVED | t | mock:mock | mock-scribe-1 | mock-scribe-1 | PROVIDER_ATTESTED_VERBAL
D-2 sealed | fle:v1: | "fle:v1: | "fle:v1:
D-3 record | FINAL | t | fle:v1: | 1
D-4 audit | AI_SCRIBE_SESSION_CREATED,CONSENT_ATTESTED,READ,AI_DRAFT_GENERATED,READ,PATIENT_SUMMARY_PUBLISHED,READ
D-5 dose | fle:v1: | 1  /  fle:v1: | 2
D-6 ERROR:  VisitNoteVersion is immutable: add a new version instead of editing …   (UPDATE as the database owner)
```

### 4.7 Audit and secrets

```bash
mkdir -p node_modules/.shim && printf '@corepack pnpm %%*\r\n' > node_modules/.shim/pnpm.cmd
PATH="$PWD/node_modules/.shim:$PATH" node backend/scripts/audit-backend.js    # → ✓ no unaccepted high/critical (exception list now empty)
PATH="$PWD/node_modules/.shim:$PATH" node frontend/scripts/audit-frontend.js  # → ✓ (2 pre-existing, dated sharp exceptions)
export MSYS_NO_PATHCONV=1
docker run --rm -v "E:/advertout/MedoFlow:/repo" zricethezav/gitleaks:v8.21.2 dir /repo/backend/src --redact --no-banner
```

- gitleaks (Docker image; not installed on the machine) over `backend/src`, `backend/prisma`, `backend/scripts`, `backend/.env.example`, `docs`, `frontend/{app,components,lib,hooks,e2e,tests}`, `development-log-docs`: **no new findings**. The remaining hits are the existing allow-listed false positives (`stripe.ts` placeholder, synthetic test passwords). One new hit in my test (a synthetic token shaped like a Google token) was renamed.
- History scan (`git` mode) reports 3 **pre-existing** findings in team commits `82b07478` / `ce24c6de` (the Stripe placeholder comment and an `.env.example` JaaS private-key placeholder line) whose fingerprints are not in `.gitleaksignore` under those SHAs. Not introduced here; worth a look before the next history scan in CI.
- No secret was written to the repo. Throwaway live keys live in the gitignored `backend/uploads/.live-env`.

---

## 5. Design notes

- **Why one OpenAI-compatible adapter.** Every candidate in PRD §9.2 except a dedicated scribe vendor speaks this wire format — OpenAI, Azure, Groq, Gemini (both paths), Ollama, vLLM, LM Studio, whisper servers. One adapter + presets keeps the switch config-only and the code small (no SDKs).
- **STT and LLM are separate** because the best transcriber and the best drafter are often different vendors (and Gemini's OpenAI endpoint has no `/audio/transcriptions`).
- **Gemini audio.** Gemini takes audio as `input_audio` inside a chat message; Google documents WAV. Browsers record webm/opus. Whether Gemini accepts webm is checked in §9.10 (the optional Gemini extra at its end); until then the recommended pairing is OpenAI (or Groq) transcription + Gemini drafting.
- **The production gate is a boot check, not a runtime one**, so a misconfiguration can never process a single recording. Self-hosted endpoints (loopback/private) pass without a BAA entry. The hosted demo (synthetic data) can opt out with `AI_SCRIBE_PHI_POLICY=synthetic-data-only` — an exact phrase, warned on every boot, and removing it is part of opening the PHI gate.
- **Approve & send defaults.** The API's `sendToPatient` defaults to **false**: approval alone never publishes (the existing B2.4 test keeps that guarantee). The UI's "Approve & send" passes `true` — one action, one transaction. (The plan said "default true"; this is the safer variant.)
- **Consent is checked where audio reaches the AI** (upload, recording, the consultation bridge), not at session start, so opening the console and the demo still work without consent. The plan wording said "start and upload"; the protection is the same.
- **Speaker labelling** stays a separate LLM pass; it is skipped when the transcript is already labelled (retry-safe) and discarded when the result is much shorter than the input (a summary is not a transcript).
- **Immutability vs. key rotation.** `ops:encrypt-phi` legitimately rewrites ciphertext of note versions. The trigger admits exactly that operation (`app.op_reason = 'ops:encrypt-phi'`, set per transaction from the tenant bypass) and still refuses changes to identity columns. DELETE stays allowed for the data-lifecycle paths. The field-encryption integration suite (which rotates keys) passes with the trigger in place.
- **Website AI copy** (Component 8) used the deleted Ollama client; it now uses the configured LLM. Its prompts are business facts only (existing unit test).

---

## 6. What you must do manually

1. ~~**Real-AI leg**~~ — §9.9–§9.10 with Groq: **done** 2026-10-30, all passed. Gemini extra still optional.
2. **Vendor + BAA (B2.7)** — choose the production STT/LLM vendor(s); sign the BAA with zero-retention confirmed in writing; tick the BAA register rows (HIPAA checklist §1.2); set `AI_SCRIBE_BAA_HOSTS`.
3. **Render** — set `AI_SCRIBE_*` (or leave unset: the scribe shows "not set up" and manual notes still work). For the hosted demo set `AI_SCRIBE_DEMO_ENABLED=true`; if the demo should call a real vendor without a BAA, also `AI_SCRIBE_PHI_POLICY=synthetic-data-only`. Redis must be reachable for the worker.
4. **Neon** — apply migration `20261029000000_ai_scribe_providers_and_note_immutability` (`prisma migrate deploy`).
5. **Sign** ADR 0006.
6. **PR** — commit and open a PR from `feat/c2-ai-scribe` into `development` when you are happy (not done: you have not asked for a commit).

---

## 7. Review checklist and HIPAA §2 per-change gate

| Item                                                                                                                                                                                  | State                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| authZ — every scribe route `PROVIDER` + clinic; decline `PATIENT` only; summaries `PATIENT` own only                                                                                  | ✅ tests (403/404)                                                        |
| Tenant scoping — clinic-scoped lookups in service + worker; longitudinal same clinic only                                                                                             | ✅ cross-clinic tests                                                     |
| Audit — session created, consent attested/declined, draft generated/regenerated (provenance), edited (field names), finalized, published, every read of transcript/draft/prior visits | ✅ D-4 + integration                                                      |
| PHI in logs / errors / queue                                                                                                                                                          | ✅ B2.6 canary test; fixed safe texts                                     |
| Minimum necessary — prompt = transcript + template + prior A/P digest (no names, no contact details)                                                                                  | ✅ asserted in B2.8 test                                                  |
| Encryption at rest — transcript, timeline, draft, summary, versions, order text **and dose**                                                                                          | ✅ D-2/D-7                                                                |
| PHI in URLs                                                                                                                                                                           | ✅ every e2e + live spec asserts none                                     |
| New PHI path / vendor                                                                                                                                                                 | ✅ BAA register + ADR 0006; production gate blocks unlisted hosts         |
| Synthetic data only                                                                                                                                                                   | ✅ fixtures, seed, demo transcript (the old one named a person — removed) |

---

## 8. Known limits and open items

- **One real vendor so far:** Groq (`openai/gpt-oss-120b` + `whisper-large-v3-turbo`), run by the owner (§9.9–§9.10). The other presets are proven against a local HTTP stub that asserts the exact wire format, and the pipeline against the mock end to end. The failure paths (AI off, bad credentials, AI down with retries, nothing leaking) are proven by the unit, integration and e2e suites (§4.2–§4.4); by hand, §9.10 checks a rejected key and the recovery against Groq (R-20, R-21).
- **Gemini transcription of webm** is unverified until §9.10 (optional Gemini extra).
- **Embeddable scribe vendors** (Nabla / Suki / HealthScribe: audio in → note + orders out) are a third adapter shape not built yet — no vendor chosen. The pipeline is ready for it (one interface swap).
- **Vertex AI** token minting is unit-tested against a stubbed token endpoint, not against Google.
- **Speaker labels are inferred by the LLM**, not true diarization.
- **Live microphone recording** cannot run in headless browsers; the live spec uploads a synthetic file through the same endpoint. §9.7 F-10 covers the mic by hand; the manual-guide run drove it with Chrome's fake microphone.
- The **consultation room's own upload** (`/consultations/:id/recording/upload`) has no progress bar (the console does).
- **Pre-existing:** gitleaks history fingerprints (§4.7); `b0Foundation` refresh-cookie test flake under load (§4.1).

---

## 9. Manual local testing guide

Follow this guide to check by hand that every Component 2 function works on your machine. First with MedoFlow's built-in mock AI: the API, the database, the browser screens and the production safety gate (§9.1–§9.8, no key needed). Then with a real AI, Groq, on one free key: the whole provider and patient flow in the browser, a model switch, a bad-key drill and leak checks (§9.9–§9.10).

**Time needed:** about 15 minutes for setup, 25 for the curl checks (§9.5), 5 for the database (§9.6), 30 for the browser (§9.7), 5 for the production gate (§9.8), 10 to switch to Groq (§9.9) and 45 for the real-AI browser run (§9.10).

- **Validated:** every terminal command in §9.3–§9.6 and §9.8 was run verbatim on 2026-10-29 in Git Bash against this branch, starting from the §9.3 step 0 reset. The "Expect" values are the recorded results; ids, tokens, dates and timings differ per run.
  - The browser steps in §9.7 were driven with Playwright on the same setup (`localhost:3000` + the API from `.env.manual-scribe.local`) and showed the texts quoted here. F-11 (microphone blocked) was not driven: headless Chrome cannot block a microphone the way you can.
  - §9.9 and §9.10 (Groq) were written from the code and Groq's documentation, then run by the owner on 2026-10-30 with a Groq key: all checks passed. What the model writes varies per run.
  - §9.11 (self-hosted) needs your own servers and was **not run**.
  - Writing and running this guide found three defects that the automated suites had missed. They are fixed in this change and now covered by tests (§2 items 16–18).
- **Data:** synthetic only, in a dedicated database (`mf_manual_scribe`). Until §9.9 the AI is MedoFlow's built-in **mock**, and nothing leaves your machine. From §9.9 on, the synthetic recording and the scripts you read aloud go to Groq.
- **Failure paths** (AI switched off, AI down with retries, nothing leaking from a failed job) are covered by the unit, integration and e2e suites (§4.2–§4.4). By hand, §9.10 checks a rejected key and the recovery against the real vendor (R-20, R-21).

Each check has an id: `B-…` backend API (curl), `D-…` database, `F-…` frontend in the browser with the mock, `P-…` production gate, `R-…` real AI (Groq). Tick them off in the **result sheet (§9.13)**. Any ✗ is a defect. If something fails, look in **§9.14 Troubleshooting** first.

**What you will test** (the FR numbers are the functional requirements in the plan)

| Function                                                                                                        | Backend                                  | Browser               | Database      | Real AI (Groq)               | Gate      |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------- | ------------- | ---------------------------- | --------- |
| FR-1 Consent before recording; the patient can decline, and a decline wins                                      | B-3 – B-7, B-30 – B-35                   | F-1, F-2, F-14        | D-1, D-8      | R-5, R-16                    | —         |
| FR-2 – FR-6 Record or upload → transcript → SOAP draft, timeline, orders with dose                              | B-8 – B-11                               | F-3 – F-5, F-10, F-11 | D-2, D-7      | R-6 – R-10, R-12, R-13, R-17 | —         |
| FR-7 Record over time: earlier approved visits feed the next draft                                              | B-27 – B-29                              | F-10                  | —             | R-14                         | —         |
| FR-8 Human in the loop: edit, regenerate, validation; nothing reaches the record or the patient before approval | B-12 – B-17                              | F-6, F-7              | D-3           | R-11, R-15                   | —         |
| FR-10 "Approve & send": one action; the patient sees only the summary                                           | B-18 – B-22                              | F-8, F-12             | D-3           | R-11, R-18, R-22             | —         |
| FR-9 Note versions can never be edited                                                                          | —                                        | F-9                   | D-9           | R-11                         | —         |
| FR-11 Failures: a clear reason, Retry, write the note by hand                                                   | —                                        | —                     | —             | R-20, R-21                   | —         |
| FR-12 Pluggable AI, switched by configuration only                                                              | B-1                                      | —                     | D-1           | R-1 – R-4, R-19              | —         |
| FR-13 Production refuses a vendor without a BAA                                                                 | —                                        | —                     | —             | R-3                          | P-1 – P-7 |
| FR-14 No patient data in logs, queue records or error messages                                                  | —                                        | F-13                  | D-5, D-6      | R-23, R-24, R-26, R-27       | —         |
| FR-15 Audit trail and AI provenance                                                                             | B-10                                     | F-4                   | D-1, D-4, D-5 | R-7, R-25, R-26              | —         |
| FR-16 Roles, other clinics, input limits, demo switch                                                           | B-2, B-14, B-15, B-21, B-23 – B-26, B-28 | —                     | —             | —                            | —         |

### 9.1 Before you start

You need:

- Docker Desktop running, with the `mf-pg` Postgres container (B0 walkthrough §4.0 creates it);
- Node 20 or later;
- Git Bash;
- Chrome, with a microphone for F-10, R-12 and R-17 (any headset or laptop mic);
- this branch checked out with dependencies installed (`corepack pnpm install` at the repo root);
- for §9.9–§9.10: a free Groq key (<https://console.groq.com>, no card needed), a second browser window (Incognito or another profile) for the patient, and a quiet room to read the scripts aloud.

Use `corepack pnpm` wherever `pnpm` is not on your PATH.

Ports used:

| Port    | What                                                                   |
| ------- | ---------------------------------------------------------------------- |
| `55432` | Postgres (`mf-pg` container)                                           |
| `56379` | Redis for the scribe job queue (`mf-redis` container, created in §9.3) |
| `4302`  | API                                                                    |
| `3000`  | frontend                                                               |

> ⚠️ **Run every terminal command in Git Bash**, not PowerShell or Command Prompt. The commands use bash syntax (`VAR=value cmd`, `$( … )`, functions, heredocs).
>
> - **Terminals.** You need three Git Bash windows or tabs, all started in the repo (`cd /e/advertout/MedoFlow`):
>   - **terminal 1:** backend;
>   - **terminal 2:** frontend;
>   - **terminal 3:** setup, the curl checks, the database checks and the Groq settings.
> - **Pasting.** In the standalone Git Bash window, paste with **Shift+Insert** or right-click → **Paste**; Ctrl+V does not paste there. Paste each code block whole.

> **Git Bash on Windows: the commands call `node.exe`, not `node`, on purpose.**
>
> - In an interactive Git Bash window, `node` is an alias for `winpty node.exe`.
> - winpty refuses to run inside `$( … )` or a pipe. It prints `stdout is not a tty` and returns nothing, so the variables come out empty.
> - Keep `node.exe` when you copy these commands.

> **Use `localhost` for the app and the API**, never `127.0.0.1`. The sign-in cookie only survives a page reload when the page and the API share the host name.

> **Start the apps from an uppercase drive path** (`cd /e/advertout/MedoFlow/...`, as written below). If the terminal's directory is `e:\…` with a lowercase drive (common in VS Code), `next dev` bundles the router twice. Every page then fails with `invariant expected app router to be mounted` (§9.14).

### 9.2 How the scribe runs on your machine

Knowing the moving parts makes the checks easier to read.

```
 browser (provider)                          API (terminal 1)                          AI
 ──────────────────                          ────────────────                          ──
 consent ──────────────────────────────────▶ stored on the session (audited)
 record / upload audio ────────────────────▶ saved (local disk, encrypted fields)
                                              puts a job on the queue (Redis) ──┐
                                              worker in the same process ◀──────┘
                                                1. transcribe ─────────────────────▶ speech-to-text
                                                2. label "Provider:/Patient:" ─────▶ LLM
                                                3. draft SOAP + timeline + orders
                                                   + patient summary (+ prior visits) ▶ LLM
                                                4. map orders to the clinic catalog
                                                5. status → DRAFT_GENERATED
 review, edit, "Approve & send" ───────────▶ one transaction: note final + summary
                                              published + cart built. No AI call.
 patient portal ◀────────────────────────── only the published summary
```

- **The AI here is the built-in mock** (`AI_SCRIBE_*_PROVIDER=mock`). It ignores what the audio says and always "hears" the same synthetic consult: fatigue easing, vitamin D3 5000 IU, magnesium glycinate 400 mg, recheck in six weeks. So every run gives the same draft, and the checks can quote exact text.
- **The mock only writes a "since the last visit" line when the prompt contains earlier approved visits.** That is how B-29 and F-10 prove the record-over-time feature reaches the AI.
- **The job queue needs Redis.** Without it the worker never runs, and sessions stay "Transcribing".
- **Switching to a real AI** is an `.env` change and a restart (§9.9). Nothing else changes: the same screens, the same database, the same checks.

### 9.3 One-time setup (terminal 3)

**0. Reset: start from a clean slate.** Run this every time you start the guide, including the first time.

- It deletes the previous run's throwaway files (all named `.manual-scribe-*`).
- It drops and recreates the dedicated manual-test database **`mf_manual_scribe`**. Your dev data (`medoflow`), the integration-test database (`mf_it`) and other components' manual databases are never touched.

First stop any backend or frontend still running from a previous session: press Ctrl+C in terminals 1 and 2. Then, in terminal 3:

```bash
cd /e/advertout/MedoFlow/backend
rm -f .env.manual-scribe.local uploads/.manual-scribe-*
docker start mf-pg
DB=mf_manual_scribe
case "$DB" in mf_manual_*) ;; *) echo "✗ refusing to drop $DB — the reset only drops mf_manual_*"; DB=;; esac
[ -n "$DB" ] && docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
```

Expect:

- `mf-pg`;
- `DROP DATABASE`, then `CREATE DATABASE`. On the very first run, a harmless `NOTICE: database "mf_manual_scribe" does not exist, skipping` comes in between.

**1. Apply the migrations and enable the app role.**

```bash
# same terminal as step 0 (uses $DB)
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$DB corepack pnpm exec prisma migrate deploy
docker exec mf-pg psql -U postgres -c "ALTER ROLE medoflow_app WITH LOGIN PASSWORD 'app_local_pw'"
```

Expect:

- `All migrations have been successfully applied.`, with `20261029000000_ai_scribe_providers_and_note_immutability` the last one. That migration adds the provenance columns, the `dose` column and the trigger that keeps note versions unchangeable. Prisma may also print `Environment variables loaded from .env`; that is harmless, because the `DATABASE_URL` on the command line wins;
- `ALTER ROLE`.

**2. Redis for the job queue.** This starts the container if it exists and creates it otherwise.

```bash
docker start mf-redis 2>/dev/null || docker run -d --name mf-redis -p 56379:6379 redis:7-alpine redis-server --appendonly no --maxmemory-policy noeviction
docker exec mf-redis redis-cli ping
```

Expect `mf-redis` (or a long container id on the first run), then `PONG`.

**3. A throwaway env file for this test.**

- `backend/.env.manual-scribe.local` is gitignored (`.env.*.local`), so it can never be committed. Your normal `backend/.env` is not touched.
- It holds fresh random secrets, so nothing here is shared with your dev setup.

```bash
# still in backend/, same terminal as steps 0–2 (uses $DB)
H() { node.exe -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"; }
cat > .env.manual-scribe.local <<ENV
# Component 2 manual testing only (gitignored). Throwaway values.
PORT=4302
NODE_ENV=development
MANUAL_DB=${DB:?set DB first (step 0)}
DATABASE_URL=postgresql://medoflow_app:app_local_pw@localhost:55432/${DB}
MIGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/${DB}
AUDIT_PURGE_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/${DB}
CORS_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000
JWT_SECRET=$(H)
MFA_ENCRYPTION_KEY=$(H)
FIELD_ENCRYPTION_PROVIDER=env
FIELD_ENCRYPTION_KEYS=k1:$(H)
FIELD_ENCRYPTION_ACTIVE_KID=k1
FILE_BLOB_SIGNING_SECRET=$(H)
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
REDIS_URL=redis://localhost:56379
TENANT_ISOLATION_MODE=enforce
AI_SCRIBE_LLM_PROVIDER=mock
AI_SCRIBE_STT_PROVIDER=mock
MANUAL_PASSWORD=Synthetic-Manual-$(node.exe -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")
ENV
# Self-check: every required value must be present and non-empty.
bad=0; for re in '^MANUAL_DB=mf_manual_scribe$' '^DATABASE_URL=.*/mf_manual_scribe$' '^JWT_SECRET=.' '^MFA_ENCRYPTION_KEY=.' \
  '^FILE_BLOB_SIGNING_SECRET=.' '^FIELD_ENCRYPTION_KEYS=k1:.' '^REDIS_URL=redis://' '^AI_SCRIBE_LLM_PROVIDER=mock$' '^MANUAL_PASSWORD=Synthetic-Manual-.'; do
  grep -qE "$re" .env.manual-scribe.local || { echo "✗ missing/empty: $re"; bad=1; }
done; [ $bad = 0 ] && echo "✓ env file OK" || echo "→ fix the cause above and re-run this block"
grep -E '^(MANUAL_DB|MANUAL_PASSWORD)=' .env.manual-scribe.local   # ← database + the password of every seeded user
```

Expect:

- `✓ env file OK`;
- `MANUAL_DB=mf_manual_scribe`;
- a password line like `MANUAL_PASSWORD=Synthetic-Manual-1a2b3c4d`. Note it: you sign in with it in the browser.

If you saw `stdout is not a tty` or `DB: set DB first`, the file is incomplete. Run step 0's `DB=mf_manual_scribe` line and this block again: it overwrites the file.

What these settings mean:

- **The API connects as `medoflow_app`**, so row-level security is enforced exactly as in production. `TENANT_ISOLATION_MODE=enforce` adds the app-level clinic guard on top.
- **Field encryption is on** (`FIELD_ENCRYPTION_KEYS`). Transcripts, drafts, summaries, note versions and order doses are stored as ciphertext (D-2, D-7).
- **The S3 keys are empty**, so recordings go to `backend/uploads/ai-scribe/<session id>/` on your disk.
- **`AI_SCRIBE_*_PROVIDER=mock`** selects the built-in AI (§9.2). The demo button ("Demo: simulate conversation") is on, because `NODE_ENV=development`. In production it is off unless `AI_SCRIBE_DEMO_ENABLED=true`.

**4. Two synthetic clinics.**

```bash
set -a; . ./.env.manual-scribe.local; set +a
for c in a b; do
  E2E_LIVE_PASSWORD=$MANUAL_PASSWORD DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$MANUAL_DB \
    corepack pnpm exec ts-node --transpile-only scripts/seed-e2e-live.ts > uploads/.manual-scribe-seed-$c.json
done
for c in a b; do node.exe -pe "const s=require('./uploads/.manual-scribe-seed-$c.json');'$c: '+s.emails.provider+' · scribe visit '+s.scribeVisitRecordId"; done
echo "seeded into: $MANUAL_DB"
```

Expect two lines like `a: provider.live-744e84@example.test · scribe visit cmvtiidzb001gvgmc1b01tyw1`, then `seeded into: mf_manual_scribe`.

Each clinic gets:

- an **admin**, a **provider** ("Synthetic Provider") and a **patient** "Quinn Marlowe" (`…@example.test`), all with the password `$MANUAL_PASSWORD`;
- a catalog of five products, including **Magnesium Glycinate** but **no vitamin D3**, so one detected product matches and one does not;
- three past appointments, each with what this guide needs:

| Seed field            | What it is                                                    | Used for                                         |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| `scribeVisitRecordId` | a visit 3 days ago, booked **without** AI consent, note empty | the main scribe run                              |
| `rxVisitRecordId`     | a visit 2 days ago, same patient, note empty                  | the next visit, which builds on the first (FR-7) |
| `appointmentId`       | yesterday's appointment, no note yet                          | the consultation room and the patient's decline  |

The clinics have separate jobs, so no check depends on what an earlier section did to another clinic:

| Clinic | Used in                                                                         |
| ------ | ------------------------------------------------------------------------------- |
| **A**  | the curl and database checks (§9.5, §9.6)                                       |
| **B**  | the browser checks with the mock (§9.7), and the "other clinic" in B-23 – B-26  |
| **R**  | the real-AI run (§9.10). §9.9 seeds it, after the switch to Groq, the same way. |

**5. A synthetic consultation recording.** Windows' built-in text-to-speech reads a short scripted consult into a WAV file. No microphone, key or download is needed, and the same file is what the real AI transcribes in §9.10 (R-6).

```bash
powershell.exe -NoProfile -Command "Add-Type -AssemblyName System.Speech; \$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \$s.Rate = -1; \$s.SetOutputToWaveFile('uploads\.manual-scribe-consult.wav'); \$s.Speak('Doctor: How have you been since the last visit? Patient: Better. The tiredness is easing, but I still feel low on energy in the afternoon, and I wake up around three most nights. Doctor: Your energy is improving, so we will keep the plan. Take vitamin D3, five thousand units daily, one bottle. And magnesium glycinate, four hundred milligrams at night, two bottles. Let us recheck in six weeks.'); \$s.Dispose(); 'wrote ' + (Get-Item 'uploads\.manual-scribe-consult.wav').Length + ' bytes'"
```

Expect `wrote 1558426 bytes` (about 1.5 MB, 35 seconds of speech). To hear it, open `E:\advertout\MedoFlow\backend\uploads\.manual-scribe-consult.wav`.

### 9.4 Start the apps

**Terminal 1 — backend**

```bash
cd /e/advertout/MedoFlow/backend
set -a; . ./.env.manual-scribe.local; set +a
corepack pnpm exec ts-node --transpile-only src/server.ts 2>&1 | tee uploads/.manual-scribe-backend.log
```

Wait for these lines (30–60 s):

```
[field-encryption] keys loaded (active "k1", 1 total)
[db] connected as "medoflow_app" — row-level security is enforced
AI Scribe worker started (transcription will run when Redis is available)
Medoflow server running on port 4302 (development)
```

- `tee` also saves the log to `uploads/.manual-scribe-backend.log`, which R-24 searches.
- `[WARN]` lines about S3, Stripe, the site preview secret and alerts are expected and harmless here.
- Every request is logged as one line, for example `"POST /api/v1/ai-scribe/session/<id>/audio HTTP/1.1" 200`. Only ids appear in those lines, never patient data.

**Terminal 2 — frontend**

```bash
cd /e/advertout/MedoFlow/frontend
NEXT_PUBLIC_API_URL=http://localhost:4302 corepack pnpm dev
```

Expect `Ready`. The first page you open compiles for 20–30 s; later pages are faster.

### 9.5 Backend checks with curl (terminal 3)

Paste this helper block once into terminal 3. It loads the env, reads the seed files and signs three users in. Paste it again in any new terminal: the helpers exist only in the terminal where you pasted them.

```bash
cd /e/advertout/MedoFlow/backend
set -a; . ./.env.manual-scribe.local; set +a
API=http://localhost:4302/api/v1
H='x-medoflow-client: web'
JSON='content-type: application/json'
A() { node.exe -pe "require('./uploads/.manual-scribe-seed-a.json').$1"; }
B() { node.exe -pe "require('./uploads/.manual-scribe-seed-b.json').$1"; }
# … | j 'JS expression over o (the JSON body)'
j() { node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let o;try{o=JSON.parse(d)}catch{console.log('(not JSON) '+d.slice(0,160));return}console.log(eval(process.argv[1]))})" "$1"; }
# call TOKEN METHOD PATH [JSON-BODY] → the response body
call() { local a=(-s -X "$2" -H "$H" -H "authorization: Bearer $1"); [ -n "$4" ] && a+=(-H "$JSON" --data "$4"); curl "${a[@]}" "$API$3"; }
# brief TOKEN METHOD PATH [JSON-BODY] → "HTTP <status> · <code> · <message>"
_brief() { node.exe -e "const L=require('fs').readFileSync(0,'utf8').trim().split('\n');const s=L.pop();let o={};try{o=JSON.parse(L.join('\n'))}catch{};console.log(['HTTP '+s,o.code,o.message].filter(Boolean).join(' · '))"; }
brief() { local a=(-s -w '\n%{http_code}' -X "$2" -H "$H" -H "authorization: Bearer $1"); [ -n "$4" ] && a+=(-H "$JSON" --data "$4"); curl "${a[@]}" "$API$3" | _brief; }
# upload SESSION [TOKEN] → sends the synthetic recording from §9.3 step 5
upload() { curl -s -w '\n%{http_code}' -X POST "$API/ai-scribe/session/$1/audio" -H "$H" -H "authorization: Bearer ${2:-$PROV}" \
  -F "audio=@uploads/.manual-scribe-consult.wav;type=audio/wav" | _brief; }
# waitdraft SESSION [TOKEN] → prints each status change until the worker finishes
waitdraft() { local t0=$SECONDS last= st; for i in $(seq 1 90); do st=$(call "${2:-$PROV}" GET /ai-scribe/session/$1/status | j 'o.data.status')
  [ "$st" != "$last" ] && echo "  $((SECONDS-t0))s  $st" && last=$st; case "$st" in DRAFT_GENERATED|FAILED) return;; esac; sleep 1; done; echo "  still $st after 90 s — see §9.14"; }
login() { curl -s $API/auth/login -H "$H" -H "$JSON" -d "{\"email\":\"$1\",\"password\":\"$MANUAL_PASSWORD\"}" \
  | node.exe -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{let o={};try{o=JSON.parse(d)}catch{};if(o.data&&o.data.accessToken)console.log(o.data.accessToken);else console.error('login failed for '+process.argv[1]+': '+(o.message||d||'no response — is the backend running on :4302?'))})" "$1"; }
PROV=$(login "$(A emails.provider)"); PAT=$(login "$(A emails.patient)"); BPROV=$(login "$(B emails.provider)")
echo "${#PROV} ${#PAT} ${#BPROV}"    # three numbers around 300 = all signed in
```

Expect three numbers around 300, e.g. `299 297 299`.

> Sessions expire after 15 idle minutes. If calls start returning `401`, re-run the `PROV=… PAT=… BPROV=…` line.

**If you see `login failed for …: Invalid email or password`**, the seeded users and the running API are not using the same database or password:

- **Restart.** The backend in terminal 1 must have been (re)started **after** the env file was last written (§9.3 step 3).
- **Password.** If you re-ran step 3, `MANUAL_PASSWORD` changed, so re-run step 4 to seed users with the new password, and restart terminal 1.
- **Rate limit.** After repeated failed logins the API answers `Too many attempts. Please try again in 15 minutes.`, even with the right password. The counter is in memory, so restarting the backend clears it.

Error bodies include a `stack` field only because `NODE_ENV=development`; `brief` hides it. Production returns the fixed message only.

**Is the scribe ready? (B-1, B-2)**

```bash
# B-1 what the UI may offer — no hosts, URLs or keys in the answer
call $PROV GET /ai-scribe/capabilities; echo
# B-2 the scribe is for providers only
brief $PAT GET /ai-scribe/capabilities
```

| Check | Expect                                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-1   | `{"success":true,"message":"Capabilities retrieved","data":{"capabilities":{"available":true,"transcriptionAvailable":true,"draftingAvailable":true,"demoEnabled":true,"stt":{"kind":"mock","preset":"mock","model":"mock-scribe-1","location":"in-process"},"llm":{…same…}}}}`. The screens use this to decide which buttons to show. It names the kind of provider, never its address or key. |
| B-2   | `HTTP 403 · Insufficient permissions`                                                                                                                                                                                                                                                                                                                                                           |

**Session and consent — FR-1 (B-3 – B-7)**

The scribe visit was booked without AI consent, so nothing may be recorded until the provider records the patient's spoken consent.

```bash
# B-3 open a documentation session on clinic A's scribe visit
S=$(call $PROV POST /ai-scribe/session/start "{\"visitRecordId\":\"$(A scribeVisitRecordId)\"}")
SID=$(echo "$S" | j 'o.data.session.id'); echo "SID=$SID"
echo "$S" | j '"status="+o.data.session.status+" consent="+o.data.session.consent.status+" source="+o.data.session.consent.source'
# B-4 opening it again resumes the same session (no duplicates)
S2=$(call $PROV POST /ai-scribe/session/start "{\"visitRecordId\":\"$(A scribeVisitRecordId)\"}" | j 'o.data.session.id')
[ "$S2" = "$SID" ] && echo "same session resumed" || echo "✗ a second session was created"
# B-5 audio before consent is refused
upload $SID
# B-6 consent must be explicitly confirmed
brief $PROV POST /ai-scribe/session/$SID/consent '{"method":"VERBAL","acknowledged":false}'
# B-7 the provider records the patient's verbal consent
call $PROV POST /ai-scribe/session/$SID/consent '{"method":"VERBAL","acknowledged":true}' \
  | j '"consent="+o.data.session.consent.status+" source="+o.data.session.consent.source'
```

| Check | Expect                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------- |
| B-3   | `SID=<id>`, then `status=RECORDING consent=PENDING source=null`                                     |
| B-4   | `same session resumed`. If you open a new terminal later, this same command gives you `SID` back.   |
| B-5   | `HTTP 403 · consent_required · Patient consent is required before recording`, and no job is queued. |
| B-6   | `HTTP 400 · Confirm that the patient consented`                                                     |
| B-7   | `consent=GRANTED source=PROVIDER_ATTESTED_VERBAL`. The attestation is audited (D-4).                |

**Recording → transcript → draft — FR-2 – FR-6 (B-8 – B-12)**

```bash
# B-8 upload the synthetic recording
upload $SID
# B-9 the worker transcribes, labels speakers and drafts
waitdraft $SID
# B-10 what the draft holds, and which AI wrote it
call $PROV GET /ai-scribe/session/$SID | j 'const s=o.data.session; [
  "provenance: provider="+s.aiProvider+" model="+s.aiModel+" stt="+s.sttModel,
  "transcript: "+s.transcript.split("\n")[0],
  "assessment: "+s.aiDraft.assessment,
  "timeline:   "+s.timeline.symptoms.join(", "),
  "summary:    "+s.patientSummary.nextSteps,
  "continuity: "+s.timeline.continuity,
  "published:  "+s.patientSummaryPublished].join("\n")'
# B-11 detected orders: name, dose and quantity, mapped to the catalog
call $PROV GET /rx-cart/sessions/$SID/proposal | j 'o.data.proposal.lines.map(l=>l.rawText+" | dose "+l.dose+" | x"+l.quantity+" | "+l.matchStatus+(l.matchedProduct?" → "+l.matchedProduct.sku:"")).join("\n")'
# B-12 the patient sees nothing yet
call $PAT GET /visits/me/summaries | j '"patient sees "+o.data.summaries.length+" summaries"'
```

| Check | Expect                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-8   | `HTTP 200 · Audio uploaded, processing started`                                                                                                                                                                                                                                                                                                                                                                                           |
| B-9   | `0s  DRAFT_GENERATED`. The mock finishes in under a second, so you may not see `TRANSCRIBING` first. A real AI takes 5–60 s.                                                                                                                                                                                                                                                                                                              |
| B-10  | `provenance: provider=mock:mock model=mock-scribe-1 stt=mock-scribe-1` · `transcript: Provider: How have you been since the last visit?` · `assessment: Fatigue, improving on the current plan. Sleep maintenance difficulty.` · `timeline:   fatigue, afternoon low energy, night waking` · `summary:    Book a check-up in about six weeks.` · `continuity: null` (a first visit has nothing earlier to build on) · `published:  false` |
| B-11  | `Vitamin D3 \| dose 5000 IU \| x1 \| UNMAPPED` and `Magnesium glycinate \| dose 400 mg \| x2 \| MATCHED → MAG-400`. The dose is its own field (B2.2); vitamin D3 is not in the seed catalog.                                                                                                                                                                                                                                              |
| B-12  | `patient sees 0 summaries`                                                                                                                                                                                                                                                                                                                                                                                                                |

**Review: edit, regenerate, validation — FR-8, FR-16 (B-13 – B-17)**

```bash
# B-13 the provider edits one section
call $PROV PUT /ai-scribe/session/$SID/draft '{"plan":"Continue vitamin D3 and magnesium. Recheck in six weeks. (edited in the manual test)"}' \
  | j 'o.message+" · plan now: "+o.data.session.aiDraft.plan'
# B-14 an oversized section is refused
BIG=$(node.exe -e "console.log(JSON.stringify({subjective:'x'.repeat(20001)}))")
brief $PROV PUT /ai-scribe/session/$SID/draft "$BIG"
# B-15 an unknown field is refused
brief $PROV PUT /ai-scribe/session/$SID/draft '{"diagnosisCode":"Z00"}'
# B-16 regenerate: a fresh draft, with freshly detected products
BEFORE=$(call $PROV GET /rx-cart/sessions/$SID/proposal | j 'o.data.proposal.lines.map(l=>l.id).join(",")')
brief $PROV POST /ai-scribe/session/$SID/regenerate
waitdraft $SID
call $PROV GET /ai-scribe/session/$SID | j '"plan: "+o.data.session.aiDraft.plan'
AFTER=$(call $PROV GET /rx-cart/sessions/$SID/proposal | j 'o.data.proposal.lines.map(l=>l.id).join(",")')
[ -n "$AFTER" ] && [ "$AFTER" != "$BEFORE" ] && echo "products re-detected (new lines)" || echo "✗ products were not refreshed"
# B-17 "Approve & send" with an empty patient summary is refused
brief $PROV POST /ai-scribe/session/$SID/approve '{"sendToPatient":true,"patientSummary":{"diagnosis":"","treatmentPlan":"","nextSteps":""}}'
```

| Check | Expect                                                                                                                                                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-13  | `Draft updated · plan now: Continue vitamin D3 and magnesium. Recheck in six weeks. (edited in the manual test)`. The audit row names the field (`plan`), never the text (D-5).                                                                                   |
| B-14  | `HTTP 400 · A note section can be at most 20,000 characters`                                                                                                                                                                                                      |
| B-15  | `HTTP 400 · Unrecognized key: "diagnosisCode"`                                                                                                                                                                                                                    |
| B-16  | `HTTP 200 · Regeneration started`, then `0s  DRAFT_GENERATED`. Then `plan: Continue vitamin D3 5000 IU daily and magnesium glycinate 400 mg at night. Recheck in six weeks.`: the new draft replaces the edit from B-13. Then `products re-detected (new lines)`. |
| B-17  | `HTTP 400 · summary_required · Write the patient summary before sending it`                                                                                                                                                                                       |

**"Approve & send" and the patient boundary — FR-10 (B-18 – B-22)**

```bash
# B-18 approve and send, with the provider's own wording for the next steps
call $PROV POST /ai-scribe/session/$SID/approve '{"sendToPatient":true,"patientSummary":{"nextSteps":"MANUAL-GUIDE: book a check-up in six weeks."}}' \
  | j 'o.message+" · status="+o.data.session.status+" · published="+o.data.session.patientSummaryPublished'
# B-19 approving twice is refused
brief $PROV POST /ai-scribe/session/$SID/approve '{}'
# B-20 the patient now sees the summary — and only the summary
call $PAT GET /visits/me/summaries | j 'const s=o.data.summaries[0], t=JSON.stringify(o); [
  "summaries: "+o.data.summaries.length, "fields: "+Object.keys(s).join(","), "summary fields: "+Object.keys(s.summary).join(","),
  "next steps: "+s.summary.nextSteps,
  "contains transcript/SOAP? "+/Provider:|subjective|assessment|Sleep maintenance/.test(t)].join("\n")'
# B-21 the patient cannot open the scribe session
brief $PAT GET /ai-scribe/session/$SID
# B-22 a finalized visit takes no new session and no edits
brief $PROV POST /ai-scribe/session/start "{\"visitRecordId\":\"$(A scribeVisitRecordId)\"}"
brief $PROV PUT /ai-scribe/session/$SID/draft '{"plan":"late change"}'
```

| Check | Expect                                                                                                                                                                                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-18  | `Note approved and sent to the patient · status=APPROVED · published=true`. One request finalized the note, published the summary and built the cart, in one transaction.                                                                                                  |
| B-19  | `HTTP 400 · invalid_state · Draft must be ready before approval`                                                                                                                                                                                                           |
| B-20  | `summaries: 1` · `fields: sessionId,clinicId,visitRecordId,appointmentId,visitDate,providerName,publishedAt,summary` · `summary fields: diagnosis,treatmentPlan,nextSteps` · `next steps: MANUAL-GUIDE: book a check-up in six weeks.` · `contains transcript/SOAP? false` |
| B-21  | `HTTP 403 · Insufficient permissions`                                                                                                                                                                                                                                      |
| B-22  | `HTTP 400 · visit_finalized · Visit record is finalized`, then `HTTP 400 · invalid_state · Draft not available for editing`                                                                                                                                                |

**Another clinic — FR-16 (B-23 – B-26)**

Clinic B's provider tries clinic A's session and visit.

```bash
brief $BPROV GET /ai-scribe/session/$SID                                                  # B-23
brief $BPROV GET /ai-scribe/session/$SID/longitudinal                                     # B-24
brief $BPROV POST /ai-scribe/session/start "{\"visitRecordId\":\"$(A rxVisitRecordId)\"}" # B-25
call $BPROV GET /rx-cart/sessions/$SID/proposal; echo                                     # B-26
```

| Check | Expect                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-23  | `HTTP 404 · Session not found`. Clinic A's session does not exist for clinic B: not even a 403 that would confirm it exists.                              |
| B-24  | `HTTP 404 · Session not found`                                                                                                                            |
| B-25  | `HTTP 404 · Visit record not found`                                                                                                                       |
| B-26  | `{"success":true,"message":"Proposal retrieved","data":{"proposal":null}}`: the same answer as for an id that does not exist, with nothing from clinic A. |

**Record over time — FR-7 (B-27 – B-29)**

The same patient's next visit (`rxVisitRecordId`) should know about the visit you just approved.

```bash
# B-27 the next visit lists the approved one beside its draft
SID2=$(call $PROV POST /ai-scribe/session/start "{\"visitRecordId\":\"$(A rxVisitRecordId)\"}" | j 'o.data.session.id'); echo "SID2=$SID2"
call $PROV GET /ai-scribe/session/$SID2/longitudinal; echo
# B-28 the demo conversation fills a draft without audio (demo switch on in development)
brief $PROV POST /ai-scribe/session/$SID2/simulate
call $PROV GET /ai-scribe/session/$SID2 | j '"status="+o.data.session.status+" model="+o.data.session.aiModel'
# B-29 a draft from the AI now gets the earlier visit in its prompt
brief $PROV POST /ai-scribe/session/$SID2/regenerate
waitdraft $SID2
call $PROV GET /ai-scribe/session/$SID2 | j '"provider="+o.data.session.aiProvider+"\ncontinuity: "+o.data.session.timeline.continuity'
```

| Check | Expect                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-27  | `SID2=<id>`, then `{"success":true,"message":"Longitudinal record retrieved","data":{"visits":[{"visitRecordId":"<the scribe visit>","date":"…","assessment":"Fatigue, improving on the current plan. Sleep maintenance difficulty.","plan":"Continue vitamin D3 5000 IU daily …","products":[]}]}}`. `products` is empty because B-18 approved over the API without confirming any product; the browser run (F-10) shows a confirmed one. This read is audited. |
| B-28  | `HTTP 200 · Session simulated successfully`, then `status=DRAFT_GENERATED model=demo-simulation`. The demo uses a canned physiotherapy conversation (no AI call).                                                                                                                                                                                                                                                                                                |
| B-29  | `HTTP 200 · Regeneration started`, then `0s  DRAFT_GENERATED` (or `1s`), then `provider=mock:mock` and `continuity: Since the last visit: fatigue is improving on the same plan.` The mock writes that line only when the prompt contains `PRIOR APPROVED VISITS`, so this shows the earlier approved note reached the AI. It travels as a digest of dates, assessment and plan, with no names.                                                                  |

**The patient declines in the consultation room — FR-1 (B-30 – B-35)**

The consultation room is the video-visit screen. The patient answers the consent question from their join link.

```bash
# B-30 the provider opens the room for yesterday's appointment
R=$(call $PROV POST /appointments/$(A appointmentId)/consultation/start)
CONS=$(echo "$R" | j 'o.data.session.id'); TOKEN=$(echo "$R" | j 'o.data.session.joinToken')
echo "$R" | j 'o.message+" · status="+o.data.session.status+" · consent="+o.data.session.consentStatus'
# B-31 the patient opens the join link (here: the API behind it)
call $PAT GET /consultations/join/$TOKEN | j '"join: status="+o.data.session.status+" consent="+o.data.session.consentStatus'
# B-32 only the patient can decline
brief $PROV POST /consultations/$CONS/consent/decline
# B-33 the patient declines
brief $PAT POST /consultations/$CONS/consent/decline
# B-34 recording is now blocked, and the provider sees the decline
brief $PROV POST /consultations/$CONS/recording/start
call $PROV GET /consultations/appointment/$(A appointmentId) | j '"provider sees consent="+o.data.session.consentStatus'
# B-35 the decline also wins on the AI scribe path: the provider cannot attest over it
brief $PROV POST /visits "{\"appointmentId\":\"$(A appointmentId)\"}"
V3=$(call $PROV GET /visits/appointment/$(A appointmentId) | j 'o.data.visitRecord.id')
S3=$(call $PROV POST /ai-scribe/session/start "{\"visitRecordId\":\"$V3\"}")
S3ID=$(echo "$S3" | j 'o.data.session.id'); echo "$S3" | j '"scribe session consent="+o.data.session.consent.status'
brief $PROV POST /ai-scribe/session/$S3ID/consent '{"method":"VERBAL","acknowledged":true}'
upload $S3ID
```

| Check | Expect                                                                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-30  | `Consultation session ready · status=READY · consent=PENDING`                                                                                                                                |
| B-31  | `join: status=READY consent=PENDING`                                                                                                                                                         |
| B-32  | `HTTP 403 · Insufficient permissions`                                                                                                                                                        |
| B-33  | `HTTP 200 · Consent declined` (audited as `CONSENT_DECLINED`, D-4)                                                                                                                           |
| B-34  | `HTTP 400 · consent_required · Recording cannot start — patient consent is required`, then `provider sees consent=DECLINED`                                                                  |
| B-35  | `HTTP 201 · Visit record created` · `scribe session consent=DECLINED` · `HTTP 409 · consent_declined · The patient declined AI recording for this visit` · `HTTP 403 · consent_declined · …` |

### 9.6 Database checks (terminal 3)

These read the tables with the **owner** role, which bypasses the app. This is what a database dump or backup would show. Run them after §9.5, in the same terminal (they use `SID`).

```bash
V=$(A scribeVisitRecordId); CID=$(A clinicId)
PSQL="docker exec -i mf-pg psql -U postgres -d $MANUAL_DB -At -F | -c"
# D-1 provenance and consent source on the session
$PSQL "select status, \"patientSummaryPublished\", \"aiProvider\", \"aiModel\", \"sttModel\", \"consentSource\", \"consentRecordedAt\" is not null from \"AIScribeSession\" where \"visitRecordId\"='$V'"
# D-2 transcript, draft, summary and timeline are ciphertext
$PSQL "select left(transcript,22), left(\"aiDraft\"::text,24), left(\"patientSummary\"::text,24), left(timeline::text,24) from \"AIScribeSession\" where \"visitRecordId\"='$V'"
# D-3 the visit record is final, sealed, with one note version
$PSQL "select status, \"isFinalized\", left(assessment,24), (select count(*) from \"VisitNoteVersion\" v where v.\"visitRecordId\"='$V') from \"VisitRecord\" where id='$V'"
# D-4 this session's audit trail, oldest first
$PSQL "select string_agg(action, ' → ' order by \"createdAt\") from \"AuditLog\" where \"entityId\"='$SID'"
# D-5 what the audit rows record: provenance and field names, never text
$PSQL "select action, \"newValue\"::text from \"AuditLog\" where \"entityId\"='$SID' and action in ('CONSENT_ATTESTED','AI_DRAFT_GENERATED','AI_DRAFT_EDITED','AI_DRAFT_REGENERATED') order by \"createdAt\""
# D-6 no clinical text in any of the clinic's audit rows
$PSQL "select count(*) from \"AuditLog\" where \"clinicId\"='$CID' and (coalesce(\"newValue\"::text,'')||coalesce(\"oldValue\"::text,'')) ~* '(fatigue|vitamin|magnesium|six weeks|Provider:)'"
# D-7 detected orders: text and dose are ciphertext
$PSQL "select left(l.\"rawText\",24), left(l.dose,24), l.quantity from \"RxOrderLine\" l join \"RxOrderProposal\" p on p.id=l.\"proposalId\" where p.\"visitRecordId\"='$V' order by l.position"
# D-8 the consultation room's decline is stored
$PSQL "select \"consentStatus\", \"recordingStatus\" from \"ConsultationSession\" where \"clinicId\"='$CID'"
# D-9 a note version cannot be changed — not even by the database owner
$PSQL "update \"VisitNoteVersion\" set plan='tampered' where \"visitRecordId\"='$V'"
$PSQL "select count(*) from \"VisitNoteVersion\" where \"visitRecordId\"='$V' and plan='tampered'"
```

| Check | Expect                                                                                                                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1   | `APPROVED\|t\|mock:mock\|mock-scribe-1\|mock-scribe-1\|PROVIDER_ATTESTED_VERBAL\|t`                                                                                                                                                                                                                     |
| D-2   | Every value starts `fle:v1:k1:AIScribeSess…` (JSON values with a leading `"`). No readable text.                                                                                                                                                                                                        |
| D-3   | `FINAL\|t\|fle:v1:k1:VisitRecord.as\|1`                                                                                                                                                                                                                                                                 |
| D-4   | `AI_SCRIBE_SESSION_CREATED → CONSENT_ATTESTED → AI_DRAFT_GENERATED → READ → AI_DRAFT_EDITED → READ → AI_DRAFT_REGENERATED → READ → PATIENT_SUMMARY_PUBLISHED → READ`. Each `READ` is a response that returned the transcript or draft, so you see more of them if you ran the read commands more often. |
| D-5   | `CONSENT_ATTESTED\|{"source": "PROVIDER_ATTESTED_VERBAL"}` · `AI_DRAFT_GENERATED\|{"aiModel": "mock-scribe-1", "sttModel": "mock-scribe-1", "aiProvider": "mock:mock"}` · `AI_DRAFT_EDITED\|{"fields": ["plan"]}` · `AI_DRAFT_REGENERATED\|{…same as generated…}`                                       |
| D-6   | `0`                                                                                                                                                                                                                                                                                                     |
| D-7   | Two rows: `fle:v1:k1:RxOrderLine.ra\|fle:v1:k1:RxOrderLine.do\|1` and `…\|2`                                                                                                                                                                                                                            |
| D-8   | `DECLINED\|NOT_STARTED`                                                                                                                                                                                                                                                                                 |
| D-9   | `ERROR:  VisitNoteVersion is immutable: add a new version instead of editing <id>`, then `0`. An amendment is always a new version, never an edit of an old one.                                                                                                                                        |

### 9.7 Frontend checks in the browser (clinic B)

Open Chrome at `http://localhost:3000`. Keep **DevTools → Network** open for the whole test, with **Preserve log** ticked: you search it at F-13.

**Signing in.** Open `http://localhost:3000/?auth=login`, enter the user's email and `$MANUAL_PASSWORD` (the password from §9.3 step 3), then click **Sign in**. Sign out (avatar menu) before switching user, or use a second browser profile or an Incognito window for the patient. Print clinic B's emails and ids in terminal 3:

```bash
node.exe -pe "const s=require('./uploads/.manual-scribe-seed-b.json');['provider: '+s.emails.provider,'patient:  '+s.emails.patient,'console:  http://localhost:3000/dashboard/provider/visits/'+s.scribeVisitRecordId+'/scribe','next:     http://localhost:3000/dashboard/provider/visits/'+s.rxVisitRecordId+'/scribe','room:     http://localhost:3000/dashboard/provider/appointments/'+s.appointmentId+'/consultation'].join('\n')"
```

**As clinic B's provider: the AI Scribe console**

| #   | Do                                                                                                                                                    | Expect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | Open the **console** URL. Click **Start documentation session**.                                                                                      | The page "AI Scribe Console · Documentation assistant" shows "Start documentation", then an amber panel **"Patient consent is needed before recording"**: "The patient did not opt in when booking. Ask them now…". **Start recording** and **Upload a recording** are greyed out. **Record consent** stays disabled until the box is ticked. **Demo: simulate conversation** and **Write note manually** are also offered.                                                                                                                                                                                                                  |
| F-2 | Tick **"The patient gave verbal consent to AI recording for this visit"** → **Record consent**.                                                       | Toast **"Consent recorded"**. The amber panel disappears; **Start recording** and **Upload a recording** are enabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F-3 | **Upload a recording** → pick `E:\advertout\MedoFlow\backend\uploads\.manual-scribe-consult.wav`.                                                     | A blue **"Uploading the recording… N%"** bar (it may only flash, because the file is small), then **"Transcribing and drafting the note — usually under a minute."**, then the review screen within seconds.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F-4 | Read the review screen.                                                                                                                               | **"Drafted by mock-scribe-1"** above the note, with "Drafted by AI from the conversation — check every section…". Subjective, Objective, Assessment and Plan are filled (Assessment: "Fatigue, improving on the current plan. Sleep maintenance difficulty."). A green **Patient summary** box has **What we found / What we recommended / What to do next** filled ("Book a check-up in about six weeks."). On the right: a **Transcript** card ("Provider: How have you been since the last visit?" …), a **Clinical Timeline**, and **Record over time**: "First approved visit for this patient — there is no earlier note to build on." |
| F-5 | Look at **Detected products**.                                                                                                                        | A chip **"Magnesium Glycinate · 400 mg × 2"**. Under **"Not matched to your catalog — map it to a product, or it will not be sent"**: **"Vitamin D3 5000 IU × 1"** with a **"Map Vitamin D3 to a product"** dropdown. "On approval: 1 to the patient's cart." **Approve & send** is disabled, with **"Confirm the detected products before sending"**.                                                                                                                                                                                                                                                                                       |
| F-6 | Click **Regenerate draft**.                                                                                                                           | Toast **"Regenerating the AI draft…"**, the "Transcribing and drafting…" panel, then the review again with a fresh draft. Any unsaved edits are replaced. The products panel reloads with the new lines.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F-7 | Change the **Plan** text. Then clear all three patient-summary fields. Then type into **What to do next**: `Synthetic: book a check-up in six weeks.` | With the summary empty: **"Write the patient summary before sending it"** and the button stays disabled. With text in it again, only the product confirmation is missing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F-8 | Tick **"I confirm these products for this patient"** → **Approve & send**.                                                                            | Toast **"Note approved and sent · 1 product sent to the patient's cart"**. A green panel **"Note approved and sent"**: "The patient can read their summary in the portal. The note is in the record." The note fields are now read-only, and there is no approve button.                                                                                                                                                                                                                                                                                                                                                                     |
| F-9 | Click **Version history**.                                                                                                                            | A dialog **"Note Version History"**, which may briefly say "Loading versions…", then: **Version 1 · CURRENT**, today's date "by Synthetic Provider", and the note's sections. **Esc** closes it.                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**As clinic B's provider: the next visit, recorded with the microphone**

| #    | Do                                                                                                                                                                                                                                                                                  | Expect                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-10 | Open the **next** URL → **Start documentation session** → tick the consent box → **Record consent** → **Start recording**. Chrome asks to use the microphone: click **Allow**. Say anything for about 5 seconds (the mock ignores the words), then click **Stop & process · 0:05**. | The button counts the seconds while you speak, then the review screen appears. **Record over time** lists the visit from F-8: its date, "Assessment: Fatigue, improving…", "Plan: <your F-7 plan text>", and **"Sent: Magnesium Glycinate 400 mg × 2"**. Above the note, a blue box **"Since the last visit (AI, check before approving)"** reads "Since the last visit: fatigue is improving on the same plan." |
| F-11 | Microphone refused: click the icon left of the address bar → **Site settings** → **Microphone: Block**, reload, then click **Start recording**. Set it back to **Allow** afterwards.                                                                                                | **"Microphone access denied. Please allow microphone access in your browser settings."** Nothing is uploaded. (Not driven by Playwright; see §9 Validated.)                                                                                                                                                                                                                                                      |

**As clinic B's patient** (sign out first, or use another browser profile)

| #    | Do                                                                                                                            | Expect                                                                                                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-12 | Open `http://localhost:3000/account/summaries`.                                                                               | One card: the visit date (3 days ago), "With Synthetic Provider", **View appointment**, and "NEXT STEPS · Synthetic: book a check-up in six weeks." There is no SOAP note, no transcript, and nothing from the visit in F-10 (it was not approved). |
| F-13 | In DevTools → Network, type each of these into the filter box in turn: `Quinn`, `Marlowe`, `fatigue`, `vitamin`, `magnesium`. | **No request URL matches any of them.** Clinical text travels only inside request and response bodies, never in a URL.                                                                                                                              |

**The consultation room: the patient declines** (two browsers: provider and patient)

| #    | Do                                                                                                                                                                                                                                               | Expect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-14 | **Provider:** open the **room** URL. **Patient** (other browser, signed in as clinic B's patient): open the join link shown in the provider's room (click **Copy** next to it). Click **No, do not record**. Then **provider:** reload the room. | Provider room: "Consultation Room · AWAITING CONSENT", "Waiting for patient consent", the join link and **Copy**. Patient page: "Your provider would like to record this consultation for medical documentation purposes…", with **I Consent to Recording** and **No, do not record**. After declining: **"Recording declined"**: "This consultation will not be recorded. Your visit goes ahead as normal and your provider takes notes by hand.", plus "Changed your mind? Allow recording". The provider's room after reload: **"The patient declined AI recording"**: "This consultation will not be recorded or sent to the AI. Document the visit manually.", with **Write note manually**. |

### 9.8 Production refuses unsafe AI settings (terminal 3)

In production the backend checks the AI settings when it starts, and refuses to start when the scribe would send patient data somewhere without a BAA (the HIPAA contract). This runs that same check (`services/ai/egressPolicy.ts`, called at boot by `envValidation.ts`) without starting a server and without contacting anyone. `dummy-not-a-key` is not a key.

```bash
gate() { env -i PATH="$PATH" SYSTEMROOT="$SYSTEMROOT" NODE_ENV=production "$@" node.exe -r ts-node/register/transpile-only -e "const {scribeEgressProblems}=require('./src/services/ai/egressPolicy');const p=scribeEgressProblems();if(!p.length)console.log('  OK: no problems');for(const x of p)console.log('  '+(x.fatal?'FATAL':'WARN ')+' '+x.message)"; }
echo "P-1 OpenAI, no BAA entry";              gate AI_SCRIBE_LLM_PRESET=openai AI_SCRIBE_LLM_API_KEY=dummy-not-a-key AI_SCRIBE_STT_PRESET=openai
echo "P-2 OpenAI, BAA entry";                 gate AI_SCRIBE_LLM_PRESET=openai AI_SCRIBE_LLM_API_KEY=dummy-not-a-key AI_SCRIBE_STT_PRESET=openai AI_SCRIBE_BAA_HOSTS=api.openai.com
echo "P-3 Gemini Developer API, even listed"; gate AI_SCRIBE_LLM_PRESET=gemini AI_SCRIBE_LLM_API_KEY=dummy-not-a-key AI_SCRIBE_STT_PRESET=groq AI_SCRIBE_STT_API_KEY=dummy AI_SCRIBE_BAA_HOSTS=generativelanguage.googleapis.com,api.groq.com
echo "P-4 Groq on the synthetic demo";        gate AI_SCRIBE_LLM_PRESET=groq AI_SCRIBE_LLM_API_KEY=dummy-not-a-key AI_SCRIBE_STT_PRESET=groq AI_SCRIBE_PHI_POLICY=synthetic-data-only
echo "P-5 mock in production";                gate AI_SCRIBE_LLM_PROVIDER=mock AI_SCRIBE_STT_PROVIDER=mock AI_SCRIBE_PHI_POLICY=synthetic-data-only
echo "P-6 plain http to a remote host";       gate AI_SCRIBE_LLM_PRESET=custom AI_SCRIBE_LLM_BASE_URL=http://llm.example.com/v1 AI_SCRIBE_LLM_MODEL=m AI_SCRIBE_LLM_API_KEY=k AI_SCRIBE_STT_PROVIDER=disabled AI_SCRIBE_BAA_HOSTS=llm.example.com
echo "P-7 self-hosted Ollama + whisper";      gate AI_SCRIBE_LLM_PRESET=ollama AI_SCRIBE_STT_PRESET=whisper-server
```

`env -i` runs each check with only the settings on its line, so nothing from your terminal or `.env` files leaks in. Each line takes a few seconds.

| Check | Expect                                                                                                                                                                                                      | Why                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| P-1   | Two lines: `FATAL AI_SCRIBE_LLM sends PHI to api.openai.com, which is not in AI_SCRIBE_BAA_HOSTS — add it only after its BAA and zero-retention are confirmed in writing`, and the same for `AI_SCRIBE_STT` | No signed BAA on record for that host: no start.                             |
| P-2   | `OK: no problems`                                                                                                                                                                                           | The host is on the BAA register.                                             |
| P-3   | `FATAL AI_SCRIBE_LLM points at the Gemini Developer API (generativelanguage.googleapis.com), which cannot be covered by a BAA — use the vertex-gemini preset for real patient data`                         | Refused even when listed: Google offers no BAA for the AI Studio API.        |
| P-4   | Two `WARN  AI_SCRIBE_PHI_POLICY=synthetic-data-only: allowed for synthetic data only — …api.groq.com…` lines, no FATAL                                                                                      | The hosted demo's explicit opt-out: it starts, and warns on every boot.      |
| P-5   | `FATAL AI_SCRIBE_LLM_PROVIDER=mock is for tests only` and the same for STT                                                                                                                                  | The opt-out never allows the mock.                                           |
| P-6   | `FATAL AI_SCRIBE_LLM_BASE_URL must use https:// for an external host (llm.example.com)`, plus a `WARN` that the scribe is not fully configured (STT is off on that line)                                    | Patient audio never crosses the internet unencrypted.                        |
| P-7   | `OK: no problems`                                                                                                                                                                                           | Self-hosted on this machine: no patient data leaves it, so no BAA is needed. |

### 9.9 Switch to a real AI: Groq (R-1 – R-4) · run 2026-10-30

From here on the same setup talks to a real speech-to-text and a real LLM: Groq's hosted Whisper (`whisper-large-v3-turbo`) and OpenAI's open-weight GPT-OSS (`openai/gpt-oss-120b`), the Groq preset's defaults. One free Groq key covers both. Both models are in the list of base models Groq offers; Llama models are not, so the preset no longer uses them. §9.10 then runs the whole flow in the browser.

- **What you need first.** §9.3 and §9.4 done: setup finished, both apps running, and the §9.5 helper block pasted in terminal 3 (it defines `call`, `j` and `login`). §9.5 – §9.8 are optional: you can come here straight after §9.4.
- **A Groq key.** Create one at <https://console.groq.com> → **API Keys** (free, no card needed). It starts with `gsk_`. If your account offers it, turn on zero data retention under **Settings → Data Controls**.
- **Synthetic data only.** Groq's free tier comes with no BAA. Send only the §9.3 recording and the scripts in §9.10; never say or upload anything about a real person. From R-3 on, the recording and whatever you read aloud leave your machine for Groq.
- **Free-tier limits.** At the time of writing, Groq's published limits are:
  - `openai/gpt-oss-120b` and `openai/gpt-oss-20b`: 30 requests and 8,000 tokens a minute, 1,000 requests and 200,000 tokens a day.
  - `whisper-large-v3-turbo`: 20 requests a minute, 2,000 a day.

  Your own numbers are under **Settings → Limits** in the Groq console. One draft makes one transcription and two LLM calls (speaker labels, then the note). GPT-OSS reasons before it answers, and that reasoning counts as tokens, so one draft uses a few thousand of the 8,000 a minute. The whole of §9.10 stays far below the daily limits. The per-minute token limit is the one you can hit: leave about a minute between drafts, and do not click **Regenerate draft** several times in a row. The reasoning itself is never shown or stored; only the answer is.

**R-1. Put your key into the throwaway env file** (terminal 3). The key goes into a hidden prompt, so it never appears on screen, in the terminal history or in a command line. The block replaces the two mock lines with the Groq settings.

```bash
cd /e/advertout/MedoFlow/backend
read -rsp "Paste your Groq key (nothing is shown), then press Enter: " GK; echo
case "$GK" in gsk_?*) sed -i '/^AI_SCRIBE_/d' .env.manual-scribe.local
  printf 'AI_SCRIBE_LLM_PRESET=groq\nAI_SCRIBE_LLM_API_KEY=%s\nAI_SCRIBE_STT_PRESET=groq\n' "$GK" >> .env.manual-scribe.local
  echo "✓ key saved";; *) echo "✗ not saved: a Groq key starts with gsk_";; esac
unset GK
grep -E '^AI_SCRIBE_' .env.manual-scribe.local | sed -E 's/(API_KEY=gsk_).*/\1…(hidden)/'
```

Paste the key with **Shift+Insert** or right-click → **Paste**, then press Enter. Expect:

```
✓ key saved
AI_SCRIBE_LLM_PRESET=groq
AI_SCRIBE_LLM_API_KEY=gsk_…(hidden)
AI_SCRIBE_STT_PRESET=groq
```

- There is no separate key for transcription. When both presets name the same vendor, the transcription side reuses the LLM key.
- The file is gitignored, and §9.12 deletes it, key included.
- Running the §9.3 step 3 block again overwrites this file with the mock settings and a new password. If that happens, run §9.3 step 4 and R-1 again.

**R-2. Is the key valid?** One request goes straight to Groq and lists the models your key may use. The key is read from the env file and handed to curl on stdin, so it never appears in a command line either.

```bash
set -a; . ./.env.manual-scribe.local; set +a
printf 'authorization: Bearer %s\n' "$AI_SCRIBE_LLM_API_KEY" | curl -s -H @- https://api.groq.com/openai/v1/models \
  | j 'o.error ? "✗ "+o.error.message : "key OK · "+["whisper-large-v3-turbo","openai/gpt-oss-120b","openai/gpt-oss-20b"].map(m=>m+(o.data.some(d=>d.id===m)?" ✓":" ✗")).join(" · ")'
```

Expect `key OK · whisper-large-v3-turbo ✓ · openai/gpt-oss-120b ✓ · openai/gpt-oss-20b ✓`. The third model is the one R-19 switches to. A ✗ after a model means your key cannot use it: see Troubleshooting. `✗ Invalid API Key` means the key was pasted incompletely, or it was revoked: copy it again from the Groq console and repeat R-1.

**R-3. Restart the backend on Groq.** Terminal 1: Ctrl+C, then:

```bash
cd /e/advertout/MedoFlow/backend
unset ${!AI_SCRIBE_@}
set -a; . ./.env.manual-scribe.local; set +a
corepack pnpm exec ts-node --transpile-only src/server.ts 2>&1 | tee -a uploads/.manual-scribe-backend.log
```

- `unset ${!AI_SCRIBE_@}` clears the AI settings this terminal loaded from the old file. Loading the new file adds settings but never removes old ones, so without this line `AI_SCRIBE_LLM_PROVIDER=mock` would still be set and would still win.
- `tee -a` appends to the log instead of overwriting it, so R-24 searches every run, mock and Groq.
- §9.10 restarts the backend a few times. Each time, run this same block.

Expect the four lines from §9.4, plus two reminders that Groq has no BAA on record:

```
[WARN] AI_SCRIBE_LLM sends PHI to api.groq.com, which is not in AI_SCRIBE_BAA_HOSTS — add it only after its BAA and zero-retention are confirmed in writing
[WARN] AI_SCRIBE_STT sends PHI to api.groq.com, which is not in AI_SCRIBE_BAA_HOSTS — …
```

In development these are warnings, and acceptable for synthetic data. In production the same check refuses to start (P-1).

**R-4. The backend now uses Groq** (terminal 3):

```bash
PROV=$(login "$(A emails.provider)")
call $PROV GET /ai-scribe/capabilities | j 'const c=o.data.capabilities; ["available="+c.available+" demo="+c.demoEnabled,
  "stt: "+JSON.stringify(c.stt), "llm: "+JSON.stringify(c.llm), "key in the answer? "+/gsk_/.test(JSON.stringify(o))].join("\n")'
```

Expect:

```
available=true demo=true
stt: {"kind":"openai-compatible","preset":"groq","model":"whisper-large-v3-turbo","location":"external"}
llm: {"kind":"openai-compatible","preset":"groq","model":"openai/gpt-oss-120b","location":"external"}
key in the answer? false
```

Only the settings changed: same code, same database, same screens.

**A fresh clinic for the real-AI run (clinic R).** Its three visits are untouched, so nothing from the mock run is mixed into the real drafts, and its record over time starts empty.

```bash
E2E_LIVE_PASSWORD=$MANUAL_PASSWORD DATABASE_URL=postgresql://postgres:postgres@localhost:55432/$MANUAL_DB \
  corepack pnpm exec ts-node --transpile-only scripts/seed-e2e-live.ts > uploads/.manual-scribe-seed-r.json
RC() { node.exe -pe "require('./uploads/.manual-scribe-seed-r.json').$1"; }
node.exe -pe "const s=require('./uploads/.manual-scribe-seed-r.json'),u='http://localhost:3000/dashboard/provider/';['provider: '+s.emails.provider,'patient:  '+s.emails.patient,'password: '+process.env.MANUAL_PASSWORD,'console:  '+u+'visits/'+s.scribeVisitRecordId+'/scribe','next:     '+u+'visits/'+s.rxVisitRecordId+'/scribe','room:     '+u+'appointments/'+s.appointmentId+'/consultation'].join('\n')"
```

Expect six lines: clinic R's provider and patient emails (`…@example.test`), the password, and the three URLs §9.10 opens. Keep them on screen. `RC` reads clinic R's seed file, the same way `A` and `B` read theirs.

### 9.10 Real AI in the browser (R-5 – R-27) · run 2026-10-30

This runs the whole provider and patient flow on screen against Groq:

- **A.** the AI Scribe console with the synthetic recording;
- **B.** the next visit, recorded live with the microphone, which builds on the first;
- **C.** the consultation room, where the patient consents from their own browser;
- **D.** a model switch and a bad-key drill, both configuration only;
- **E.** the patient portal, and what the browser sent;
- **F.** terminal checks that nothing leaked into logs, the database or the queue.

**How to read the results.** A real model words things differently on every run, so check meaning, not exact text. These must hold on every run, and a miss is a defect to note in the result sheet:

- the facts in the draft come from the recording;
- nothing is invented: no vitals, exam findings, tests or products that nobody mentioned;
- doses and quantities match what was said;
- nothing reaches the patient before you approve.

**Timing.** Expect 5–30 s from upload to the review screen; the mock took under a second. Up to a minute is normal on a busy free tier. If a red panel says "The AI service is busy (rate limited)", wait a minute and click **Retry** (§9.14).

**Before you start:**

- **Provider window.** Chrome at `http://localhost:3000`, with DevTools → **Network** open and **Preserve log** ticked for the whole section: R-23 searches it.
- **Patient window.** A second window, Incognito or another Chrome profile, for clinic R's patient (sections C and E).
- **Signing in.** Open `http://localhost:3000/?auth=login` and use the emails and password printed at the end of §9.9.
- **A microphone and a quiet room** for B and C. You read both the doctor's and the patient's lines yourself. Speak at a normal pace; you need not say "Doctor" or "Patient" aloud, because the AI labels the speakers from what is said.

**The scripts.** All synthetic. Script 1 is the recording from §9.3 step 5 (fatigue, vitamin D3, magnesium).

> **Script 2: the next visit (B, about 20 s)**
>
> Doctor: Good to see you again. How is your energy now?
>
> Patient: Much better. I only feel tired on some afternoons, and I sleep through most nights now.
>
> Doctor: That is good progress. Keep taking magnesium glycinate, four hundred milligrams at night, one more bottle. You can stop the vitamin D3 when your bottle runs out. Let us review in three months.

> **Script 3: the consultation room (C, about 30 s)**
>
> Doctor: What brings you in today?
>
> Patient: My lower back has been stiff for about a week, since I moved some furniture. It is worse in the morning.
>
> Doctor: Any numbness, or pain going down your legs?
>
> Patient: No, nothing like that.
>
> Doctor: This sounds like a muscle strain. Use a heat pack twice a day and keep walking. Apply arnica gel to the sore area twice a day, one tube. And take turmeric curcumin, five hundred milligrams daily, one bottle. Come back in two weeks if it is not better.

**A. The AI Scribe console, with the synthetic recording** (clinic R's provider, the **console** URL)

| #    | Do                                                                                                                                                                                                  | Expect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-5  | Sign in as clinic R's provider and open the **console** URL. Click **Start documentation session**. Tick **"The patient gave verbal consent to AI recording for this visit"** → **Record consent**. | As in F-1 and F-2: the amber panel **"Patient consent is needed before recording"**, then the toast **"Consent recorded"**. **Start recording** and **Upload a recording** become enabled.                                                                                                                                                                                                                                                                                                                                    |
| R-6  | **Upload a recording** → pick `E:\advertout\MedoFlow\backend\uploads\.manual-scribe-consult.wav`. Note the time.                                                                                    | The toast **"Recording uploaded — the AI is drafting the note"**, the blue **"Uploading the recording… N%"** bar, then **"Transcribing and drafting the note — usually under a minute."** The review screen appears after 5–30 s: this is the real AI working.                                                                                                                                                                                                                                                                |
| R-7  | Read the label above the note, then the **Transcript** card on the right. Compare it with the script in §9.3 step 5.                                                                                | **"Drafted by openai/gpt-oss-120b · groq"**, where F-4 showed "Drafted by mock-scribe-1". The transcript is what the recording says, split into lines that start **"Provider:"** and **"Patient:"**. The questions and the plan are on Provider lines; "Better. The tiredness is easing…" and the waking at three are on Patient lines. The recording speaks the words "Doctor" and "Patient", so they may appear in the text. Small slips in wording are normal for speech-to-text; words that were never said are a defect. |
| R-8  | Read the four note sections.                                                                                                                                                                        | **Subjective:** fatigue easing, low energy in the afternoon, waking around 3 a.m. most nights. **Objective:** "Not discussed.": nobody examined anything, so vitals or exam findings here would be invented. **Assessment:** fatigue, improving, and the sleep problem. **Plan:** vitamin D3 5000 IU daily, magnesium glycinate 400 mg at night, recheck in six weeks.                                                                                                                                                        |
| R-9  | Read the green **Patient summary** box, the **Clinical Timeline** and **Record over time**.                                                                                                         | The summary is plain language a patient can follow, with no transcript and no SOAP headings. **What we found:** the tiredness is improving. **What we recommended:** the two supplements, with their doses. **What to do next:** a check-up in about six weeks. The timeline lists the symptoms, the impression and the plan steps. **Record over time:** "First approved visit for this patient — there is no earlier note to build on.", and there is no "Since the last visit" box.                                        |
| R-10 | Look at **Detected products**.                                                                                                                                                                      | **"Magnesium Glycinate · 400 mg × 2"**, matched to the catalog. Under **"Not matched to your catalog — map it to a product, or it will not be sent"**: **"Vitamin D3 5000 IU × 1"** (the seed catalog has no vitamin D3). The doses and quantities come from the recording: 5000 IU and one bottle, 400 mg and two bottles. **Approve & send** is disabled, with **"Confirm the detected products before sending"**.                                                                                                          |
| R-11 | Click **Regenerate draft** and wait for the new draft. Change one word in **Plan**. Tick **"I confirm these products for this patient"** → **Approve & send**. Then click **Version history**.      | A fresh draft after 5–30 s. Its wording may differ from R-8; its facts must not. The products panel reloads with the same two products. Then the toast **"Note approved and sent · 1 product sent to the patient's cart"** and the green panel **"Note approved and sent"**. Version history: **Version 1 · CURRENT**, with your edited plan.                                                                                                                                                                                 |

**B. The next visit, recorded live: the real AI builds on the first visit** (the **next** URL)

| #    | Do                                                                                                                                                                                                                                        | Expect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-12 | Open the **next** URL → **Start documentation session** → tick the consent box → **Record consent** → **Start recording**. If Chrome asks for the microphone, click **Allow**. Read script 2 aloud, then click **Stop & process · 0:2x**. | The button counts the seconds while you speak. The browser records webm audio and sends it to MedoFlow's API only (R-23 checks this). The review screen appears after 5–30 s.                                                                                                                                                                                                                                                                                                                          |
| R-13 | Read the transcript and the note.                                                                                                                                                                                                         | The transcript is what **you** said. This is the proof of real transcription of a live browser recording, because the mock always returned the same canned text. **Subjective:** energy much better, tired on some afternoons, sleeping through most nights. **Plan:** continue magnesium glycinate 400 mg at night; stop vitamin D3 when the bottle runs out; review in three months.                                                                                                                 |
| R-14 | Look at **Record over time**, and at the blue box above the note.                                                                                                                                                                         | **Record over time** lists the visit approved in R-11: its date, its assessment and plan, and **"Sent: Magnesium Glycinate 400 mg × 2"**. The blue box **"Since the last visit (AI, check before approving)"** holds one or two sentences the model wrote by comparing with that visit, for example that the energy has improved since the fatigue was treated. This is FR-7 with a real model: the earlier approved note reached the prompt, as a digest of dates, assessment and plan with no names. |
| R-15 | Look at **Detected products**. **Do not approve yet:** D uses this draft.                                                                                                                                                                 | **"Magnesium Glycinate · 400 mg × 1"**, matched. Vitamin D3 was mentioned only as something to stop, so ideally it is not listed. If it is, that is the model's judgement: it is unmatched, so it would not be sent anyway. Note it in the result sheet; the provider is the one who decides.                                                                                                                                                                                                          |

**C. The consultation room: the patient consents, the provider records** (the **room** URL, two windows)

| #    | Do                                                                                                                                                                                                                                                                   | Expect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-16 | **Provider window:** open the **room** URL. **Patient window:** sign in as clinic R's patient, then open the join link from the provider's room (click **Copy** next to it). Click **I Consent to Recording**.                                                       | **Provider:** "Consultation Room", **"Waiting for patient consent"**: "Recording cannot start until the patient grants consent…", with the join link and **Copy**. **Patient:** "Medoflow Consultation", **"Recording Consent Required"**, then **"Consent Granted"**: "You've consented to recording. Your provider can now begin the consultation recording.", and "Waiting for your provider to start the video call…".                                                                                                  |
| R-17 | **Provider:** reload the room. Click **Start manual recording**. Do not use the video call: it connects to an outside video service and is not part of this test. Allow the microphone, read script 3 aloud, click **Stop recording**, then **Upload & transcribe**. | The AI Scribe card reads "Ready to record", then "Recording in progress" with a timer, then "Recording complete · 0:3x · 0.x MB" and the **Upload & transcribe** button. Then "Uploading audio…" and "Transcribing & analysing…". After 5–30 s the same review panel as the console appears below it, with **"Drafted by openai/gpt-oss-120b · groq"**. **Patient window**, reloaded: "Your provider is processing the consultation notes. You'll see your summary once it's approved and published."                       |
| R-18 | Read the draft and **Detected products**. Tick **"I confirm these products for this patient"** → **Approve & send**.                                                                                                                                                 | The note is about the back: stiff for a week after moving furniture, worse in the morning, no numbness or leg pain; assessment a muscle strain; plan of heat, walking, the two products and a review in two weeks. **Both products match the catalog:** **Arnica Gel** × 1 (no strength was said, so there is no dose) and **Turmeric Curcumin · 500 mg × 1**. The "Since the last visit" box may refer to the earlier fatigue visits. Then the toast **"Note approved and sent · 2 products sent to the patient's cart"**. |

**D. A configuration-only model switch, and a bad-key drill** (terminals 1 and 3, the R-12 draft)

| #    | Do                                                                                                                                                                                                                                                                      | Expect                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-19 | **Switch the model.** Terminal 3: `echo AI_SCRIBE_LLM_MODEL=openai/gpt-oss-20b >> .env.manual-scribe.local`. Terminal 1: Ctrl+C, then the R-3 block. Browser: open the **next** URL again and click **Regenerate draft**.                                               | A new draft labelled **"Drafted by openai/gpt-oss-20b · groq"**. This smaller, faster model may word things differently or more briefly, but the facts must still match script 2. One line of configuration changed the model; no code changed.                                                                                                                                                                  |
| R-20 | **Bad key.** Run the block below in terminal 3: it saves a copy of the good file, then breaks the key. Terminal 1: Ctrl+C, then the R-3 block. Browser: **Regenerate draft** on the same draft. Then click **Write note manually**, and close that dialog with **Esc**. | Within seconds a red panel, **"The AI could not draft this note"**: "The AI service rejected our credentials. An administrator must check the AI settings.", with **Retry** and **Write note manually**. A rejected key is not retried, so it fails at once. None of Groq's own error text appears. **Write note manually** opens "Document this visit" (badge "Manual SOAP note"): the provider is never stuck. |
| R-21 | **Recovery.** Terminal 3: `mv .env.manual-scribe-good.local .env.manual-scribe.local`. Terminal 1: Ctrl+C, then the R-3 block. Browser: click **Retry**. When the draft is back, tick the product confirmation → **Approve & send**.                                    | "Transcribing and drafting the note…", then the review screen again after 5–30 s, with **"Drafted by openai/gpt-oss-120b · groq"**: the good file from before R-19's switch is back. The R-12 recording was kept, so nothing had to be recorded again. Then the toast **"Note approved and sent · 1 product sent to the patient's cart"**.                                                                       |

The R-20 block (terminal 3):

```bash
sed -i '/^AI_SCRIBE_LLM_MODEL=/d' .env.manual-scribe.local
cp .env.manual-scribe.local .env.manual-scribe-good.local
sed -i -E 's/^(AI_SCRIBE_LLM_API_KEY=gsk_).*/\1this-key-is-wrong/' .env.manual-scribe.local
grep -E '^AI_SCRIBE_' .env.manual-scribe.local
```

Expect `AI_SCRIBE_LLM_PRESET=groq`, `AI_SCRIBE_LLM_API_KEY=gsk_this-key-is-wrong` and `AI_SCRIBE_STT_PRESET=groq`. The copy `.env.manual-scribe-good.local` is gitignored too (`.env.*.local`), and R-21 moves it back.

**E. The patient, and what the browser sent**

| #    | Do                                                                                                                                                                                                              | Expect                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-22 | **Patient window:** open `http://localhost:3000/account/summaries`.                                                                                                                                             | Three cards, one for each approved visit (R-11, R-18 and R-21), each "With Synthetic Provider" and a **NEXT STEPS** line in plain language. No SOAP note, no transcript, and nothing the provider did not approve.                                                                                                                                                                                                                  |
| R-23 | **Provider window,** DevTools → Network: type each of these into the filter box in turn: `groq`, `whisper`, `gpt-oss`; then `audio` and `recording`; then `Quinn`, `Marlowe`, `fatigue`, `magnesium`, `arnica`. | `groq`, `whisper`, `gpt-oss`: **no requests**. The browser never talks to the AI vendor; MedoFlow's backend calls Groq server-side (FR-2). `audio`: the console uploads, `POST http://localhost:4302/api/v1/ai-scribe/session/<id>/audio` (R-6, R-12). `recording`: the room's upload, `…/consultations/<id>/recording/upload` (R-17). All go to MedoFlow's API only. The names and the clinical words: **no request URL matches**. |

**F. Nothing leaked: terminal checks after the browser run** (terminal 3)

```bash
# R-24 neither the key nor any clinical content is in the backend log
grep -c "gsk_" uploads/.manual-scribe-backend.log
grep -ciE "fatigue|tired|vitamin|magnesium|arnica|turmeric|furniture" uploads/.manual-scribe-backend.log
grep -E "\[AI Scribe\]" uploads/.manual-scribe-backend.log | tail -4
# R-25 provenance, status and encryption of every clinic R session
PSQL="docker exec -i mf-pg psql -U postgres -d $MANUAL_DB -At -F | -c"
$PSQL "select status, \"aiProvider\", \"aiModel\", \"sttModel\", left(transcript,22), left(\"aiDraft\"::text,24) from \"AIScribeSession\" where \"clinicId\"='$(RC clinicId)' order by \"createdAt\""
# R-26 the audit trail names the model that drafted, never the text
$PSQL "select action, \"newValue\"::text from \"AuditLog\" where \"clinicId\"='$(RC clinicId)' and action in ('AI_DRAFT_GENERATED','AI_DRAFT_REGENERATED') order by \"createdAt\""
$PSQL "select count(*) from \"AuditLog\" where \"clinicId\"='$(RC clinicId)' and (coalesce(\"newValue\"::text,'')||coalesce(\"oldValue\"::text,'')) ~* '(fatigue|tired|vitamin|magnesium|arnica|turmeric|Provider:)'"
# R-27 the failed job from R-20 kept ids and a code only
for k in $(docker exec -i mf-redis redis-cli zrange bull:ai-scribe-processing:failed 0 -1 | tr -d '\r'); do docker exec -i mf-redis redis-cli hmget bull:ai-scribe-processing:$k data failedReason; done
```

| Check | Expect                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-24  | `0`, then `0`: neither the key nor a clinical word appears anywhere in the log, across every mock and Groq run. Then `[AI Scribe]` lines with ids, durations and codes only, e.g. `… Processing Failed … code=ai_auth attempt=1` from R-20.                                                                                                                                                   |
| R-25  | Three rows, oldest first: the console visit (R-5), the next visit (R-12) and the room (R-17). Each is `APPROVED\|openai-compatible:groq@api.groq.com\|openai/gpt-oss-120b\|whisper-large-v3-turbo\|fle:v1:k1:AIScribeSess\|"fle:v1:k1:AIScribeSe`. The provenance names the vendor and both models; the transcript and draft are ciphertext, as in D-2.                                       |
| R-26  | One row per draft the AI finished: `AI_DRAFT_GENERATED` or `AI_DRAFT_REGENERATED`, each `{"aiModel": "openai/gpt-oss-120b", "sttModel": "whisper-large-v3-turbo", "aiProvider": "openai-compatible:groq@api.groq.com"}`. The R-19 row names `openai/gpt-oss-20b`. R-20's failed attempt has no row, because no draft was written. Then `0`: no clinical text in any of clinic R's audit rows. |
| R-27  | For each failed job kept in Redis, its data `{"sessionId":"…","clinicId":"…","regenerateSoapOnly":true}` and its reason `ai_auth`: ids and a code, nothing from the recording or from Groq. If you ran other tests against `mf-redis` before, older failed jobs are listed too; they look the same.                                                                                           |

**Back to the mock.** To run §9.5 – §9.7 again after this section, put the mock lines back, then restart terminal 1 with the R-3 block:

```bash
sed -i '/^AI_SCRIBE_/d' .env.manual-scribe.local
printf 'AI_SCRIBE_LLM_PROVIDER=mock\nAI_SCRIBE_STT_PROVIDER=mock\n' >> .env.manual-scribe.local
```

**Optional: a second vendor (Gemini).** Not part of the checks above. With a free key from <https://aistudio.google.com>, change `AI_SCRIBE_LLM_PRESET=groq` to `gemini`, put the Gemini key in `AI_SCRIBE_LLM_API_KEY`, and add `AI_SCRIBE_STT_API_KEY=<your Groq key>`. The STT side needs its own key now, because the two presets differ. After the R-3 restart, a regenerated draft reads "Drafted by gemini-2.5-flash · gemini". Gemini can also transcribe (`AI_SCRIBE_STT_PRESET=gemini`, with the Gemini key as `AI_SCRIBE_STT_API_KEY`). It takes audio inside a chat message, and Google documents WAV only. Whether it accepts a browser's webm microphone recording is still open (§8): try R-12 with it and note whether it drafts or fails with "The AI service could not process this recording or request." Gemini's free tier may use your prompts to improve Google's products: synthetic data only.

### 9.11 Self-hosted AI (optional) · not run

No key, no BAA and no patient data leaving the machine. You need [Ollama](https://ollama.com) and any OpenAI-compatible whisper server:

1. `ollama pull llama3.1:8b`, then keep `ollama serve` running (port 11434).
2. A whisper server on port 8000, e.g. `docker run -d --name mf-whisper -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cpu`, which serves `Systran/faster-whisper-small` by default. Check that image's README for the current tag.
3. In the env file, replace the `AI_SCRIBE_…` lines (the mock or the Groq ones) with `AI_SCRIBE_LLM_PRESET=ollama` and `AI_SCRIBE_STT_PRESET=whisper-server`. Restart terminal 1 with the R-3 block.

Expect R-4 to show `"location":"self-hosted"` for both roles; P-7 shows that production accepts this setup. Then run R-5 – R-11 in the browser. An 8B model on a laptop CPU can take minutes per draft. If drafts fail with "The AI service took too long to respond. Try again.", raise `AI_SCRIBE_TIMEOUT_MS` (default 120000).

### 9.12 Clean up

```bash
# terminals 1 and 2: Ctrl+C.
cd /e/advertout/MedoFlow/backend
set -a; . ./.env.manual-scribe.local; set +a
# this run's recordings (by session id), then the throwaway files and the database
for id in $(docker exec -i mf-pg psql -U postgres -d $MANUAL_DB -At -c 'select id from "AIScribeSession"' | tr -d '\r'); do rm -rf "uploads/ai-scribe/$id"; done
rm -f .env.manual-scribe.local .env.manual-scribe-good.local uploads/.manual-scribe-*
docker exec mf-pg psql -U postgres -c "DROP DATABASE IF EXISTS mf_manual_scribe WITH (FORCE)"
docker stop mf-redis
```

- **Your key.** The env file (and the R-20 copy, if R-21 was skipped) holds your Groq key, so deleting them removes it from disk. If you no longer need the key, also delete it in the Groq console (**API Keys**).
- **Your voice.** The recordings deleted here include the ones you read aloud in R-12 and R-17. They were stored under `uploads/ai-scribe/<session id>/`.
- `mf-redis` is stopped, not deleted; §9.3 step 2 starts it again next time. `docker rm -f mf-redis` deletes it.
- `mf-pg` keeps running for your other databases.

### 9.13 Result sheet

| Area                                                                              | Checks                                       | Pass? |
| --------------------------------------------------------------------------------- | -------------------------------------------- | ----- |
| Capabilities, roles                                                               | B-1 B-2                                      | ☐     |
| Consent: attest, required, decline wins (FR-1)                                    | B-3 – B-7 · B-30 – B-35 · F-1 F-2 F-14 · D-8 | ☐     |
| Upload / microphone → transcript → draft, orders with dose                        | B-8 – B-11 · F-3 – F-5 F-10 F-11 · D-7       | ☐     |
| Review: edit, regenerate, validation (FR-8)                                       | B-12 – B-17 · F-6 F-7                        | ☐     |
| Approve & send, the patient sees only the summary (FR-10)                         | B-18 – B-22 · F-8 F-12 · D-3                 | ☐     |
| Other clinics cannot see anything (FR-16)                                         | B-23 – B-26                                  | ☐     |
| Record over time (FR-7)                                                           | B-27 – B-29 · F-10                           | ☐     |
| Immutable versions (FR-9)                                                         | F-9 · D-9                                    | ☐     |
| Encryption at rest, audit, provenance (FR-14, FR-15)                              | B-10 · D-1 D-2 D-4 – D-7 · F-4 F-13          | ☐     |
| Production gate (FR-13)                                                           | P-1 – P-7                                    | ☐     |
| Real AI: key, restart, capabilities (FR-12)                                       | R-1 – R-4                                    | ☐     |
| Real AI, console: upload → transcript → draft → approve                           | R-5 – R-11                                   | ☐     |
| Real AI, live microphone, builds on the first visit (FR-7)                        | R-12 – R-15                                  | ☐     |
| Real AI, consultation room with the patient's consent (FR-1)                      | R-16 – R-18                                  | ☐     |
| Real AI: model switch, bad key, recovery (FR-11, FR-12)                           | R-19 – R-21                                  | ☐     |
| Real AI: patient view, the browser never calls the vendor, nothing leaked (FR-14) | R-22 – R-27                                  | ☐     |
| Self-hosted (optional)                                                            | §9.11                                        | ☐     |

**Real-AI notes** (time from upload to draft, and anything the model got wrong, left out or invented): …

**Tested by:** … · **Date:** … · **Branch / commit:** …

### 9.14 Troubleshooting

| Symptom                                                                                                  | Cause                                                                                                                                                     | Fix                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `waitdraft` prints `still TRANSCRIBING after 90 s`, or the browser stays on "Transcribing and drafting…" | The worker cannot reach Redis, so the job never runs                                                                                                      | `docker exec mf-redis redis-cli ping` must print `PONG` (§9.3 step 2). Check that `REDIS_URL=redis://localhost:56379` is in the env file, then restart terminal 1.                                                                                                                                           |
| Upload → `HTTP 503 · ai_not_configured`                                                                  | The env file has no `AI_SCRIBE_…` lines: neither the two mock lines (§9.3 step 3) nor the Groq ones (R-1)                                                 | `grep -E '^AI_SCRIBE_' backend/.env.manual-scribe.local` must show one of the two. Fix it, then restart terminal 1 with the R-3 block. B-1 or R-4 must show `"available":true`.                                                                                                                              |
| Upload → `HTTP 403 · consent_required`                                                                   | No consent recorded for this session                                                                                                                      | Run B-7 (or tick the box and click **Record consent** in the browser).                                                                                                                                                                                                                                       |
| Upload → `HTTP 400 · Audio file type not allowed`                                                        | The file is not audio, e.g. a video                                                                                                                       | Use the §9.3 step 5 `.wav`, or an `.mp3`/`.m4a`/`.webm` recording.                                                                                                                                                                                                                                           |
| `login failed for …: Invalid email or password`                                                          | Seeds and API use a different database or password                                                                                                        | See the box under the §9.5 helper block.                                                                                                                                                                                                                                                                     |
| Commands print `stdout is not a tty`, or ids come out empty                                              | `node` instead of `node.exe` inside `$( … )` or a pipe                                                                                                    | Paste the block again as written (§9.1).                                                                                                                                                                                                                                                                     |
| Every page shows `invariant expected app router to be mounted`                                           | Terminal 2 was started from a lowercase `e:\` path                                                                                                        | Ctrl+C, `cd /e/advertout/MedoFlow/frontend && rm -rf .next`, start terminal 2 again.                                                                                                                                                                                                                         |
| The page reloads signed out                                                                              | `127.0.0.1` used for the app or the API                                                                                                                   | Use `http://localhost:3000`, and `NEXT_PUBLIC_API_URL=http://localhost:4302`.                                                                                                                                                                                                                                |
| F-1 or R-5: no **Start documentation session** button, but a half-finished screen                        | That visit already has a session from an earlier attempt                                                                                                  | Continue from where it is, or seed a fresh clinic (§9.3 step 4, or the clinic R block in §9.9) and use the new ids.                                                                                                                                                                                          |
| F-10, R-12 or R-17: the microphone prompt never appears                                                  | The site is blocked from the microphone, or Windows privacy settings block Chrome                                                                         | Address-bar icon → **Site settings** → Microphone: **Allow**; Windows **Settings → Privacy → Microphone**: allow desktop apps.                                                                                                                                                                               |
| `EADDRINUSE :::4302` or `:::3000`                                                                        | A backend or frontend from an earlier run is still running                                                                                                | Find that terminal and press Ctrl+C. Do not kill processes you did not start; if you cannot find it, use another port in terminal 1 (`PORT=…`), in `NEXT_PUBLIC_API_URL` and in `API=` in the helper block.                                                                                                  |
| R-1 prints `✗ not saved: a Groq key starts with gsk_`                                                    | Nothing was pasted (Ctrl+V does not paste in Git Bash), or something else was copied                                                                      | Run R-1 again and paste with **Shift+Insert** or right-click → **Paste**.                                                                                                                                                                                                                                    |
| R-2 prints `✗ Invalid API Key`                                                                           | The key was copied incompletely, or it was revoked                                                                                                        | Copy it again from <https://console.groq.com> → **API Keys** (or create a new one), then run R-1 again.                                                                                                                                                                                                      |
| R-2 prints `✗` after `openai/gpt-oss-120b` or `openai/gpt-oss-20b`                                       | That model is not offered to your key, or is switched off for your Groq project                                                                           | Pick a chat model R-2's list does show, or one ticked under your project's models in the Groq console, and add `AI_SCRIBE_LLM_MODEL=<that id>` to the env file, as in R-19. Prefer a large general model: the small guard and speech models cannot write a note. Then restart terminal 1 with the R-3 block. |
| R-4 still shows `"kind":"mock"`, or the drafts say "Drafted by mock-scribe-1"                            | Terminal 1 still had the mock settings loaded from the old env file                                                                                       | Restart terminal 1 with the R-3 block exactly as written: its `unset ${!AI_SCRIBE_@}` line clears them.                                                                                                                                                                                                      |
| Red panel: "The AI service is busy (rate limited). Try again in a moment."                               | The free tier's per-minute limit, still hit after the automatic retries                                                                                   | Wait a minute, then click **Retry**. Avoid several **Regenerate draft** clicks within one minute.                                                                                                                                                                                                            |
| Red panel: "The AI service rejected our credentials…" outside R-20                                       | A broken key is still in the env file, e.g. R-21 was skipped                                                                                              | Run R-21's `mv` line (or R-1 again), then restart terminal 1 with the R-3 block.                                                                                                                                                                                                                             |
| Red panel: "The AI service took too long to respond" or "could not be reached"                           | A slow or interrupted connection to Groq                                                                                                                  | Click **Retry**. If it keeps happening, check your internet connection, then try again a few minutes later.                                                                                                                                                                                                  |
| Red panel: "The AI service could not process this recording or request."                                 | Groq refused the audio (the recording is empty, less than a second long, or over the free tier's 25 MB limit), or refused the model named in the env file | Record again, for at least a few seconds. If it happens for every recording, run R-2 again and check that the model has a ✓.                                                                                                                                                                                 |
| R-13: the transcript is empty, or is not what you said                                                   | Chrome recorded from a different input, e.g. a muted headset or a virtual device                                                                          | Choose the microphone at `chrome://settings/content/microphone`, then record again.                                                                                                                                                                                                                          |
| The draft states something nobody said                                                                   | The model made a mistake                                                                                                                                  | Note it in the result sheet, then correct the text before approving. This is exactly why nothing is sent until the provider approves.                                                                                                                                                                        |
