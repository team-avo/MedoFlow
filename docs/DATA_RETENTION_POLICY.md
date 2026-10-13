# Data retention and deletion policy (B0.6.7)

**Version:** 1.0 · 2026-10-13 · **Owner:** Security Officer (A.1) · **Status:** draft until approved by the Security Officer (A.3).

## Retention schedule

| Data                                                                                                                                                           | Where                                 | Retained for                                                                       | How it ends                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit log (`AuditLog`)                                                                                                                                         | Postgres                              | **≥ 6 years** from creation (`AUDIT_RETENTION_YEARS`, minimum 6; boot fails below) | Daily purge job over `AUDIT_PURGE_DATABASE_URL`. A DB trigger refuses to delete any row younger than 6 years, whoever asks                                 |
| Clinical records: visit records and note versions, scribe sessions/transcripts, treatment plans, prescriptions, intake responses, consultations, patient files | Postgres + R2 / disk                  | Life of the customer contract, then until off-boarding                             | Customer off-boarding (below). Never hard-deleted by application code                                                                                      |
| Appointments, invoices, payments, packages, memberships, commissions                                                                                           | Postgres                              | Life of the contract (tax/financial records: the customer keeps its export)        | Off-boarding                                                                                                                                               |
| User accounts                                                                                                                                                  | Postgres                              | Life of the account                                                                | Deactivation revokes access immediately. Off-boarding anonymises the account (name, email, password, MFA) and keeps the row so audit references stay valid |
| Sessions / refresh tokens                                                                                                                                      | Postgres                              | 7 days (absolute); idle sessions revoked after `SESSION_IDLE_TIMEOUT_MINUTES`      | Revoked on logout, idle, password change, MFA enrolment; deleted at off-boarding                                                                           |
| Stripe event ids (`ProcessedStripeEvent`)                                                                                                                      | Postgres                              | Indefinite (ids only, no PHI)                                                      | —                                                                                                                                                          |
| Database backups                                                                                                                                               | R2 `medoflow-backups` (age-encrypted) | 35 days (bucket lifecycle rule)                                                    | Objects expire automatically. Data destroyed at off-boarding disappears from backups within 35 days                                                        |
| Neon point-in-time history                                                                                                                                     | Neon                                  | Plan's history window                                                              | Ages out automatically                                                                                                                                     |
| Application logs                                                                                                                                               | Render log stream                     | Render's retention                                                                 | PHI-scrubbed before writing (B0.3.5)                                                                                                                       |

## Soft vs hard delete (enforced in code)

- **PHI and money records are never hard-deleted by application code.** The Prisma extension (`assertDeletePolicy`, `src/config/prisma.ts`) rejects `delete`/`deleteMany` on: AIScribeSession, Appointment, AppointmentSeries, AuditLog, BreakGlassGrant, Clinic, CommissionRecord, ConsultationSession, FormResponse, Invoice, PatientFile, PatientPackage, PatientSubscription, Payment, Prescription, Tenant, TreatmentPlan, User, VisitNoteVersion, VisitRecord, VoiceCall and VoiceCallEvent. The error is HTTP 409, `hard_delete_forbidden`.
- Users instead **cancel** (appointments, invoices), **finalize/amend** (notes create new versions) or **soft-delete** (`PatientFile.isDeleted`).
- Operational rows (cart items, draft invoice items, slot holds, provider/service links, site pages, tokens) may be hard-deleted.
- Hard deletion of protected records happens only inside a `withTenantBypass('lifecycle:…')` scope, in `src/services/dataLifecycleService.ts`.

## Customer off-boarding

1. A platform admin downloads the full export: `GET /api/v1/platform/lifecycle/tenants/:tenantId/export` (JSON with every clinic-scoped table, child tables and accounts; no password hashes, MFA secrets or tokens). It is handed to the customer over a secure channel. The export is audited (`TENANT_EXPORTED`).
2. After the customer confirms receipt in writing, a platform admin runs `POST /api/v1/platform/lifecycle/tenants/:tenantId/offboard` with `{ "confirmSlug": "<tenant slug>" }`. In order, this:
   - deletes every stored object: patient files, scribe audio, consultation and voice recordings;
   - deletes every clinic-scoped row and child row, in FK-safe order generated from the schema;
   - anonymises accounts used only at this customer and revokes their sessions;
   - turns the clinic and tenant into anonymous tombstones (status `CANCELED`);
   - **keeps** audit rows (6-year retention) and writes a `TENANT_OFFBOARDED` audit row.
3. Backups age out within 35 days. Record the off-boarding date in the customer file.

Verified by `src/tests/integration/dataLifecycle.int.test.ts`. It checks that the export is complete and secret-free, that every planned table is empty afterwards, that files are gone, that accounts are anonymised and cannot sign in, that audit rows are retained, and that another tenant is untouched.

## Approval

| Role             | Name | Date | Signature |
| ---------------- | ---- | ---- | --------- |
| Security Officer |      |      |           |
| Privacy Officer  |      |      |           |
