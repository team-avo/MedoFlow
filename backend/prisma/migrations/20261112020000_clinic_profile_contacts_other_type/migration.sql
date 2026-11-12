-- CTO-17: an optional secondary contact replaces office manager / accounts
-- payable on the form (those columns stay, so existing rows are untouched).
-- CTO-18: the typed practice type when "Other" is chosen.
ALTER TABLE "ClinicProfile" ADD COLUMN "secondaryContactName" TEXT;
ALTER TABLE "ClinicProfile" ADD COLUMN "secondaryContactEmail" TEXT;
ALTER TABLE "ClinicProfile" ADD COLUMN "secondaryContactPhone" TEXT;
ALTER TABLE "ClinicProfile" ADD COLUMN "practiceTypeOther" TEXT;
