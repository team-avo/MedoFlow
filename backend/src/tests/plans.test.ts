/** CTO-12: AI Scribe is a base feature, never plan-gated. */
import { describe, expect, it } from 'vitest'
import { BASE_FEATURES, PLAN_FEATURES, PLANS, planIncludes } from '../config/plans'

const ALL_PLANS = ['FREE', 'STARTER', 'GROWTH', 'ENTERPRISE'] as const

describe('plan features', () => {
  it.each(ALL_PLANS.flatMap((plan) => (['trial', 'demo'] as const).map((mode) => [plan, mode])))(
    '%s in BILLING_MODE=%s includes AI Scribe',
    (plan, mode) => {
      expect(planIncludes(plan, 'aiScribe', { BILLING_MODE: mode })).toBe(true)
    }
  )

  it('every plan has every base feature (configuration, not code)', () => {
    for (const plan of ALL_PLANS) {
      for (const f of BASE_FEATURES) expect(PLAN_FEATURES[plan][f]).toBe(true)
    }
  })

  it('every plan card shows AI Scribe', () => {
    expect(PLANS.map((p) => p.key).sort()).toEqual([...ALL_PLANS].sort())
    for (const p of PLANS) {
      expect(
        p.highlights.some((h) => /AI Scribe/.test(h)),
        p.key
      ).toBe(true)
    }
  })
})
