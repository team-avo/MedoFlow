-- Tenant RLS v2 (B0.1.3) + append-only audit log (B0.3.3 / B0.3.6).
--
-- 1. Application role `medoflow_app`: NOSUPERUSER, NOBYPASSRLS, not the table
--    owner — so Postgres row-level security actually applies to it. Created
--    NOLOGIN; an operator enables it once per environment:
--        ALTER ROLE medoflow_app WITH LOGIN PASSWORD '<generated>';
--    and points DATABASE_URL at it. Migrations keep running as the owner
--    (MIGRATION_DATABASE_URL), which is why this role gets DML only.
--
-- 2. Policies keyed on the caller's clinics. The app sets, per transaction
--    (src/config/prisma.ts):
--        app.clinic_ids         comma-separated clinic ids the caller may touch
--        app.rls_bypass         'on' inside a named withTenantBypass() scope
--        app.current_tenant_id  the caller's tenant (Clinic / Brand rows)
--    A connection that sets nothing sees zero rows and cannot insert (fail closed).
--
-- 3. AuditLog is append-only: no UPDATE / DELETE / TRUNCATE grant for the app
--    role, plus a trigger that rejects UPDATE and TRUNCATE for everyone and
--    DELETE of any row younger than the 6-year HIPAA retention window.
--
-- Replaces the v1 policies (`tenant_isolation_policy`, `tenant_isolation`)
-- from migrations 20260419000000 and 20260424000000.

-- ─── 1. Application role ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medoflow_app') THEN
    CREATE ROLE medoflow_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO medoflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO medoflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO medoflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO medoflow_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO medoflow_app;
REVOKE ALL ON "_prisma_migrations" FROM medoflow_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM medoflow_app;

-- ─── 2. Policies ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION medoflow_rls_bypass() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.rls_bypass', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION medoflow_rls_clinic_allowed(row_clinic_id text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT medoflow_rls_bypass()
      OR row_clinic_id = ANY (string_to_array(nullif(current_setting('app.clinic_ids', true), ''), ','))
$$;

-- Clinic: own clinics, or any clinic of the caller's tenant.
DROP POLICY IF EXISTS "tenant_isolation" ON "Clinic";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Clinic";
ALTER TABLE "Clinic" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Clinic"
  USING (medoflow_rls_clinic_allowed("id") OR "tenantId" = nullif(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (medoflow_rls_clinic_allowed("id") OR "tenantId" = nullif(current_setting('app.current_tenant_id', true), ''));

-- Brand: the caller's tenant.
DROP POLICY IF EXISTS "tenant_isolation" ON "Brand";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Brand";
ALTER TABLE "Brand" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Brand"
  USING (medoflow_rls_bypass() OR "tenantId" = nullif(current_setting('app.current_tenant_id', true), ''))
  WITH CHECK (medoflow_rls_bypass() OR "tenantId" = nullif(current_setting('app.current_tenant_id', true), ''));

-- AIScribeSession
DROP POLICY IF EXISTS tenant_isolation_policy ON "AIScribeSession";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "AIScribeSession";
ALTER TABLE "AIScribeSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "AIScribeSession"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Appointment
DROP POLICY IF EXISTS tenant_isolation_policy ON "Appointment";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Appointment";
ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Appointment"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- AppointmentSeries
DROP POLICY IF EXISTS tenant_isolation_policy ON "AppointmentSeries";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "AppointmentSeries";
ALTER TABLE "AppointmentSeries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "AppointmentSeries"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- AuditLog
DROP POLICY IF EXISTS tenant_isolation_policy ON "AuditLog";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "AuditLog";
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "AuditLog"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- BreakGlassGrant
DROP POLICY IF EXISTS tenant_isolation_policy ON "BreakGlassGrant";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "BreakGlassGrant";
ALTER TABLE "BreakGlassGrant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "BreakGlassGrant"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Cart
DROP POLICY IF EXISTS tenant_isolation_policy ON "Cart";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Cart";
ALTER TABLE "Cart" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Cart"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- CommissionRecord
DROP POLICY IF EXISTS tenant_isolation_policy ON "CommissionRecord";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "CommissionRecord";
ALTER TABLE "CommissionRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "CommissionRecord"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- CommissionRule
DROP POLICY IF EXISTS tenant_isolation_policy ON "CommissionRule";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "CommissionRule";
ALTER TABLE "CommissionRule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "CommissionRule"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- ConsultationSession
DROP POLICY IF EXISTS tenant_isolation_policy ON "ConsultationSession";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "ConsultationSession";
ALTER TABLE "ConsultationSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "ConsultationSession"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- CustomRole
DROP POLICY IF EXISTS tenant_isolation_policy ON "CustomRole";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "CustomRole";
ALTER TABLE "CustomRole" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "CustomRole"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Discipline
DROP POLICY IF EXISTS tenant_isolation_policy ON "Discipline";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Discipline";
ALTER TABLE "Discipline" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Discipline"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- FormResponse
DROP POLICY IF EXISTS tenant_isolation_policy ON "FormResponse";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "FormResponse";
ALTER TABLE "FormResponse" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "FormResponse"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- FormTemplate
DROP POLICY IF EXISTS tenant_isolation_policy ON "FormTemplate";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "FormTemplate";
ALTER TABLE "FormTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "FormTemplate"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- GoogleCalendarConnection
DROP POLICY IF EXISTS tenant_isolation_policy ON "GoogleCalendarConnection";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "GoogleCalendarConnection";
ALTER TABLE "GoogleCalendarConnection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "GoogleCalendarConnection"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- GoogleCalendarEvent
DROP POLICY IF EXISTS tenant_isolation_policy ON "GoogleCalendarEvent";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "GoogleCalendarEvent";
ALTER TABLE "GoogleCalendarEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "GoogleCalendarEvent"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- InventoryItem
DROP POLICY IF EXISTS tenant_isolation_policy ON "InventoryItem";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "InventoryItem";
ALTER TABLE "InventoryItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "InventoryItem"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Invoice
DROP POLICY IF EXISTS tenant_isolation_policy ON "Invoice";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Invoice";
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Invoice"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Location
DROP POLICY IF EXISTS tenant_isolation_policy ON "Location";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Location";
ALTER TABLE "Location" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Location"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Membership
DROP POLICY IF EXISTS tenant_isolation_policy ON "Membership";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Membership";
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Membership"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Package
DROP POLICY IF EXISTS tenant_isolation_policy ON "Package";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Package";
ALTER TABLE "Package" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Package"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- PatientClinicMembership
DROP POLICY IF EXISTS tenant_isolation_policy ON "PatientClinicMembership";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "PatientClinicMembership";
ALTER TABLE "PatientClinicMembership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "PatientClinicMembership"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- PatientFile
DROP POLICY IF EXISTS tenant_isolation_policy ON "PatientFile";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "PatientFile";
ALTER TABLE "PatientFile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "PatientFile"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- PatientPackage
DROP POLICY IF EXISTS tenant_isolation_policy ON "PatientPackage";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "PatientPackage";
ALTER TABLE "PatientPackage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "PatientPackage"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- PatientSubscription
DROP POLICY IF EXISTS tenant_isolation_policy ON "PatientSubscription";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "PatientSubscription";
ALTER TABLE "PatientSubscription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "PatientSubscription"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Payment
DROP POLICY IF EXISTS tenant_isolation_policy ON "Payment";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Payment";
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Payment"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Prescription
DROP POLICY IF EXISTS tenant_isolation_policy ON "Prescription";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Prescription";
ALTER TABLE "Prescription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Prescription"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Product
DROP POLICY IF EXISTS tenant_isolation_policy ON "Product";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Product";
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Product"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Provider
DROP POLICY IF EXISTS tenant_isolation_policy ON "Provider";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Provider";
ALTER TABLE "Provider" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Provider"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- Service
DROP POLICY IF EXISTS tenant_isolation_policy ON "Service";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "Service";
ALTER TABLE "Service" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "Service"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- SitePage
DROP POLICY IF EXISTS tenant_isolation_policy ON "SitePage";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "SitePage";
ALTER TABLE "SitePage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "SitePage"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- SlotHold
DROP POLICY IF EXISTS tenant_isolation_policy ON "SlotHold";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "SlotHold";
ALTER TABLE "SlotHold" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "SlotHold"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- TreatmentPlan
DROP POLICY IF EXISTS tenant_isolation_policy ON "TreatmentPlan";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "TreatmentPlan";
ALTER TABLE "TreatmentPlan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "TreatmentPlan"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- VisitRecord
DROP POLICY IF EXISTS tenant_isolation_policy ON "VisitRecord";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "VisitRecord";
ALTER TABLE "VisitRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "VisitRecord"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- VoiceAgentConfig
DROP POLICY IF EXISTS tenant_isolation_policy ON "VoiceAgentConfig";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "VoiceAgentConfig";
ALTER TABLE "VoiceAgentConfig" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "VoiceAgentConfig"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- VoiceCall
DROP POLICY IF EXISTS tenant_isolation_policy ON "VoiceCall";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "VoiceCall";
ALTER TABLE "VoiceCall" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "VoiceCall"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- WaitlistEntry
DROP POLICY IF EXISTS tenant_isolation_policy ON "WaitlistEntry";
DROP POLICY IF EXISTS medoflow_clinic_isolation ON "WaitlistEntry";
ALTER TABLE "WaitlistEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY medoflow_clinic_isolation ON "WaitlistEntry"
  USING (medoflow_rls_clinic_allowed("clinicId"))
  WITH CHECK (medoflow_rls_clinic_allowed("clinicId"));

-- ─── 3. Append-only AuditLog ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION medoflow_auditlog_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'AuditLog is append-only: UPDATE is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'AuditLog is append-only: TRUNCATE is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD."createdAt" > (now() AT TIME ZONE 'UTC') - interval '6 years' THEN
      RAISE EXCEPTION 'AuditLog rows are retained for 6 years: row % (created %) cannot be deleted',
        OLD."id", OLD."createdAt"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS auditlog_append_only_row ON "AuditLog";
CREATE TRIGGER auditlog_append_only_row
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION medoflow_auditlog_append_only();

DROP TRIGGER IF EXISTS auditlog_append_only_truncate ON "AuditLog";
CREATE TRIGGER auditlog_append_only_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION medoflow_auditlog_append_only();
