/**
 * B5.4 — the API's shipping-address and Rx→Cart schemas. The shipping cases
 * are shared with the frontend (shared/validation-cases/commerce.json,
 * frontend/tests/unit/commerceSchemas.test.ts).
 */
import fs from 'fs'
import path from 'path'
import assert from 'node:assert/strict'
import {
  approveSessionSchema,
  createProductSchema,
  shippingAddressSchema,
} from '../validation/rxCartSchemas'

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
      assert.equal(shippingAddressSchema.safeParse(payload).success, true)
    }
  )
  it.each(cases.shippingAddress.invalid.map((c) => [c.case, c.payload] as const))(
    'rejects: %s',
    (_name, payload) => {
      assert.equal(shippingAddressSchema.safeParse(payload).success, false)
    }
  )
})

describe('approve body (B5.2)', () => {
  it('is optional, and a confirmation must be explicitly acknowledged', () => {
    assert.equal(approveSessionSchema.safeParse(undefined).success, true)
    assert.equal(approveSessionSchema.safeParse({}).success, true)
    const base = { proposalId: 'p1', confirmedLineIds: ['l1'] }
    assert.equal(
      approveSessionSchema.safeParse({ rxConfirmation: { ...base, acknowledged: true } }).success,
      true
    )
    assert.equal(
      approveSessionSchema.safeParse({ rxConfirmation: { ...base, acknowledged: false } }).success,
      false
    )
    assert.equal(approveSessionSchema.safeParse({ rxConfirmation: base }).success, false)
  })
})

describe('product catalog fields (B5.5)', () => {
  it('accepts a classification and aliases, rejects unknown classes and fields', () => {
    const ok = createProductSchema.safeParse({
      name: 'Tramadol',
      price: 9,
      fulfillmentClass: 'RX_SCHEDULED',
      aliases: ['ultram'],
    })
    assert.equal(ok.success, true)
    assert.equal(
      createProductSchema.safeParse({ name: 'X', price: 1, fulfillmentClass: 'CONTROLLED' })
        .success,
      false
    )
    assert.equal(
      createProductSchema.safeParse({ name: 'X', price: 1, clinicId: 'other' }).success,
      false
    )
  })
})
