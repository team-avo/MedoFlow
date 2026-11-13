-- CTO-30: in-app notifications (bell red dot, Command Center "starting soon").
-- PHI-free payload: ids, a time and a short generic title only.
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT,
    "appointmentId" TEXT,
    "startsAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_userId_kind_appointmentId_key" ON "Notification"("userId", "kind", "appointmentId");
CREATE INDEX "Notification_clinicId_idx" ON "Notification"("clinicId");
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security (same policy shape as 20261013020000).
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Notification"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

GRANT SELECT, INSERT, UPDATE, DELETE ON "Notification" TO medoflow_app;
