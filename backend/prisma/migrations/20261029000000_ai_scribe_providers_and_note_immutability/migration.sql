-- Component 2 — AI Scribe / EMR (docs/adr/0006).
--
-- 1. AIScribeSession provenance (FR-15): which AI wrote the draft and which
--    speech-to-text model wrote the transcript; where recording consent came
--    from (FR-1).
-- 2. RxOrderLine.dose (B2.2): the strength as spoken, separate from the name.
--    Sealed by field-level encryption like rawText.
-- 3. VisitNoteVersion is immutable (B2.5, HIPAA §3.3): an amendment adds a
--    new version, it never edits one. UPDATE is refused for everyone except
--    the field re-encryption maintenance (ops:encrypt-phi), which rewrites
--    the ciphertext of the same content and must still never touch identity
--    columns. DELETE stays allowed: rows go only with their visit record,
--    through the data-lifecycle paths (off-boarding destroy, retention).

ALTER TABLE "AIScribeSession" ADD COLUMN "aiProvider" TEXT;
ALTER TABLE "AIScribeSession" ADD COLUMN "sttModel" TEXT;
ALTER TABLE "AIScribeSession" ADD COLUMN "consentSource" TEXT;
ALTER TABLE "AIScribeSession" ADD COLUMN "consentRecordedAt" TIMESTAMP(3);

ALTER TABLE "RxOrderLine" ADD COLUMN "dose" TEXT;

CREATE OR REPLACE FUNCTION medoflow_visit_note_version_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."visitRecordId" IS DISTINCT FROM OLD."visitRecordId"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'VisitNoteVersion is immutable: version % cannot be re-assigned', OLD."id";
  END IF;
  IF coalesce(current_setting('app.op_reason', true), '') <> 'ops:encrypt-phi' THEN
    RAISE EXCEPTION 'VisitNoteVersion is immutable: add a new version instead of editing %', OLD."id";
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS visit_note_version_immutable ON "VisitNoteVersion";
CREATE TRIGGER visit_note_version_immutable
  BEFORE UPDATE ON "VisitNoteVersion"
  FOR EACH ROW EXECUTE FUNCTION medoflow_visit_note_version_immutable();
