-- CTO-25: signing the clinic agreement now finishes onboarding. Clinics that
-- signed but were left mid-way through the old setup wizard are sent straight
-- to the dashboard instead of being stranded on /brand, /locations and so on.
UPDATE "Tenant"
SET "onboardingCompletedAt" = COALESCE("termsAcceptedAt", NOW())
WHERE "termsAcceptedAt" IS NOT NULL
  AND "onboardingCompletedAt" IS NULL;
