# MedoFlow — HIPAA Compliance Checklist

> **Purpose:** A living, repo-tracked checklist to keep every development phase, feature, and release HIPAA-compliant.
> **Audience:** Engineering, DevOps, Security/Privacy Officer, and anyone shipping code that touches patient data.
> **How to use:** Treat this as a gate. Nothing that handles PHI ships without passing the relevant sections below. Copy **Section 2 (Per-Change Gate)** into every PR description and tick the boxes.

|                      |                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Document version** | 1.2                                                                                                                |
| **Last updated**     | 2026-10-12                                                                                                         |
| **Owner**            | Security/Privacy Officer (assign a named person)                                                                   |
| **Review cadence**   | Monthly, and on every new data-handling feature                                                                    |
| **Legal scope**      | U.S. HIPAA (Privacy, Security, Breach Notification, Omnibus Rules). MedoFlow operates as a **Business Associate**. |

---

## 0. Read this first — MedoFlow's HIPAA position

- MedoFlow is a **Business Associate (BA)**. Clinic customers are **Covered Entities**. This means MedoFlow is **directly liable** to HHS/OCR, not just contractually to customers.
- **Assume all patient-linked data is ePHI.** In this codebase that explicitly includes: SOAP notes & version history, consultation transcripts (`transcriptText`), treatment plans, intake-form answers, uploaded patient files, appointment records, patient-facing summaries, and any name/email/phone/DOB/address tied to a patient.
- There is **no official "HIPAA certification."** Compliance = technical controls **+** documented administrative controls **+** signed BAAs, all of which you can **prove**. Prove-ability is the job.
- **Safe harbor:** properly encrypted PHI that leaks is generally **not a reportable breach**. This is why encryption is non-negotiable throughout.

**Legend:** `[ ]` = to verify every time · 🔴 = required (no exceptions) · 🟡 = addressable (implement or document a justified equivalent) · 📄 = produces a document/artifact you must retain.

---

## 1. Standing baseline (verify quarterly — must stay true at all times)

These are not per-PR; they are the always-on posture the whole product depends on.

### 1.1 Legal & administrative (the paperwork OCR asks for first)

- [ ] 🔴📄 A named **Security Officer** and **Privacy Officer** are designated in writing.
- [ ] 🔴📄 A current **Risk Analysis** exists (dated within 12 months) covering where ePHI lives, flows, and could be exposed.
- [ ] 🔴📄 A **Risk Management Plan** tracks remediation of findings from the risk analysis.
- [ ] 🔴📄 Written **policies & procedures** exist for: access control, incident response, breach notification, data retention/disposal, workforce sanctions, contingency/disaster recovery.
- [ ] 🔴📄 **Workforce HIPAA training** is completed on hire and annually; completion is logged.
- [ ] 🔴📄 **Signed BAA with every customer** (Covered Entity) before any PHI is accepted.
- [ ] 🔴📄 **Signed BAA with every subcontractor** that touches PHI (see 1.2). No BAA ⇒ PHI must not flow to that vendor.
- [ ] 🟡📄 Third-party attestation in progress or complete (**SOC 2 Type II** and/or independent HIPAA assessment) — not legally required but expected by B2B buyers.

### 1.2 Vendor / subcontractor BAA register (keep current)

PHI flows to each of these in MedoFlow today (verified against the code on 2026-10-12). Each needs a signed BAA **and** must be configured to a HIPAA-eligible tier — or PHI must stop flowing to it.

**Hosting (current demo environment — see [PHI_GATE.md](PHI_GATE.md); none has a BAA today):**

- [ ] 🔴 **Render** (runs the backend API): BAA, or move the API to a BAA-eligible host (AWS / GCP / Azure).
- [ ] 🔴 **Neon** (managed PostgreSQL — all PHI): BAA; encryption at rest + `sslmode=require` enforced.
- [ ] 🔴 **Cloudflare** (frontend Workers, backend edge Worker/Container, Hyperdrive, **R2** for consultation and scribe audio): Enterprise BAA + per-service eligibility confirmed in writing; R2 objects private + encrypted.
- [ ] 🔴 **Redis Cloud** (BullMQ queues): job data holds record IDs only today (`aiScribeQueue.ts`); keep it that way, and still prefer a BAA-covered, TLS-only instance.
- [ ] 🔴 **Patient file uploads**: currently written to the API server's local disk (`config/multer.ts`, `uploads/<clinicId>/<patientId>/`) — not to S3/R2. Move to encrypted, BAA-covered object storage (see 4.3).

**AI Scribe (self-hosted — no third party sees the content):**

- [ ] 🔴 **Whisper** (`nodejs-whisper` / whisper.cpp in `aiProviderService.ts`): runs **locally** on our server. ✅ Confirmed — no BAA needed while it stays self-hosted.
- [ ] 🔴 **Ollama + Llama 3.1** (`OLLAMA_URL` / `OLLAMA_MODEL` in `aiProviderService.ts`; called via the misnamed `openaiService.ts`): drafts SOAP notes, timelines and patient summaries from the full transcript. Self-hosted, so no BAA — **but** the Ollama endpoint is plain HTTP with no auth: it must run on a private network with TLS + auth, and on infrastructure covered by our host's BAA.

**Voice agent / AI front desk (third parties that DO receive PHI):**

- [ ] 🔴 **Groq** (speech-to-text, Llama chat with tools, text-to-speech — `groqService.ts`, `voiceAgentService.ts`, `ttsService.ts`): BAA, or replace.
- [ ] 🔴 **Google Gemini** (text-to-speech fallback — `ttsService.ts`; API key currently sent in the URL query string): BAA, or remove.
- [ ] 🔴 **OpenAI Realtime** (`gpt-realtime`, legacy voice path in `voiceAgentService.ts`): BAA + zero-data-retention, or remove the legacy path.

**Other vendors:**

- [ ] 🔴 **Stripe** (payments/subscriptions): no clinical data is sent, but memberships create a Stripe Customer with patient **name + email** (`membershipService.ts`) and PaymentIntent metadata carries `patientId`. Request a BAA, or reduce to IDs only.
- [ ] 🔴 **Email provider (SMTP via Nodemailer)**: booking emails contain patient name, service, provider, date/time and location (`emailService.ts`). BAA-covered provider, TLS enforced (`SMTP_SECURE` defaults to `false` today), or switch to secure-link-to-portal emails.
- [ ] 🔴 **Video consultations** — **8x8 JaaS** (`jaasService.ts`) and **Daily.co** (`dailyService.ts`): live audio/video of patients. BAA for whichever is used.
- [ ] 🟡 **Google Calendar** (`googleCalendarService.ts`): read-only import of provider calendars; MedoFlow does not write PHI into Google events. Covered by a Google Workspace BAA if one is signed.
- [ ] 🟡 **Error monitoring / analytics**: none installed today (no Sentry, PostHog, GA, Datadog SDKs). Cloudflare Workers `observability` is enabled — confirm it doesn't capture PHI. Any future tool needs a BAA **or** PHI scrubbing (see 3.6).

> ⚠️ **Any new third-party SDK, API, LLM, webhook, or analytics tool is a BAA decision.** Adding one without checking this register is a compliance incident waiting to happen.

### 1.3 Infrastructure baseline

- [ ] 🔴 TLS 1.2+ enforced on all external endpoints (HTTPS only; HSTS set).
- [ ] 🔴 Database **encryption at rest** enabled (e.g., Neon/RDS volume encryption or KMS) and DB connections forced to TLS (`sslmode=require` — not enforced in code today).
- [ ] 🔴 Object storage (R2 today, or S3) **encrypted** + **no public access**; uploads in `storageService.ts` should request server-side encryption.
- [ ] 🔴 Redis connections use TLS; instance not publicly exposed.
- [ ] 🔴 Secrets (JWT secret, DB creds, Stripe keys, Groq / Gemini / OpenAI keys, `GOOGLE_TOKEN_ENCRYPTION_KEY`) stored in a secrets manager / env, **never** committed. `.gitignore` covers `.env*`.
- [ ] 🔴 Backend container runs as a non-root user (`backend/Dockerfile`), and `SEED_ON_DEPLOY` is never enabled in production.
- [ ] 🔴 Backups are encrypted, access-controlled, and restore is tested periodically.
- [ ] 🟡 Automatic infrastructure patching / dependency updates scheduled.

---

## 2. Per-Change Gate (paste into every PR that touches data)

> Run through this for **every feature, migration, endpoint, or dependency change**. If a box doesn't apply, mark `N/A` with a one-line reason.

```
### HIPAA Per-Change Gate
- [ ] Does this change create, read, update, delete, store, transmit, or expose PHI? (If NO and truly unrelated to patient data → skip to Dependencies.)
- [ ] Minimum necessary: only the PHI fields actually needed are read/returned/logged.
- [ ] AuthZ: endpoint is behind `auth` + `clinicScope`/tenant middleware; role/permission enforced server-side.
- [ ] Tenant isolation: every query is scoped by clinicId; no cross-clinic data leakage possible.
- [ ] Audit: create/update/delete of PHI calls logAudit() with actor, entity, action, before/after.
- [ ] Transport: data moves only over TLS; no PHI in URLs/query strings.
- [ ] Storage: new PHI fields are in encrypted-at-rest stores; sensitive free-text reviewed.
- [ ] Logging: no PHI in app logs, error messages, stack traces, or monitoring payloads.
- [ ] AI/3rd-party: clinical content stays on self-hosted Whisper/Ollama; any PHI sent to an external API (Groq, Gemini, OpenAI, Stripe, email, video) is covered by a BAA + minimum necessary.
- [ ] Input validation: request validated (Zod/validateRequest) to prevent injection.
- [ ] Dependencies: new packages reviewed; none transmit PHI to a non-BAA endpoint; `npm audit` clean of highs/crits.
- [ ] Tests: access-control + tenant-isolation tests added/updated for the new path.
- [ ] Docs: data-flow / retention / BAA register updated if a new PHI path or vendor was introduced.
```

---

## 3. Technical Safeguards (Security Rule §164.312) — engineering checklist

### 3.1 Access control & authentication 🔴

- [ ] Every PHI endpoint passes through `middleware/auth.ts` (JWT verified) — no unauthenticated PHI routes.
- [ ] Authorization enforced **server-side** via role/permission arrays (`CustomRole`, e.g. `appointments.view`) — never trust the client.
- [ ] Tenant/clinic scoping applied via `clinicScope.ts` / `bindTenantContext.ts` on **every** PHI query.
- [ ] Unique user ID per person (no shared logins); deactivating a user revokes access immediately.
- [ ] Passwords hashed with **argon2id** (current standard in `authService.ts`; never plaintext/reversible); password reset flow doesn't leak account existence.
- [ ] **MFA** available/required for staff roles (SUPER_ADMIN, PROVIDER, ACCOUNTING, FRONT_DESK).
- [ ] JWT: short-lived access tokens + rotation/refresh; secret strength enforced; logout/invalidments handled.
- [ ] **Automatic session timeout / idle logoff** on clinical screens.
- [ ] Rate limiting (`middleware/rateLimit.ts`) applied to auth and sensitive endpoints to blunt brute-force.
- [ ] Provider-scope analytics enforced server-side (provider sees only self; admin sees all) — confirmed in `analyticsService.ts`.

### 3.2 Audit controls 🔴 (you already have `AuditLog` + `auditService.logAudit`)

- [ ] Every **create/update/delete of PHI** writes an audit entry (actor `performedById`, `entityType`, `entityId`, `action`, `oldValue`/`newValue`).
- [ ] **Read/access of PHI** for sensitive records (SOAP notes, transcripts, patient files) is logged — not just writes. _(Common gap — writes are logged, reads often aren't.)_
- [ ] Audit logs are **append-only / tamper-resistant** (no app path updates or deletes them).
- [ ] Audit logs exclude the PHI payload itself where possible (log the change metadata, not a second copy of the record body).
- [ ] Logs retained per policy (**HIPAA minimum 6 years**) and reviewable (`listAuditLogs`).
- [ ] Authentication events (login success/failure, password change, permission change) are audited.

### 3.3 Integrity 🔴

- [ ] SOAP note **version history is immutable** (append new versions; never hard-edit prior versions) — verify this holds for all clinical records.
- [ ] Data validated on write (`validateRequest.ts` / Zod) to prevent corruption.
- [ ] Backups verified restorable; integrity checks on critical tables.

### 3.4 Transmission security 🔴

- [ ] All API traffic over HTTPS/TLS; HTTP redirected.
- [ ] No PHI in URL paths, query strings, or GET params (keep it in encrypted bodies).
- [ ] `helmet` (or equivalent security headers) enabled in `app.ts`; CORS locked to known origins.
- [ ] Webhooks (Stripe, Google) verify signatures; no PHI echoed in webhook responses.

### 3.5 Encryption 🔴/🟡

- [ ] **In transit:** TLS everywhere (see 3.4).
- [ ] **At rest:** DB + object storage (R2/S3) + patient files + backups + Redis encrypted (see 1.3).
- [ ] 🟡 **Application-level / field-level encryption** considered for the most sensitive free-text (`transcriptText`, SOAP bodies, intake answers). _Schema currently stores these as plaintext `@db.Text` relying on at-rest disk encryption — decide and document whether field-level encryption is warranted, or justify why disk-level is sufficient._
- [ ] Encryption keys managed in KMS/secrets manager with rotation; never in source.

### 3.6 Logging, errors & observability (high-risk leak path) 🔴

- [ ] App logs, `errorHandler.ts` output, and stack traces contain **no PHI** (no patient names, note bodies, transcripts, emails).
- [ ] Error-monitoring/APM payloads are **scrubbed** of PHI before leaving the system (or the vendor is BAA-covered).
- [ ] Request/response logging does not persist PHI bodies.
- [ ] BullMQ job logs/payloads reviewed — jobs carrying PHI don't dump it to logs.

### 3.7 AI Scribe and voice agent 🔴

- [ ] AI Scribe stays **self-hosted**: Whisper (transcription) and Ollama/Llama (SOAP drafting, patient summary) in `aiProviderService.ts`. No scribe code path calls a third-party AI API.
- [ ] Ollama endpoint (`OLLAMA_URL`) is on a private network with TLS + auth — never plain HTTP across the internet.
- [ ] Transcript sent to the LLM is the **minimum necessary** (today the full transcript is sent; there is no de-identification).
- [ ] Stored scribe/consultation audio is deleted once the note is finalised (`deleteAudio` in `storageService.ts` currently has no callers).
- [ ] Voice agent vendors (Groq, Gemini, OpenAI Realtime) are BAA-covered **before** real patients call; no PHI retained or used for training.
- [ ] AI-generated drafts are provider-reviewed before becoming part of the record (human-in-the-loop).
- [ ] The **patient-facing summary boundary is enforced** — internal notes/transcripts never auto-publish to the patient portal.
- [ ] Prompts/system prompts (`systemPrompt @db.Text`) don't embed other patients' PHI.

---

## 4. Privacy Rule (§164.502–514) — data-handling checklist

### 4.1 Minimum necessary 🔴

- [ ] API responses return only fields the caller needs (avoid `select: *` / returning full patient objects to narrow UIs).
- [ ] Analytics/CSV exports (`analyticsService.ts`) aggregate or de-identify where possible; exports are role-gated + audited.
- [ ] Internal tooling/admin views apply least-privilege.

### 4.2 Permitted use only 🔴

- [ ] PHI used **only** for treatment, payment, operations, or with authorization — never for MedoFlow's own marketing/model-training.
- [ ] Demo/seed data (`seed_demo.ts`, `seed_custom.ts`) uses **synthetic** data only — never real patient data in demos/dev.

### 4.3 Patient files & uploads 🔴

- [ ] Patient files move off the API server's local disk (`config/multer.ts`) into encrypted, BAA-covered object storage.
- [ ] Buckets private; access via **time-limited pre-signed URLs** or streamed through the API (as `fileController.ts` does today), never public links.
- [ ] File access authorized + tenant-scoped + audited (download auditing is in place).
- [ ] Uploaded file types validated by content, not the client's MIME label (today any `application/*` passes); access checked **before** the file is written; lifecycle/retention policy applied.

### 4.4 Patient rights 🔴

- [ ] Patients can **access/export** their own records (right of access).
- [ ] Mechanism exists to **amend/correct** records on valid request.
- [ ] Ability to produce an **accounting of disclosures** from audit logs.

---

## 5. Breach Notification Rule (§164.400–414)

- [ ] 🔴📄 Incident response runbook defines detect → contain → assess → notify.
- [ ] 🔴 As a BA, breaches are reported to the affected **Covered Entity (customer) without unreasonable delay, ≤ 60 days** — per each BAA's terms.
- [ ] 🔴 Breach risk assessment documents whether exposed data was **encrypted** (potential safe harbor).
- [ ] 🔴📄 Breach log maintained; template notifications prepared.
- [ ] 🟡 Monitoring/alerting in place to **detect** unauthorized access (failed-auth spikes, anomalous access to many patient records).

---

## 6. Data retention & disposal (§164.310(d))

- [ ] 🔴📄 Written retention schedule per data type; **audit logs retained ≥ 6 years**.
- [ ] 🔴 Secure deletion process (DB rows, stored audio and files, backups) on BAA termination or valid patient/customer request.
- [ ] 🔴 Off-boarding: when a customer leaves, their PHI is returned/destroyed per BAA and the action is logged.
- [ ] 🟡 Soft-delete vs hard-delete policy defined so "deleted" PHI doesn't linger indefinitely against policy.

---

## 7. Phase-by-phase gates (map to your dev lifecycle)

### Design / planning phase

- [ ] Data-flow diagram updated: does this feature introduce a new PHI store, flow, or vendor?
- [ ] Privacy-by-design: can the feature work with less PHI, de-identified, or aggregated?
- [ ] If a new vendor/LLM/SDK is involved → BAA decision made **before** building (Section 1.2).

### Implementation phase

- [ ] Section 2 Per-Change Gate ticked.
- [ ] Section 3 technical safeguards applied to new code paths.
- [ ] Access-control + tenant-isolation tests written.

### Code review phase

- [ ] Reviewer explicitly checks: authZ, tenant scoping, audit calls, PHI-in-logs, minimum necessary.
- [ ] No secrets, no real PHI in fixtures, `npm audit` reviewed.

### Pre-release / deployment phase

- [ ] Migrations reviewed for new PHI columns → encryption/retention/audit implications addressed.
- [ ] Staging tested with synthetic data only.
- [ ] **PHI gate** respected: no real PHI on the Cloudflare environment while [docs/PHI_GATE.md](PHI_GATE.md) is CLOSED (B0.6.1).
- [ ] Rollback plan; backups confirmed; monitoring/alerts live.

### Post-release phase

- [ ] Audit logging verified working in production for the new path.
- [ ] Vendor BAA register, data-flow docs, and this checklist updated if anything changed.

---

## 8. Known gaps / action items (keep this live)

> Update this list as the team closes items. Seeded from the 2026-10-08 code review.

| #   | Item                                                                                                                                                                                                                                                                           | Area      | Status           | Owner            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---------------- | ---------------- |
| 1   | Confirm **read-access logging** (not just writes) for SOAP notes, transcripts, patient files                                                                                                                                                                                   | 3.2       | ⬜ Open          |                  |
| 2   | Decide on **field-level encryption** for `transcriptText` / SOAP bodies / intake answers vs. rely on disk encryption — document the decision                                                                                                                                   | 3.5       | ⬜ Open          |                  |
| 3   | ~~Verify OpenAI BAA for AI Scribe~~ — **corrected:** the scribe uses self-hosted Ollama/Llama, not OpenAI. Remaining work: secure the Ollama endpoint (TLS + auth + private network), and get BAAs for, or remove, the **voice agent** vendors (Groq, Gemini, OpenAI Realtime) | 1.2 / 3.7 | ⬜ Open          |                  |
| 4   | Confirm **Whisper is fully local** (no hosted transcription path) — confirmed for the AI Scribe; the voice agent uses Groq's hosted Whisper (covered by item 3)                                                                                                                | 1.2 / 3.7 | ✅ Done (scribe) |                  |
| 5   | Verify **error monitoring / logging** has no PHI or is BAA-covered — no monitoring SDKs installed; but the tenant guard logs query data and 500 errors return raw messages                                                                                                     | 3.6       | ⬜ Open          |                  |
| 6   | Add **MFA** for all staff roles — confirmed missing                                                                                                                                                                                                                            | 3.1       | ⬜ Open          |                  |
| 7   | Add **automatic idle session timeout** on clinical screens — confirmed missing                                                                                                                                                                                                 | 3.1       | ⬜ Open          |                  |
| 8   | Move patient files off local disk to encrypted object storage; request server-side encryption on R2/S3 audio uploads                                                                                                                                                           | 4.3       | ⬜ Open          |                  |
| 9   | Complete **BAA register** (Section 1.2) with signed-status per vendor                                                                                                                                                                                                          | 1.2       | ⬜ Open          |                  |
| 10  | Write/confirm **Risk Analysis + core policies** exist and are current                                                                                                                                                                                                          | 1.1       | ⬜ Open          |                  |
| 11  | **PHI gate (Cloudflare):** no real PHI until Cloudflare BAA + per-service eligibility is confirmed, or PHI components move to AWS/GCP/Azure. See [PHI_GATE.md](PHI_GATE.md)                                                                                                    | 1.2 / 1.3 | 🔒 Gate closed   | Security Officer |

---

## 9. Changelog

| Version | Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                    | By                  |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1.0     | 2026-10-08 | Initial checklist, tailored to current MedoFlow stack (Next.js/Express/Prisma/Postgres, OpenAI+Whisper AI Scribe, S3, Stripe, Redis/BullMQ).                                                                                                                                                                                                                                                              | devops@medoflow.com |
| 1.1     | 2026-10-12 | Added PHI gate for the Cloudflare synthetic-data deployment (pre-release gate + §8 item 11).                                                                                                                                                                                                                                                                                                              | devops@medoflow.com |
| 1.2     | 2026-10-12 | Corrected vendor facts after a full code audit: AI Scribe is self-hosted Whisper + Ollama/Llama (not OpenAI); OpenAI/Groq/Gemini are voice-agent vendors; hosting is Render/Neon/Cloudflare/Redis Cloud (not AWS); patient files are on local disk (not S3); passwords use argon2id. Added video vendors and updated §8 items 3–8. Full gap tracker lives in the _Low-Level Design & Code Checklist_ doc. | devops@medoflow.com |

---

### Disclaimer

This checklist is an engineering/operational aid, not legal advice. HIPAA compliance requires sign-off from your designated Privacy/Security Officer and qualified counsel. Keep it current — an out-of-date compliance doc is itself a finding.
