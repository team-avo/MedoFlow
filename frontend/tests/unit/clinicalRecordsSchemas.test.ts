/**
 * F3.2 — Zod parity with the backend. The shared cases
 * (shared/validation-cases/clinical-records.json) are run here against the
 * frontend schemas and in backend/src/tests/clinicalRecordsValidation.test.ts
 * against the API's: the same payloads must pass and fail on both sides.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ZodTypeAny } from 'zod'
import {
  treatmentPlanCreatePayloadSchema,
  treatmentPlanUpdatePayloadSchema,
  prescriptionCreatePayloadSchema,
  formTemplateCreatePayloadSchema,
  buildAnswersSchema,
  treatmentPlanFormSchema,
  prescriptionFormSchema,
  type FormFieldDefinition,
} from '@/lib/schemas/clinicalRecords'

interface Case {
  case: string
  payload: Record<string, unknown>
}
interface Group {
  valid: Case[]
  invalid: Case[]
}

const cases = JSON.parse(
  fs
    .readFileSync(
      path.resolve(__dirname, '../../../shared/validation-cases/clinical-records.json'),
      'utf8'
    )
    .replace('"@@LONG_5001@@"', JSON.stringify('x'.repeat(5001)))
) as Record<string, Group> & {
  formAnswers: {
    fields: FormFieldDefinition[]
    valid: { case: string; answers: Record<string, unknown> }[]
    invalid: { case: string; answers: Record<string, unknown> }[]
  }
}

const schemas: Record<string, ZodTypeAny> = {
  treatmentPlanCreate: treatmentPlanCreatePayloadSchema,
  treatmentPlanUpdate: treatmentPlanUpdatePayloadSchema,
  prescriptionCreate: prescriptionCreatePayloadSchema,
  formTemplateCreate: formTemplateCreatePayloadSchema,
}

describe('F3.2 payload schemas match the API (shared cases)', () => {
  for (const [name, schema] of Object.entries(schemas)) {
    const group = cases[name]!
    describe(name, () => {
      it.each(group.valid.map((c) => [c.case, c.payload] as const))('accepts: %s', (_n, p) => {
        const r = schema.safeParse(p)
        expect(r.success, JSON.stringify(r.error?.issues)).toBe(true)
      })
      it.each(group.invalid.map((c) => [c.case, c.payload] as const))('rejects: %s', (_n, p) => {
        expect(schema.safeParse(p).success).toBe(false)
      })
    })
  }
})

describe('F3.2 intake answers match the API rules (shared cases)', () => {
  const schema = buildAnswersSchema(cases.formAnswers.fields)
  it.each(cases.formAnswers.valid.map((c) => [c.case, c.answers] as const))(
    'accepts: %s',
    (_n, answers) => {
      expect(schema.safeParse(answers).success).toBe(true)
    }
  )
  it.each(cases.formAnswers.invalid.map((c) => [c.case, c.answers] as const))(
    'rejects: %s',
    (_n, answers) => {
      expect(schema.safeParse(answers).success).toBe(false)
    }
  )
  it('blank optional number / select inputs are dropped, not sent as answers', () => {
    const optional = buildAnswersSchema([
      { id: 'n', type: 'number', label: 'N' },
      { id: 's', type: 'select', label: 'S', options: [{ value: 'a', label: 'A' }] },
    ])
    const r = optional.safeParse({ n: NaN, s: '' })
    expect(r.success).toBe(true)
    expect(r.success && r.data).toEqual({ n: undefined, s: undefined })
  })
  it('shows "Required" for a missing answer and "Enter a number" for a non-number', () => {
    const required = buildAnswersSchema([
      { id: 'n', type: 'number', label: 'N', required: true },
      {
        id: 's',
        type: 'select',
        label: 'S',
        required: true,
        options: [{ value: 'a', label: 'A' }],
      },
      { id: 't', type: 'text', label: 'T', required: true },
    ])
    const message = (answers: Record<string, unknown>, id: string) => {
      const r = required.safeParse(answers)
      return r.success ? undefined : r.error.issues.find((i) => i.path[0] === id)?.message
    }
    expect(message({}, 'n')).toBe('Required')
    expect(message({}, 's')).toBe('Required')
    expect(message({}, 't')).toBe('Required')
    expect(message({ n: 'abc' }, 'n')).toBe('Enter a number')
    expect(message({ n: Infinity }, 'n')).toBe('Enter a number')
  })
})

describe('F3.2 form-input schemas use the same limits', () => {
  it('plan form: coerces inputs and enforces the API limits', () => {
    const base = { name: 'Plan', disciplineId: 'd', startDate: '2026-10-01', totalSessions: '6' }
    expect(treatmentPlanFormSchema.safeParse(base).success).toBe(true)
    const notANumber = treatmentPlanFormSchema.safeParse({ ...base, totalSessions: 'abc' })
    expect(notANumber.success || notANumber.error.issues[0]?.message).toBe('Enter a number')
    for (const bad of [
      { ...base, totalSessions: '0' },
      { ...base, totalSessions: '501' },
      { ...base, totalSessions: '2.5' },
      { ...base, name: '   ' },
      { ...base, endDate: '2026-09-01' },
      { ...base, notes: 'x'.repeat(5001) },
    ]) {
      expect(treatmentPlanFormSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('prescription form: blank or over-long notes are refused', () => {
    expect(prescriptionFormSchema.safeParse({ notes: 'Rest' }).success).toBe(true)
    expect(prescriptionFormSchema.safeParse({ notes: '  ' }).success).toBe(false)
    expect(prescriptionFormSchema.safeParse({ notes: 'x'.repeat(5001) }).success).toBe(false)
  })
})
