/**
 * B3.3 — malformed clinical-record input is rejected by Zod. Runs the shared
 * parity cases (shared/validation-cases/clinical-records.json); the frontend
 * suite runs the same file against its own schemas (F3.2).
 */
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import type { ZodTypeAny } from 'zod'
import {
  treatmentPlanCreateSchema,
  treatmentPlanUpdateSchema,
  prescriptionCreateSchema,
  formTemplateCreateSchema,
  answerProblems,
  assertAnswersMatchTemplate,
  type FormAnswers,
  type FormFieldDefinition,
} from '../validation/clinicalRecordsSchemas'

interface Case {
  case: string
  payload: Record<string, unknown>
}
interface Group {
  valid: Case[]
  invalid: Case[]
}

const CASES_FILE = path.resolve(__dirname, '../../../shared/validation-cases/clinical-records.json')
const cases = JSON.parse(
  fs.readFileSync(CASES_FILE, 'utf8').replace('"@@LONG_5001@@"', JSON.stringify('x'.repeat(5001)))
) as {
  treatmentPlanCreate: Group
  treatmentPlanUpdate: Group
  prescriptionCreate: Group
  formTemplateCreate: Group
  formAnswers: {
    fields: FormFieldDefinition[]
    valid: { case: string; answers: FormAnswers }[]
    invalid: { case: string; answers: FormAnswers }[]
  }
}

const schemas: Record<string, ZodTypeAny> = {
  treatmentPlanCreate: treatmentPlanCreateSchema,
  treatmentPlanUpdate: treatmentPlanUpdateSchema,
  prescriptionCreate: prescriptionCreateSchema,
  formTemplateCreate: formTemplateCreateSchema,
}

describe('B3.3 request schemas (shared parity cases)', () => {
  for (const [name, schema] of Object.entries(schemas)) {
    const group = cases[name as keyof typeof cases] as Group
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

describe('B3.3 intake answers are checked against the template', () => {
  const { fields, valid, invalid } = cases.formAnswers

  it.each(valid.map((c) => [c.case, c.answers] as const))('accepts: %s', (_n, answers) => {
    expect(answerProblems(fields, answers)).toEqual([])
  })

  it.each(invalid.map((c) => [c.case, c.answers] as const))('rejects: %s', (_n, answers) => {
    expect(answerProblems(fields, answers).length).toBeGreaterThan(0)
  })

  it('rejects answers to fields the template does not have', () => {
    const answers = { ...valid[0]!.answers, injected: 'x' }
    expect(answerProblems(fields, answers)).toContain('Unknown field "injected"')
  })

  it('assertAnswersMatchTemplate throws a 400 with every problem listed', () => {
    let caught: { statusCode?: number; message?: string } | undefined
    try {
      assertAnswersMatchTemplate(fields, { age: 'x' })
    } catch (e) {
      caught = e as typeof caught
    }
    expect(caught?.statusCode).toBe(400)
    expect(caught?.message).toMatch(/Reason for visit is required/)
    expect(caught?.message).toMatch(/Age must be a number/)
  })
})
