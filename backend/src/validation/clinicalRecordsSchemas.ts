/**
 * Request validation for clinical records (B3.3): treatment plans,
 * prescriptions, intake form templates and responses.
 *
 * The frontend mirrors these rules in frontend/lib/schemas/clinicalRecords.ts;
 * both test suites run the shared cases in
 * shared/validation-cases/clinical-records.json, so a rule that drifts on
 * either side fails CI (F3.2 parity).
 */
import { z } from 'zod'
import type { ApiError } from '../types/errors'

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

/** YYYY-MM-DD or a full ISO timestamp. */
const dateString = z
  .string()
  .trim()
  .refine(
    (s) => /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s) && !Number.isNaN(Date.parse(s)),
    'Invalid date'
  )

const goals = z
  .array(z.string().trim().min(1, 'Goal cannot be empty').max(LIMITS.goalMax))
  .max(LIMITS.goalsMax)
  .nullable()
  .optional()

const notes = z.string().max(LIMITS.notesMax).nullable().optional()

const endNotBeforeStart = (d: { startDate?: string; endDate?: string | null }) =>
  !d.startDate || !d.endDate || Date.parse(d.endDate) >= Date.parse(d.startDate)

// ── Treatment plans ────────────────────────────────────────────────────────

export const treatmentPlanCreateSchema = z
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
  .refine(endNotBeforeStart, { message: 'End date cannot be before start date', path: ['endDate'] })

export const treatmentPlanUpdateSchema = z
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
  .refine(endNotBeforeStart, { message: 'End date cannot be before start date', path: ['endDate'] })

// ── Prescriptions ──────────────────────────────────────────────────────────

export const prescriptionCreateSchema = z
  .object({
    appointmentId: id,
    patientId: id.optional(),
    notes: z
      .string()
      .trim()
      .min(1, 'Prescription notes are required')
      .max(LIMITS.prescriptionNotesMax),
  })
  .strict()

// ── Intake form templates ──────────────────────────────────────────────────

export const FORM_FIELD_TYPES = ['text', 'textarea', 'number', 'checkbox', 'select'] as const

/**
 * A conditional follow-up (CTO-21): when a yes/no question is answered Yes
 * (a ticked checkbox, or the select value "yes"), the patient picks which
 * ones from a list, plus "Other" with free text. The answer is stored under
 * `<fieldId>__followUp` as `{ selected: string[], other?: string }`, inside
 * the same field-encrypted responses as every other answer.
 */
export const FOLLOW_UP_SUFFIX = '__followUp'

const followUpSchema = z
  .object({
    label: z.string().trim().min(1, 'Follow-up label is required').max(LIMITS.fieldLabelMax),
    options: z
      .array(
        z.object({
          value: z.string().trim().min(1).max(LIMITS.fieldLabelMax),
          label: z.string().trim().min(1).max(LIMITS.fieldLabelMax),
        })
      )
      .min(1, 'A follow-up needs at least one option')
      .max(LIMITS.optionsMax),
    allowOther: z.boolean().optional(),
    /** Default true: a Yes must say which. */
    required: z.boolean().optional(),
  })
  .strict()

type YesNoCandidate = { type: string; options?: { value: string }[] }
const isYesNoField = (f: YesNoCandidate) =>
  f.type === 'checkbox' ||
  (f.type === 'select' && (f.options ?? []).some((o) => o.value.toLowerCase() === 'yes'))

/** True when the answer to a yes/no field is Yes. */
export const answeredYes = (f: YesNoCandidate, v: unknown) =>
  f.type === 'checkbox' ? v === true : typeof v === 'string' && v.toLowerCase() === 'yes'

const formField = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Field id may contain letters, digits, - and _ only'),
    type: z.enum(FORM_FIELD_TYPES),
    label: z.string().trim().min(1, 'Field label is required').max(LIMITS.fieldLabelMax),
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
    followUp: followUpSchema.optional(),
  })
  .refine((f) => f.type !== 'select' || (f.options?.length ?? 0) > 0, {
    message: 'A select field needs at least one option',
    path: ['options'],
  })
  .refine((f) => !f.followUp || isYesNoField(f), {
    message: 'A follow-up needs a checkbox or a select with a "yes" option',
    path: ['followUp'],
  })

const formFields = z
  .array(formField)
  .min(1, 'A form needs at least one field')
  .max(LIMITS.templateFieldsMax)
  .refine((fs) => new Set(fs.map((f) => f.id)).size === fs.length, 'Field ids must be unique')

const scope = z.enum(['CLINIC', 'DISCIPLINE', 'SERVICE'])

const scopeTargets = (t: {
  scope?: 'CLINIC' | 'DISCIPLINE' | 'SERVICE'
  disciplineId?: string | null
  serviceId?: string | null
}) =>
  t.scope === undefined ||
  (t.scope === 'CLINIC' && !t.disciplineId && !t.serviceId) ||
  (t.scope === 'DISCIPLINE' && !!t.disciplineId) ||
  (t.scope === 'SERVICE' && !!t.serviceId)

const scopeMessage = {
  message: 'CLINIC scope takes no target; DISCIPLINE needs disciplineId; SERVICE needs serviceId',
  path: ['scope'],
}

export const formTemplateCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(LIMITS.templateNameMax),
    description: z.string().max(LIMITS.templateDescriptionMax).optional(),
    scope,
    disciplineId: optionalId,
    serviceId: optionalId,
    fields: formFields,
  })
  .strict()
  .refine(scopeTargets, scopeMessage)

export const formTemplateUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(LIMITS.templateNameMax).optional(),
    description: z.string().max(LIMITS.templateDescriptionMax).optional(),
    scope: scope.optional(),
    disciplineId: optionalId,
    serviceId: optionalId,
    fields: formFields.optional(),
  })
  .strict()

// ── Intake form responses ──────────────────────────────────────────────────

const followUpAnswer = z
  .object({
    selected: z.array(z.string().max(LIMITS.fieldLabelMax)).max(LIMITS.optionsMax),
    other: z.string().max(LIMITS.answerMax).optional(),
  })
  .strict()

const answer = z.union([
  z.string().max(LIMITS.answerMax),
  z.number().finite(),
  z.boolean(),
  z.null(),
  followUpAnswer,
])

export const formResponseSubmitSchema = z
  .object({
    templateId: id,
    appointmentId: optionalId,
    /** Legacy clients send it; it must be the caller (checked in the controller). */
    patientId: id.optional(),
    responses: z
      .record(z.string().max(64), answer)
      .refine((r) => Object.keys(r).length <= LIMITS.templateFieldsMax, 'Too many answers'),
  })
  .strict()

export type FormFieldDefinition = z.infer<typeof formField>
export type FollowUpAnswer = { selected: string[]; other?: string }
export type FormAnswers = Record<string, string | number | boolean | null | FollowUpAnswer>

/**
 * Checks answers against the template's field definitions: every required
 * field answered, every answer of the right type, select values among the
 * options, and no answers for fields the template does not have. Returns the
 * problems (empty when valid). Shared rule set with the frontend's
 * buildZodSchema (DynamicFormRenderer).
 */
export function answerProblems(fields: FormFieldDefinition[], answers: FormAnswers): string[] {
  const problems: string[] = []
  const known = new Set(fields.map((f) => f.id))
  for (const f of fields) if (f.followUp) known.add(`${f.id}${FOLLOW_UP_SUFFIX}`)
  for (const key of Object.keys(answers)) {
    if (!known.has(key)) problems.push(`Unknown field "${key}"`)
  }
  for (const f of fields) {
    if (f.followUp) problems.push(...followUpProblems(f, answers))
    const v = answers[f.id]
    const empty = v === undefined || v === null || v === ''
    if (f.type === 'checkbox') {
      if (!empty && typeof v !== 'boolean') problems.push(`${f.label} must be true or false`)
      else if (f.required && v !== true) problems.push(`${f.label} is required`)
      continue
    }
    if (empty) {
      if (f.required) problems.push(`${f.label} is required`)
      continue
    }
    if (f.type === 'number') {
      if (typeof v !== 'number') problems.push(`${f.label} must be a number`)
    } else if (typeof v !== 'string') {
      problems.push(`${f.label} must be text`)
    } else if (f.type === 'select' && !(f.options ?? []).some((o) => o.value === v)) {
      problems.push(`${f.label} must be one of the listed options`)
    } else if (v.trim() === '' && f.required) {
      problems.push(`${f.label} is required`)
    }
  }
  return problems
}

/** CTO-21: a Yes must say which (when required); a No carries no follow-up. */
function followUpProblems(f: FormFieldDefinition, answers: FormAnswers): string[] {
  const fu = f.followUp!
  const raw = answers[`${f.id}${FOLLOW_UP_SUFFIX}`]
  const given = raw !== undefined && raw !== null
  if (given && (typeof raw !== 'object' || !Array.isArray((raw as FollowUpAnswer).selected))) {
    return [`${fu.label} must be a list`]
  }
  const value = raw as FollowUpAnswer | null | undefined
  const selected = value?.selected ?? []
  const other = value?.other?.trim() ?? ''
  if (!answeredYes(f, answers[f.id])) {
    return selected.length || other ? [`${fu.label} applies only when the answer is Yes`] : []
  }
  const problems: string[] = []
  const allowed = new Set(fu.options.map((o) => o.value))
  if (selected.some((s) => !allowed.has(s))) {
    problems.push(`${fu.label} must be among the listed options`)
  }
  if (other && !fu.allowOther) problems.push(`${fu.label} doesn't take free text`)
  if (fu.required !== false && selected.length === 0 && !other) {
    problems.push(`${fu.label} is required`)
  }
  return problems
}

/** Throws a 400 when answers do not satisfy the template. */
export function assertAnswersMatchTemplate(fieldsJson: unknown, answers: FormAnswers): void {
  const parsed = z.array(formField).safeParse(fieldsJson)
  const problems = parsed.success ? answerProblems(parsed.data, answers) : []
  if (problems.length > 0) {
    const err = new Error(problems.join(', ')) as ApiError
    err.statusCode = 400
    err.code = 'validation_error'
    throw err
  }
}

export const idParamsSchema = z.object({ id })
export const patientIdParamsSchema = z.object({ patientId: id })
