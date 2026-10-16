/**
 * Client-side validation for clinical records (F3.2) — the mirror of
 * backend/src/validation/clinicalRecordsSchemas.ts. Both suites run the
 * shared cases in shared/validation-cases/clinical-records.json, so the two
 * sides cannot drift without CI failing.
 *
 * Payload schemas validate exactly what is sent to the API. The *FormSchema
 * variants validate the raw form inputs (strings from <input>) with the same
 * limits, so invalid input is blocked before submit.
 */
import { z } from 'zod'

export const LIMITS = {
  idMax: 64,
  planNameMax: 200,
  sessionsMax: 500,
  goalsMax: 50,
  goalMax: 500,
  notesMax: 5000,
  prescriptionNotesMax: 5000,
  templateNameMax: 200,
  templateDescriptionMax: 1000,
  templateFieldsMax: 100,
  fieldLabelMax: 200,
  optionsMax: 100,
  answerMax: 5000,
} as const

const id = z.string().trim().min(1).max(LIMITS.idMax)
const optionalId = id.optional().nullable()

const isDateString = (s: string) =>
  /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s) && !Number.isNaN(Date.parse(s))
const dateString = z.string().trim().refine(isDateString, 'Invalid date')

const goals = z
  .array(z.string().trim().min(1, 'Goal cannot be empty').max(LIMITS.goalMax))
  .max(LIMITS.goalsMax)
  .nullable()
  .optional()

const notes = z.string().max(LIMITS.notesMax).nullable().optional()

const endNotBeforeStart = (d: { startDate?: string; endDate?: string | null }) =>
  !d.startDate || !d.endDate || Date.parse(d.endDate) >= Date.parse(d.startDate)
const endDateRule = { message: 'End date cannot be before start date', path: ['endDate'] }

// ── Treatment plans ────────────────────────────────────────────────────────

export const treatmentPlanCreatePayloadSchema = z
  .object({
    patientId: id,
    providerId: id.optional(),
    disciplineId: id,
    name: z.string().trim().min(1, 'Plan name is required').max(LIMITS.planNameMax),
    totalSessions: z.number().int().min(1, 'At least 1 session required').max(LIMITS.sessionsMax),
    startDate: dateString,
    endDate: dateString.nullable().optional(),
    goals,
    notes,
  })
  .strict()
  .refine(endNotBeforeStart, endDateRule)

export const treatmentPlanUpdatePayloadSchema = z
  .object({
    name: z.string().trim().min(1, 'Plan name is required').max(LIMITS.planNameMax).optional(),
    totalSessions: z.number().int().min(1).max(LIMITS.sessionsMax).optional(),
    sessionsCompleted: z.number().int().min(0).max(LIMITS.sessionsMax).optional(),
    startDate: dateString.optional(),
    endDate: dateString.nullable().optional(),
    goals,
    notes,
  })
  .strict()
  .refine(endNotBeforeStart, endDateRule)

/** The plan form's raw inputs (numbers arrive as strings from <input>). */
export const treatmentPlanFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Plan name is required').max(LIMITS.planNameMax),
    disciplineId: z.string().min(1, 'Discipline is required'),
    providerId: z.string().optional(),
    totalSessions: z.coerce
      .number({ invalid_type_error: 'Enter a number' })
      .int('Whole sessions only')
      .min(1, 'At least 1 session required')
      .max(LIMITS.sessionsMax, `At most ${LIMITS.sessionsMax} sessions`),
    sessionsCompleted: z.coerce
      .number()
      .int('Whole sessions only')
      .min(0, 'Cannot be negative')
      .max(LIMITS.sessionsMax)
      .optional(),
    startDate: z.string().min(1, 'Start date is required').refine(isDateString, 'Invalid date'),
    endDate: z.string().optional().or(z.literal('')),
    notes: z.string().max(LIMITS.notesMax, `At most ${LIMITS.notesMax} characters`).optional(),
  })
  .refine((d) => !d.endDate || endNotBeforeStart(d), endDateRule)

/** A goal typed into the plan form before it is added to the list. */
export const goalSchema = z
  .string()
  .trim()
  .min(1, 'Goal cannot be empty')
  .max(LIMITS.goalMax, `At most ${LIMITS.goalMax} characters`)

// ── Prescriptions ──────────────────────────────────────────────────────────

const prescriptionNotes = z
  .string()
  .trim()
  .min(1, 'Prescription notes are required')
  .max(LIMITS.prescriptionNotesMax, `At most ${LIMITS.prescriptionNotesMax} characters`)

export const prescriptionCreatePayloadSchema = z
  .object({ appointmentId: id, patientId: id.optional(), notes: prescriptionNotes })
  .strict()

export const prescriptionFormSchema = z.object({ notes: prescriptionNotes })

// ── Intake form templates ──────────────────────────────────────────────────

export const FORM_FIELD_TYPES = ['text', 'textarea', 'number', 'checkbox', 'select'] as const

export const formFieldSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Field id may contain letters, digits, - and _ only'),
    type: z.enum(FORM_FIELD_TYPES),
    label: z.string().trim().min(1, 'Every field needs a label').max(LIMITS.fieldLabelMax),
    required: z.boolean().optional(),
    placeholder: z.string().max(LIMITS.fieldLabelMax).optional(),
    options: z
      .array(
        z.object({
          value: z.string().trim().min(1).max(LIMITS.fieldLabelMax),
          label: z.string().trim().min(1).max(LIMITS.fieldLabelMax),
        })
      )
      .max(LIMITS.optionsMax)
      .optional(),
  })
  .refine((f) => f.type !== 'select' || (f.options?.length ?? 0) > 0, {
    message: 'A select field needs at least one option',
    path: ['options'],
  })

const formFields = z
  .array(formFieldSchema)
  .min(1, 'A form needs at least one field')
  .max(LIMITS.templateFieldsMax)
  .refine((fs) => new Set(fs.map((f) => f.id)).size === fs.length, 'Field ids must be unique')

const scopeTargets = (t: {
  scope?: 'CLINIC' | 'DISCIPLINE' | 'SERVICE'
  disciplineId?: string | null
  serviceId?: string | null
}) =>
  t.scope === undefined ||
  (t.scope === 'CLINIC' && !t.disciplineId && !t.serviceId) ||
  (t.scope === 'DISCIPLINE' && !!t.disciplineId) ||
  (t.scope === 'SERVICE' && !!t.serviceId)

export const formTemplateCreatePayloadSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(LIMITS.templateNameMax),
    description: z.string().max(LIMITS.templateDescriptionMax).optional(),
    scope: z.enum(['CLINIC', 'DISCIPLINE', 'SERVICE']),
    disciplineId: optionalId,
    serviceId: optionalId,
    fields: formFields,
  })
  .strict()
  .refine(scopeTargets, {
    message: 'Pick a discipline or service for this scope',
    path: ['scope'],
  })

// ── Intake form answers ────────────────────────────────────────────────────

export type FormFieldDefinition = z.infer<typeof formFieldSchema>

const blankToUndefined = (v: unknown) =>
  v === '' || v === null || (typeof v === 'number' && Number.isNaN(v)) ? undefined : v

/**
 * Builds the answer schema for a template — the same rules the API applies
 * (backend answerProblems): required fields answered (blank text counts as
 * unanswered), numbers are numbers, select values among the options, a
 * required checkbox ticked.
 */
export function buildAnswersSchema(fields: FormFieldDefinition[]) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) {
    if (f.type === 'checkbox') {
      shape[f.id] = f.required
        ? z.boolean().refine((v) => v === true, 'Required')
        : z.boolean().optional()
    } else if (f.type === 'number') {
      const num = z
        .number({ required_error: 'Required', invalid_type_error: 'Enter a number' })
        .finite()
      shape[f.id] = z.preprocess(
        (v) => {
          const b = blankToUndefined(v)
          return typeof b === 'string' ? Number(b) : b
        },
        f.required ? num : num.optional()
      )
    } else if (f.type === 'select') {
      const values = (f.options ?? []).map((o) => o.value)
      const pick = z
        .string({ required_error: 'Required' })
        .refine((v) => values.includes(v), 'Choose one of the options')
      shape[f.id] = z.preprocess(blankToUndefined, f.required ? pick : pick.optional())
    } else {
      const text = z
        .string({ required_error: 'Required' })
        .max(LIMITS.answerMax, `At most ${LIMITS.answerMax} characters`)
      shape[f.id] = f.required
        ? text.refine((v) => v.trim().length > 0, 'Required')
        : text.optional()
    }
  }
  return z.object(shape)
}
