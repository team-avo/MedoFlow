-- CTO-13: a longer, still bounded idle window while the clinic owner fills in
-- the application. Null keeps the normal SESSION_IDLE_TIMEOUT_MINUTES.
ALTER TABLE "UserSession" ADD COLUMN "idleTimeoutMinutes" INTEGER;
