/**
 * Clinic onboarding lists and rules (CTO-06, CTO-16, CTO-18, CTO-22). Both
 * sides load shared/validation-cases/practice-lists.json, so the backend and
 * frontend lists can't drift apart.
 */
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  closestPracticeType,
  isValidPracticeTypeOther,
  isValidUsZip,
  PRACTICE_TYPES,
  PRACTITIONER_TITLES,
  US_STATE_CODES,
  zipStateMismatch,
} from '../utils/practiceIds'

const lists = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../shared/validation-cases/practice-lists.json'),
    'utf8'
  )
) as {
  practiceTypes: [string, string][]
  practitionerTitles: string[]
  usStates: string[]
  practiceTypeOther: { valid: string[]; invalid: string[] }
  closestPracticeType: { typed: string; expected: string | null }[]
  usZip: { valid: string[]; invalid: string[] }
  zipStateMismatch: { zip: string; state: string; mismatch: boolean }[]
}

describe('shared lists', () => {
  it('practice types match the shared list exactly, in order, Longevity before Other', () => {
    expect(PRACTICE_TYPES.map(([k, l]) => [k, l])).toEqual(lists.practiceTypes)
    const keys = PRACTICE_TYPES.map(([k]) => k)
    expect(keys.indexOf('LONGEVITY_MEDICAL')).toBe(keys.indexOf('OTHER') - 1)
  })
  it('practitioner titles match, with no "Owner"', () => {
    expect([...PRACTITIONER_TITLES]).toEqual(lists.practitionerTitles)
    expect(PRACTITIONER_TITLES).not.toContain('Owner')
  })
  it('US states and territories match', () => {
    expect([...US_STATE_CODES]).toEqual(lists.usStates)
  })
})

describe('practice type "Other"', () => {
  it.each(lists.practiceTypeOther.valid)('accepts %j', (v) =>
    expect(isValidPracticeTypeOther(v)).toBe(true)
  )
  it.each(lists.practiceTypeOther.invalid)('rejects %j', (v) =>
    expect(isValidPracticeTypeOther(v)).toBe(false)
  )
  it.each(lists.closestPracticeType)('suggests for %j', ({ typed, expected }) =>
    expect(closestPracticeType(typed)).toBe(expected)
  )
})

describe('US ZIP', () => {
  it.each(lists.usZip.valid)('accepts %j', (v) => expect(isValidUsZip(v)).toBe(true))
  it.each(lists.usZip.invalid)('rejects %j', (v) => expect(isValidUsZip(v)).toBe(false))
  it.each(lists.zipStateMismatch)('%j', ({ zip, state, mismatch }) =>
    expect(zipStateMismatch(zip, state)).toBe(mismatch)
  )
})
