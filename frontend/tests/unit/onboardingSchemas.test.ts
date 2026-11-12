/** Clinic onboarding: client validation of the application forms. */
import { describe, expect, it } from 'vitest'
import {
  emptyPractitioner,
  practiceFormDefaults,
  practiceFormSchema,
  practitionersValid,
  signatureMatches,
  toPracticePayload,
  validatePractitioners,
  type PracticeFormValues,
} from '@/lib/schemas/onboarding'
import type { Application } from '@/lib/onboardingApi'

const valid = (o: Partial<PracticeFormValues> = {}): PracticeFormValues => ({
  ...practiceFormDefaults(null, { name: 'Olivia Owner', email: 'olivia@example.test' }),
  legalName: 'Synthetic Wellness LLC',
  practiceType: 'FUNCTIONAL_MEDICINE',
  addressLine1: '100 Example Street',
  city: 'Testville',
  state: 'TX',
  postalCode: '75001',
  timezone: 'America/Chicago',
  groupNpi: '1234567893',
  federalTaxId: '12-3456789',
  ...o,
})

const issues = (v: PracticeFormValues) => {
  const r = practiceFormSchema.safeParse(v)
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'))
}

describe('practice details form', () => {
  it('accepts a complete practice', () => {
    expect(issues(valid())).toEqual([])
  })

  it('needs a group NPI unless "no NPI", and checks its check digit', () => {
    expect(issues(valid({ groupNpi: '' }))).toContain('groupNpi')
    expect(issues(valid({ groupNpi: '1234567890' }))).toContain('groupNpi')
    expect(issues(valid({ groupNpi: '', noNpi: true }))).toEqual([])
  })

  it('needs an EIN on the first save only', () => {
    expect(issues(valid({ federalTaxId: '' }))).toContain('federalTaxId')
    expect(issues(valid({ federalTaxId: '', hasTaxIdOnFile: true }))).toEqual([])
    expect(issues(valid({ federalTaxId: '00-1234567' }))).toContain('federalTaxId')
  })

  it('validates DEA, ZIP, state, DBA and a separate mailing address', () => {
    expect(issues(valid({ deaNumber: 'AB1234564' }))).toContain('deaNumber')
    expect(issues(valid({ postalCode: '7500' }))).toContain('postalCode')
    expect(issues(valid({ state: 'ZZ' }))).toContain('state')
    expect(issues(valid({ sameAsLegal: false, dbaName: '' }))).toContain('dbaName')
    expect(issues(valid({ mailingSameAsPrimary: false }))).toEqual(
      expect.arrayContaining([
        'mailingAddressLine1',
        'mailingCity',
        'mailingState',
        'mailingPostalCode',
      ])
    )
  })

  it('maps to the API body: blank tax ID / DEA are omitted (keep), remove sends null', () => {
    const body = toPracticePayload(valid({ federalTaxId: '', hasTaxIdOnFile: true, website: '' }))
    expect(body).not.toHaveProperty('federalTaxId')
    expect(body).not.toHaveProperty('deaNumber')
    expect(body.website).toBeNull()
    expect(body.dbaName).toBeNull()
    expect(toPracticePayload(valid({ removeDea: true, hasDeaOnFile: true })).deaNumber).toBeNull()
    expect(toPracticePayload(valid({ deaNumber: 'AB1234563' })).deaNumber).toBe('AB1234563')
    expect(toPracticePayload(valid({ noNpi: true })).groupNpi).toBeNull()
  })

  it('defaults from what is on file and never pre-fills the tax ID', () => {
    const app = {
      profile: {
        legalName: 'X LLC',
        dbaName: 'X',
        federalTaxIdMasked: '•••••6789',
        hasDeaNumber: true,
        practitioners: [],
      },
      location: { timezone: 'UTC', addressLine1: '1 St' },
    } as unknown as Application
    const d = practiceFormDefaults(app)
    expect(d).toMatchObject({
      legalName: 'X LLC',
      sameAsLegal: false,
      hasTaxIdOnFile: true,
      hasDeaOnFile: true,
      federalTaxId: '',
      timezone: 'America/New_York', // signup's UTC placeholder is not offered back
    })
  })
})

describe('practitioners', () => {
  const p = (o: Partial<ReturnType<typeof emptyPractitioner>> = {}) => ({
    ...emptyPractitioner(),
    name: 'Dr Olivia Owner',
    email: 'olivia@example.test',
    npi: '1234567893',
    isOwner: true,
    ...o,
  })

  it('accepts one owner with valid details', () => {
    expect(practitionersValid(validatePractitioners([p()], true))).toBe(true)
  })

  it('needs exactly one owner, unique emails and (with a group NPI) an NPI each', () => {
    expect(validatePractitioners([], true).list).toMatch(/at least one/)
    expect(validatePractitioners([p({ isOwner: false })], true).list).toMatch(/exactly one/)
    expect(validatePractitioners([p(), p({ isOwner: false })], true).rows[1]!.email).toMatch(
      /own email/
    )
    expect(validatePractitioners([p({ npi: '' })], true).rows[0]!.npi).toBe('NPI is required')
    expect(validatePractitioners([p({ npi: '' })], false).rows[0]!.npi).toBeUndefined()
    expect(validatePractitioners([p({ npi: '1234567890' })], false).rows[0]!.npi).toMatch(/valid/)
  })
})

it('a typed signature must match the printed name', () => {
  expect(signatureMatches('olivia  owner', 'Olivia Owner')).toBe(true)
  expect(signatureMatches('Someone Else', 'Olivia Owner')).toBe(false)
  expect(signatureMatches('', '')).toBe(false)
})
