-- Lists the rows that block migration 20261014000000_appointment_no_overlap (B1.1):
--   1. appointments whose end is not after their start;
--   2. pairs of live appointments (status not CANCELLED/RESCHEDULED) for the
--      same provider whose times overlap.
-- Read-only. Run as the owner role, e.g.
--   psql "$DATABASE_URL" -f scripts/ops/find-appointment-overlaps.sql
-- Resolve each pair (cancel or move one of them) and re-run the migration.
-- Output carries IDs and times only (no patient names).

SELECT 'end_not_after_start' AS problem, id AS appointment_id, NULL AS other_id,
       "providerId", "startTime", "endTime", status::text AS status, NULL AS other_status
FROM "Appointment"
WHERE "endTime" <= "startTime"

UNION ALL

SELECT 'overlap', a.id, b.id, a."providerId", a."startTime", a."endTime",
       a.status::text, b.status::text
FROM "Appointment" a
JOIN "Appointment" b
  ON a."providerId" = b."providerId"
 AND a.id < b.id
 AND a."startTime" < b."endTime"
 AND b."startTime" < a."endTime"
WHERE a.status NOT IN ('CANCELLED', 'RESCHEDULED')
  AND b.status NOT IN ('CANCELLED', 'RESCHEDULED')
ORDER BY 1, 4, 5;
