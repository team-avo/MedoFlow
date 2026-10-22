/**
 * F5.3 — Zod parity with the backend for the shipping address. The shared
 * cases (shared/validation-cases/commerce.json) also run in
 * backend/src/tests/commerceValidation.test.ts against the API's schema.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { shippingAddressSchema } from '@/lib/schemas/commerce'

interface Case {
  case: string
  payload: Record<string, unknown>
}

const cases = JSON.parse(
  fs
    .readFileSync(path.resolve(__dirname, '../../../shared/validation-cases/commerce.json'), 'utf8')
    .replace('"@@LONG_201@@"', JSON.stringify('x'.repeat(201)))
) as { shippingAddress: { valid: Case[]; invalid: Case[] } }

describe('shipping address (shared cases)', () => {
  it.each(cases.shippingAddress.valid.map((c) => [c.case, c.payload] as const))(
    'accepts: %s',
    (_name, payload) => {
      expect(shippingAddressSchema.safeParse(payload).success).toBe(true)
    }
  )
  it.each(cases.shippingAddress.invalid.map((c) => [c.case, c.payload] as const))(
    'rejects: %s',
    (_name, payload) => {
      expect(shippingAddressSchema.safeParse(payload).success).toBe(false)
    }
  )
  it('upper-cases the country code', () => {
    const parsed = shippingAddressSchema.parse(cases.shippingAddress.valid[1]!.payload)
    expect(parsed.country).toBe('GB')
  })
})
