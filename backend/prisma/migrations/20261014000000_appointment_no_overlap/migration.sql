-- B1.1 — the database itself refuses two live appointments for the same
-- provider that overlap in time. The advisory locks in appointmentService
-- remain as the fast-fail path; this constraint is the guarantee that holds
-- for every writer (app, scripts, seeds, manual SQL).
--
-- "Live" = every status except CANCELLED and RESCHEDULED, matching
-- ACTIVE_APPOINTMENT_STATUSES in src/services/appointmentService.ts.
-- Ranges are half-open [start, end), so back-to-back appointments are allowed.
--
-- Prisma cannot express exclusion constraints in schema.prisma; this
-- migration is their source of truth (see the note on model Appointment).

-- btree_gist lets the GiST index compare "providerId" with =.
-- It is a trusted extension (PG13+), so the migration owner can create it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Refuse to proceed over data that already breaks the rules, with a message
-- that says what to do (rather than a bare constraint error). Find the rows
-- with backend/scripts/ops/find-appointment-overlaps.sql.
DO $$
DECLARE
  bad_order integer;
  overlap_pairs integer;
BEGIN
  SELECT count(*) INTO bad_order FROM "Appointment" WHERE "endTime" <= "startTime";

  SELECT count(*) INTO overlap_pairs
  FROM "Appointment" a
  JOIN "Appointment" b
    ON a."providerId" = b."providerId"
   AND a.id < b.id
   AND a."startTime" < b."endTime"
   AND b."startTime" < a."endTime"
  WHERE a.status NOT IN ('CANCELLED', 'RESCHEDULED')
    AND b.status NOT IN ('CANCELLED', 'RESCHEDULED');

  IF bad_order > 0 OR overlap_pairs > 0 THEN
    RAISE EXCEPTION
      'B1.1: % appointment(s) end before they start and % overlapping live appointment pair(s) exist. Resolve them (scripts/ops/find-appointment-overlaps.sql) and re-run the migration.',
      bad_order, overlap_pairs;
  END IF;
END $$;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_time_order" CHECK ("endTime" > "startTime");

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_provider_no_overlap"
  EXCLUDE USING gist (
    "providerId" WITH =,
    tsrange("startTime", "endTime", '[)') WITH &&
  )
  WHERE (status NOT IN ('CANCELLED', 'RESCHEDULED'));
