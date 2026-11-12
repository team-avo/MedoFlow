/**
 * Clinic onboarding — NPI / EIN / DEA format and checksum validation. The
 * cases are shared with the frontend (shared/validation-cases/practice-ids.json,
 * frontend/tests/unit/practiceIds.test.ts).
 */
import fs from 'fs'
import path from 'path'
import assert from 'node:assert/strict'
import {
  isValidDea,
  isValidEin,
  isValidNpi,
  maskIdentifier,
  normalizeDea,
  normalizeEin,
  normalizeNpi,
  PRACTICE_TYPE_KEYS,
  US_STATE_CODES,
} from '../utils/practiceIds'

type CaseSet = { valid: string[]; invalid: string[] }
const cases = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../shared/validation-cases/practice-ids.json'),
    'utf8'
  )
) as { npi: CaseSet; ein: CaseSet; dea: CaseSet }

const checks = { npi: isValidNpi, ein: isValidEin, dea: isValidDea } as const

describe.each(Object.keys(checks) as (keyof typeof checks)[])('%s (shared cases)', (kind) => {
  it.each(cases[kind].valid)('accepts %j', (value) => {
    assert.equal(checks[kind](value), true)
  })
  it.each(cases[kind].invalid)('rejects %j', (value) => {
    assert.equal(checks[kind](value), false)
  })
})

describe('normalisers', () => {
  it('reduces an NPI to its digits', () => {
    assert.equal(normalizeNpi('1234 567-893'), '1234567893')
  })
  it('formats an EIN as NN-NNNNNNN', () => {
    assert.equal(normalizeEin('123456789'), '12-3456789')
    assert.equal(normalizeEin(' 12-3456789 '), '12-3456789')
  })
  it('upper-cases a DEA number', () => {
    assert.equal(normalizeDea('ab 1234563'), 'AB1234563')
  })
})

describe('maskIdentifier', () => {
  it('keeps only the last 4 characters', () => {
    assert.equal(maskIdentifier('12-3456789'), '•••••6789')
    assert.equal(maskIdentifier('AB1234563'), '•••••4563')
  })
  it('handles empty and short values', () => {
    assert.equal(maskIdentifier(null), null)
    assert.equal(maskIdentifier(''), null)
    assert.equal(maskIdentifier('123'), '•••')
  })
})

describe('reference lists', () => {
  it('lists 50 states, DC and 3 territories once each', () => {
    assert.equal(US_STATE_CODES.length, 56)
    assert.equal(new Set(US_STATE_CODES).size, 56)
  })
  it('offers an OTHER practice type', () => {
    assert.ok(PRACTICE_TYPE_KEYS.includes('OTHER'))
  })
})
