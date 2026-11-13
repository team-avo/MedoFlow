/** CTO-29: reading NPPES answers and judging them per field (recorded responses). */
import { describe, expect, it } from 'vitest'
import { parseNppes, verdictFor } from '../services/npiRegistryService'
import {
  NPPES_DEACTIVATED,
  NPPES_INDIVIDUAL,
  NPPES_NOT_FOUND,
  NPPES_ORGANISATION,
} from './fixtures/nppes'

const at = new Date('2026-11-12T00:00:00.000Z')

describe('parseNppes', () => {
  it('an organisation is type 2 with its name, primary taxonomy and state', () => {
    expect(parseNppes('1234567893', NPPES_ORGANISATION, at)).toEqual({
      npi: '1234567893',
      status: 'FOUND',
      type: 2,
      name: 'SYNTHETIC WELLNESS PARTNERS LLC',
      taxonomy: 'Clinic/Center, Primary Care',
      state: 'TX',
      checkedAt: at.toISOString(),
    })
  })
  it('an individual is type 1', () => {
    expect(parseNppes('1987654328', NPPES_INDIVIDUAL, at)).toMatchObject({
      status: 'FOUND',
      type: 1,
      name: 'OLIVIA SYNTHETIC',
      taxonomy: 'Internal Medicine',
    })
  })
  it('not found and deactivated', () => {
    expect(parseNppes('1000000004', NPPES_NOT_FOUND, at).status).toBe('NOT_FOUND')
    expect(parseNppes('1334455668', NPPES_DEACTIVATED, at).status).toBe('DEACTIVATED')
  })
})

describe('verdictFor', () => {
  const org = parseNppes('1234567893', NPPES_ORGANISATION, at)
  const person = parseNppes('1987654328', NPPES_INDIVIDUAL, at)
  it('the group NPI must be type 2; a practitioner NPI type 1', () => {
    expect(verdictFor(org, 2)).toBe('OK')
    expect(verdictFor(person, 2)).toBe('WRONG_TYPE')
    expect(verdictFor(person, 1)).toBe('OK')
    expect(verdictFor(org, 1)).toBe('WRONG_TYPE')
  })
  it('an unreachable registry (or lookups off) is unverified, never a failure', () => {
    expect(verdictFor(null, 2)).toBe('UNVERIFIED')
    expect(verdictFor({ ...org, status: 'UNAVAILABLE' }, 2)).toBe('UNVERIFIED')
  })
})
