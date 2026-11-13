-- CTO-31: virtual vs in-person appointments. Additive; every existing
-- appointment and service is in person.
CREATE TYPE "AppointmentMode" AS ENUM ('IN_PERSON', 'VIRTUAL');
ALTER TABLE "Appointment" ADD COLUMN "mode" "AppointmentMode" NOT NULL DEFAULT 'IN_PERSON';
ALTER TABLE "Service" ADD COLUMN "defaultMode" "AppointmentMode" NOT NULL DEFAULT 'IN_PERSON';
