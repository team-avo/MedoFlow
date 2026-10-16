# ADR 0002 — Field-level encryption of clinical free text (B3.2)

**Status:** Accepted by engineering, implemented · 2026-10-16 · **Deciders:** CTO (Khush), Security Officer · **Signature:** pending (below) · **Related:** [ADR 0001](0001-phi-hosting.md), HIPAA checklist §3.5 / §8 #2

## Context

The most sensitive data MedoFlow holds is clinical free text: what the patient said, what the clinician concluded, and what the patient answered on intake. Until now it was stored as plaintext columns. The only protection was the hosting provider's disk encryption (Neon AES-256) and Postgres access control (the non-owner `medoflow_app` role plus row-level security, B0.1.3).

Disk encryption protects against stolen disks. It does **not** protect against the threats we actually face:

| Threat                                                                         | Disk encryption | Field-level encryption                                          |
| ------------------------------------------------------------------------------ | --------------- | --------------------------------------------------------------- |
| A database dump or backup copied off the host (`pg_dump`, a leaked backup)     | ✗               | ✓                                                               |
| An over-privileged SQL session (owner role, support access, a misused BI tool) | ✗               | ✓                                                               |
| A read-replica / analytics export that ends up outside the BAA perimeter       | ✗               | ✓                                                               |
| A SQL-injection or RLS bug that returns another tenant's rows                  | ✗               | ✓ (ciphertext only, unless the attacker also has the app's key) |
| A compromise of the running API process (it holds the key)                     | ✗               | ✗                                                               |

Encrypting these fields also lowers the cost of ADR 0001: a database provider that only ever sees ciphertext for the clinical narrative holds much less sensitive PHI. A BAA is still required because names, emails and appointments stay in plaintext.

## Decision

Encrypt these columns in the application before they reach Postgres:

| Model                 | Fields                                                              | Kind        |
| --------------------- | ------------------------------------------------------------------- | ----------- |
| `VisitRecord`         | `subjective`, `objective`, `assessment`, `plan`, `note`             | text        |
| `VisitNoteVersion`    | `subjective`, `objective`, `assessment`, `plan`                     | text        |
| `AIScribeSession`     | `transcript` (text); `timeline`, `aiDraft`, `patientSummary` (JSON) | text / JSON |
| `ConsultationSession` | `transcriptText`                                                    | text        |
| `FormResponse`        | `responses` (intake answers)                                        | JSON        |
| `VoiceCall`           | `transcript` (JSON), `summary` (text)                               | JSON / text |

**Out of scope** (still plaintext, protected by RLS + disk encryption): names, emails, phones, DOB, appointment times, treatment-plan names/goals, prescription notes, file names.

- Prescriptions and treatment-plan notes are short and are candidates for the next iteration (§ Consequences).
- Patient files are binary objects in object storage, encrypted there with SSE (B3.1).

### Design

- **Cipher:** AES-256-GCM with a fresh 96-bit IV for every value.
- **Envelope:** `fle:v1:<kid>:<Model.field>:<s|j>:<iv>:<tag>:<ciphertext>`. The key id, the column label and the kind are bound in as associated data, so a value copied into another column or record type fails authentication. JSON columns store the sealed envelope as a JSON string.
- **Where it runs:** inside the existing Prisma query extension (`backend/src/config/prisma.ts`), next to the tenant guard.
  - Writes (`create`, `update`, `upsert`, `createMany`, `updateMany`) are sealed.
  - Every result is walked and sealed values are opened, including relations pulled in by `include`/`select`.
  - Application code reads and writes plaintext as before.
- **Searching:** encrypted columns cannot be filtered on. The extension **throws** on any `where` that filters on one, instead of silently matching nothing. Null checks are still allowed. No current query filters on these fields.
- **Legacy plaintext:** a value without the `fle:` prefix is read as-is. This keeps reads working until the backfill has run.
- **Keys** (`backend/src/config/fieldKeys.ts`):
  - `env` provider: `FIELD_ENCRYPTION_KEYS="k1:<64 hex>,…"` plus `FIELD_ENCRYPTION_ACTIVE_KID`. Keys live in Render's secret store, like the other secrets (docs/SECRETS_AND_ROTATION.md).
  - `aws-kms` provider (target once on AWS under a BAA, ADR 0001 option 2/3):
    - Data keys come from `aws kms generate-data-key --key-spec AES_256 --encryption-context purpose=medoflow-field-encryption,kid=<kid>`.
    - Only the wrapped `CiphertextBlob` is configured.
    - The API unwraps each data key once at boot with `kms:Decrypt` (with that encryption context) and holds the plaintext key in memory only.
    - Key policy and CloudTrail provide the "KMS-managed" control and audit trail.
  - **Production refuses to boot** without a valid key configuration (`envValidation.ts`).
- **Migration and rotation:** `pnpm run ops:encrypt-phi` (`backend/src/cli/encryptPhiFields.ts`).
  - Seals every plaintext value and re-seals values whose key id is not the active one.
  - Idempotent; prints counts only.
  - Rows that cannot be opened are counted as `failed` and left untouched; the exit code is non-zero.
  - Rotation steps: add a new key → make it active → run the command → remove the old key once `resealed` is 0.

## Consequences

- **+** Dumps, backups, replicas and SQL sessions without the app key see ciphertext for the clinical narrative.
- **+** Transparent to application code. All existing tests pass unchanged; new tests cover the encryption itself.
- **−** No database-side search over notes or transcripts. Any future search feature must use an application-side index built under the same BAA, or blind indexes.
- **−** Losing every copy of the keys means losing the data.
  - Keys must be backed up in the secret manager with the same care as the database backups.
  - `B0.6.4` restore drills must also restore the key.
- **−** Small CPU cost per read and write (microseconds per field). It was not measurable in the integration suites.
- **Next iteration:**
  - Extend to `Prescription.notes` and `TreatmentPlan.goals/notes`.
  - Move to the `aws-kms` provider once the PHI host decision (ADR 0001) lands on AWS.

## Evidence

- Unit (`backend/src/tests/fieldEncryption.test.ts`):
  - round-trip of text and JSON
  - tamper detection
  - column-swap refusal
  - wrong key
  - rotation
  - KMS unwrap with the encryption context
  - every registered field is checked against the Prisma schema
  - production boot refusal
- Integration (`backend/src/tests/integration/fieldEncryption.int.test.ts`, real Postgres):
  - ciphertext at rest
  - plaintext through the API, including version history and nested includes
  - intake answers, scribe JSON and voice transcripts
  - filter refusal
  - tenant export is plaintext
  - backfill, idempotence and rotation
- Live check, with the real frontend driving the real API: see the Component 3 walkthrough §4.

## Sign-off

| Role             | Name | Date | Signature |
| ---------------- | ---- | ---- | --------- |
| CTO              |      |      |           |
| Security Officer |      |      |           |
