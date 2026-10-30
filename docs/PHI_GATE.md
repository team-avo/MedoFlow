# PHI Gate — Cloudflare deployment

**Status: 🔒 CLOSED. No real patient data on the Cloudflare environment.**
Owner: Security Officer (to be named per A.1) · Effective: 2026-10-12 · Tracking: B0.6.1

## Rule

The hosted demo environment (frontend `medoflow-web` on Cloudflare Workers, backend `medoflow-backend` on
Render, Neon Postgres `medoflow-demo-db`, Hyperdrive `medoflow-neon`, R2 `medoflow-files`, Redis Cloud) is a
**synthetic-data-only** environment for builds, demos, and pilots. The same gate applies to Render:
no BAA is in place with Render, Neon, Redis Cloud or Cloudflare.

**Real PHI must not be entered, imported, uploaded, or recorded into it** until B0.6.1 is resolved by
**one** of:

1. A **signed Cloudflare BAA**, plus written confirmation from Cloudflare that **every service in the PHI
   path** is BAA-eligible (Workers, Containers, Hyperdrive, R2, Queues/KV if used). The BAA is
   Enterprise-only, and Workers/R2/KV/D1 are not documented as eligible today. **Also required:** a
   signed BAA with **every other vendor in the PHI path**: Neon (Postgres), Redis Cloud (BullMQ), the
   scribe/LLM vendor, email, and Stripe.
2. **Migrating the PHI-handling components** (API, database, file storage, queue) to a BAA-eligible host
   (AWS / GCP / Azure), with BAAs signed and recorded in the vendor BAA register (HIPAA checklist §1.2).

## What counts as PHI here

SOAP notes and versions, transcripts, treatment plans, intake answers, uploaded patient files,
appointments, patient-facing summaries, prescribed-product data, and any patient name, email, phone,
DOB or address. _(development-plan.md, Acceptance model)_

## How the gate is enforced today

- The database was loaded from the synthetic demo dump `medoflow-demo-20261005.sql.gz`. Three
  real-looking webmail addresses found in it were replaced with `@example.com` placeholders before
  go-live.
- `backend/scripts/deploy/phi-scan.sql` must return **0 hits** for every pattern. Run it before every
  demo and after any data import.
- No clinic may be onboarded with real patients on this environment. Pilots use the demo personas
  (`*@medoflow.test`, `*.demo`) or newly created synthetic accounts.
- The AI Scribe must not be used with real patient audio on this environment.
  The scribe AI is pluggable (`AI_SCRIBE_*`, [ADR 0006](adr/0006-ai-provider-abstraction-and-phi-egress.md));
  in production the app refuses to boot unless every external AI host is in `AI_SCRIBE_BAA_HOSTS`
  (BAA + zero-retention in writing) and never uses the Gemini Developer API.

## Opening the gate

The gate opens only by a written, dated decision from the Security Officer that records the chosen
option above, links the signed BAAs, and updates the vendor BAA register. Until then this file stays
**CLOSED**, and the launch-readiness gate in `development-plan.md` and HIPAA checklist §8 item 11 stay
open.

Opening the gate also means removing `AI_SCRIBE_PHI_POLICY=synthetic-data-only` from the environment
(if set), so the AI scribe's BAA check is enforced again ([ADR 0006](adr/0006-ai-provider-abstraction-and-phi-egress.md) §4).
