## What and why

<!-- One or two sentences. Link the plan task (e.g. B0.1.2) or issue. -->

## Tests (B0.5.4 — required for PHI or money changes)

- [ ] This PR changes PHI handling or money (payments, invoices, refunds, commissions, memberships): **a test that fails without this change is included** → name it: `…`
- [ ] Happy path **and** at least one failure / edge / negative case covered
- [ ] Not applicable (no behaviour change) — reason: …

## HIPAA per-change gate (docs/HIPAA_COMPLIANCE_CHECKLIST.md §2)

- [ ] Queries on clinic-scoped models are scoped (`clinicId` / `clinicScope()`); no new `withTenantBypass` without a justification in the PR
- [ ] PHI create / update / delete writes an audit row; sensitive reads use `logRead`
- [ ] No PHI in logs, error messages, URLs, Stripe metadata or monitoring payloads
- [ ] Minimum necessary: responses select only the fields the screen needs
- [ ] No new vendor / SDK / LLM receiving PHI without a BAA decision
- [ ] Fixtures are synthetic (`node backend/scripts/check-synthetic-fixtures.js`)
- [ ] N/A — this change touches no PHI (reason): …

## Evidence

<!-- Test output, screenshot, log line or query result showing the acceptance criterion. -->
