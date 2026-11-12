-- CTO-29: NPPES registry lookups for the application's NPIs (public data, not PHI).
ALTER TABLE "ClinicProfile" ADD COLUMN "npiVerification" JSONB;
