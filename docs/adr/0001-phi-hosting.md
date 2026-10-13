# ADR 0001 — Where PHI is hosted (B0.6.1)

**Status:** Proposed · 2026-10-13 · **Deciders:** CTO (Khush), Security Officer · **Blocks:** the PHI gate (docs/PHI_GATE.md)

## Context

Today (Part 0) the frontend runs on Cloudflare Workers and the API on Render. Data sits in Neon Postgres, Redis Cloud and Cloudflare R2. That stack is approved for **synthetic data only**. Before the first real-PHI clinic, every service that stores, processes or transmits PHI needs a signed BAA that names that service as covered.

| Service                                   | Holds / sees PHI                                  | BAA availability (as of 2026-10; confirm in writing)                                |
| ----------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Render (API)                              | yes, in transit and in memory                     | Render offers a BAA on its HIPAA-enabled workspaces (paid add-on); confirm the plan |
| Neon (Postgres)                           | yes, at rest                                      | BAA on the Scale/Business plans with HIPAA enabled per project; confirm             |
| Redis Cloud (queue)                       | job payloads (session ids only today)             | BAA on Pro/Enterprise only                                                          |
| Cloudflare R2 / Workers (files, frontend) | R2: files at rest. Workers: PHI rendered in pages | BAA is Enterprise-only, and Workers/R2 eligibility isn't documented (PRD §10)       |
| Stripe                                    | billing data, no clinical PHI (B4.6)              | Stripe doesn't sign BAAs. Keep PHI out of Stripe                                    |

## Options

1. **Stay on the current vendors and sign BAAs:** Render HIPAA workspace, Neon HIPAA project, Redis Cloud Pro, Cloudflare Enterprise covering Workers + R2. Least migration work, but Cloudflare Enterprise coverage of Workers/R2 is uncertain and expensive.
2. **Move the PHI path to one hyperscaler with one BAA (AWS):** ECS/Fargate or App Runner (API), RDS Postgres, ElastiCache, S3 + KMS. Keep the marketing site on Cloudflare (no PHI); authenticated app pages are served from AWS (Amplify/CloudFront). One BAA, every service HIPAA-eligible, more ops work.
3. **Hybrid:** API + DB on BAA-covered Render + Neon; files move from R2 to S3 under an AWS BAA; frontend stays on Cloudflare **only** if the authenticated app is under a Cloudflare BAA. Otherwise serve it from Render too.

## Recommendation

**Option 3 if Render and Neon sign their BAAs at an acceptable price. Otherwise Option 2.** The B0 work already gives the app what an auditor checks, whichever host is chosen: tenant isolation with RLS, audit, MFA, idle logoff, PHI-safe logs, encrypted backups, and lifecycle tooling. Moving hosts is a configuration exercise: `DATABASE_URL`, `S3_*`, `REDIS_URL` (`rediss://`).

## Decision

_To be completed by the deciders:_ chosen option, BAA references (vendor, plan, signed date, services covered), and the date the PHI gate may open.

| Vendor | Services covered | BAA signed (date) | Reference |
| ------ | ---------------- | ----------------- | --------- |
|        |                  |                   |           |
