/** Demo feedback WS4: BILLING_MODE: trial by default; demo = nothing expires, nothing gated. */
import { describe, expect, it } from 'vitest'
import { billingMode, effectivePlan, newTenantBilling } from '../config/billingMode'

describe('billingMode', () => {
  it('is trial unless set to demo (case and spaces ignored)', () => {
    expect(billingMode({})).toBe('trial')
    expect(billingMode({ BILLING_MODE: 'nonsense' })).toBe('trial')
    expect(billingMode({ BILLING_MODE: ' Demo ' })).toBe('demo')
  })

  it('trial: the chosen plan, TRIAL, ending 14 days later', () => {
    const now = new Date('2026-11-04T10:00:00.000Z')
    expect(newTenantBilling('STARTER', now, {})).toEqual({
      plan: 'STARTER',
      status: 'TRIAL',
      trialEndsAt: new Date('2026-11-18T10:00:00.000Z'),
    })
    expect(effectivePlan('STARTER', {})).toBe('STARTER')
    expect(effectivePlan(null, {})).toBe('FREE')
  })

  it('demo: the plan is kept for display, ACTIVE with no end, top limits for everyone', () => {
    const env = { BILLING_MODE: 'demo' }
    expect(newTenantBilling('FREE', new Date(), env)).toEqual({
      plan: 'FREE',
      status: 'ACTIVE',
      trialEndsAt: null,
    })
    expect(effectivePlan('FREE', env)).toBe('ENTERPRISE')
    expect(effectivePlan(undefined, env)).toBe('ENTERPRISE')
  })
})
