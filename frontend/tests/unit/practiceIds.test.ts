/**
 * Clinic onboarding — NPI / EIN / DEA checks. Same cases as the backend
 * (shared/validation-cases/practice-ids.json, backend/src/tests/practiceIds.test.ts).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isValidDea, isValidEin, isValidNpi, maskIdentifier } from '@/lib/practiceIds'

type CaseSet = { valid: string[]; invalid: string[] }
const cases = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../shared/validation-cases/practice-ids.json'),
    'utf8'
  )
) as { npi: CaseSet; ein: CaseSet; dea: CaseSet }

const checks = { npi: isValidNpi, ein: isValidEin, dea: isValidDea } as const

describe.each(Object.keys(checks) as (keyof typeof checks)[])('%s (shared cases)', (kind) => {
  it.each(cases[kind].valid)('accepts %j', (v) => expect(checks[kind](v)).toBe(true))
  it.each(cases[kind].invalid)('rejects %j', (v) => expect(checks[kind](v)).toBe(false))
})

it('masks all but the last 4', () => {
  expect(maskIdentifier('12-3456789')).toBe('•••••6789')
})
