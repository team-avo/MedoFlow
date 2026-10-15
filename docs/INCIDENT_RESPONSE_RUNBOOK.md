# Incident response and breach runbook (B0.6.6)

**Version:** 1.0 · 2026-10-13 · **Owner:** Security Officer · Review yearly and after every incident.
Applies to any suspected unauthorised access, use or disclosure of PHI or systems that hold it.

## Roles

| Role           | Who                      | Responsibility                                         |
| -------------- | ------------------------ | ------------------------------------------------------ |
| Incident lead  | Security Officer (A.1)   | Declares the incident, owns the timeline and decisions |
| Technical lead | On-call backend engineer | Containment, evidence, fixes                           |
| Privacy lead   | Privacy Officer (A.1)    | Breach assessment, notifications                       |
| Comms          | CEO / delegate           | Customer (covered entity) communication                |

## 1. Detect (minutes)

Signals:

- `[security-alert]` lines / the `ALERT_WEBHOOK_URL` channel: `failed_auth_spike`, `anomalous_record_access`, `break_glass_activated`;
- `[tenant-guard:VIOLATION]` or `[delete-policy:VIOLATION]` in logs;
- `REFRESH_TOKEN_REUSE` (critical) audit rows;
- customer reports, vendor notices (Neon, Render, Cloudflare, Stripe), or a leaked secret alert.

Open an incident record (use the breach log below), with a UTC timestamp for every step.

## 2. Contain (first hour)

| Situation                                  | Action                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compromised user account                   | Deactivate the user (staff screen) → all requests 401 at once. Revoke sessions: `UPDATE "UserSession" SET "revokedAt"=now(), "revokedReason"='incident' WHERE "userId"='…'` |
| Leaked JWT secret                          | Rotate `JWT_SECRET` **without** keeping the old value in `JWT_SECRET_PREVIOUS` → every token is rejected and everyone signs in again                                        |
| Leaked DB / R2 / Stripe / Redis credential | Rotate at the provider, update Render env, redeploy (docs/SECRETS_AND_ROTATION.md)                                                                                          |
| Ongoing abuse from an IP / route           | Cloudflare WAF rule, or take the route offline with an emergency deploy                                                                                                     |
| Data corruption / destructive change       | Stop writes (scale to 0 or maintenance), restore to a Neon branch at a point in time, compare, then repoint                                                                 |

Preserve evidence. Export the relevant `AuditLog` rows (they're append-only, so they can't be altered), Render logs, and Cloudflare logs. Never delete logs during an incident.

## 3. Assess (within 24 h; complete in ≤ 10 days)

HIPAA four-factor risk assessment (45 CFR 164.402):

1. The nature and extent of the PHI involved: identifiers, clinical data, likelihood of re-identification.
2. The unauthorised person who used or received it.
3. Whether the PHI was actually acquired or viewed. Use `READ` audit rows, `FILE_DOWNLOADED` rows and the access logs.
4. How far the risk has been mitigated.

The outcome is either "low probability of compromise" (documented, no notification) or a **breach**.

Useful queries (owner connection):

```sql
-- everything one actor did in a window
SELECT "createdAt", action, "entityType", "entityId", "clinicId", "ipAddress"
FROM "AuditLog" WHERE "performedById" = '<user>' AND "createdAt" BETWEEN '<from>' AND '<to>' ORDER BY 1;
-- who read a given record
SELECT "createdAt", "performedById", "ipAddress" FROM "AuditLog" WHERE "entityId" = '<record>' AND action IN ('READ','FILE_DOWNLOADED');
-- emergency access in a window
SELECT * FROM "AuditLog" WHERE action LIKE 'BREAK_GLASS_%' AND "createdAt" > now() - interval '7 days';
```

## 4. Notify (without unreasonable delay; ≤ 60 days from discovery)

MedoFlow is a **business associate**. Under each customer BAA, notify the affected **covered entity (clinic)** without unreasonable delay. Use the BAA's deadline if it is shorter, and never more than 60 days from discovery. Include:

- the identity of each affected individual (where known);
- what happened, the dates of the breach and of discovery;
- the PHI types involved;
- the mitigation done, and steps individuals should take.

The covered entity notifies individuals, HHS and the media (500+ in a state). Help them with data on request. Breaches affecting under 500 people are logged for the clinic's annual HHS submission.

## 5. Recover and learn

- Fix the root cause with a PR that adds a regression test (B0.5.4).
- Write a blameless post-incident review within 10 business days.
- Update this runbook and the risk analysis (A.2).

## Tabletop exercises

Run one at least yearly, and before the first real-PHI clinic. Suggested scenario: "a front-desk account shows an `anomalous_record_access` alert at 02:00 for 60 patient files." Walk through steps 1–5 using the staging env and the queries above. Log each exercise here:

| Date | Scenario | Participants | Findings / actions |
| ---- | -------- | ------------ | ------------------ |
|      |          |              |                    |

## Breach log (template)

| #   | Discovered (UTC) | Reported by | Systems | PHI involved | # individuals | Contained (UTC) | Assessment outcome | Covered entities notified (date) | Closed |
| --- | ---------------- | ----------- | ------- | ------------ | ------------- | --------------- | ------------------ | -------------------------------- | ------ |
|     |                  |             |         |              |               |                 |                    |                                  |        |
