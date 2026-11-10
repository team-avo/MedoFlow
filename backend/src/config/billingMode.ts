/**
 * How clinic plans behave on this deployment (demo feedback WS4).
 *
 *   BILLING_MODE=trial (default)  a new clinic gets its chosen plan with a
 *                                 14-day trial. No card; nothing enforces the
 *                                 trial end yet (Stripe billing is B12.2).
 *   BILLING_MODE=demo             the hosted demo: the plan is stored for
 *                                 display only, the clinic is ACTIVE with no
 *                                 trial end, and every plan gets the top
 *                                 (ENTERPRISE) limits. Nothing expires,
 *                                 nothing is gated.
 *
 * The single place this is read, so the rest of the code asks a question
 * ("are plans enforced?") rather than parsing env.
 */
import type { TenantPlan, TenantStatus } from '@prisma/client'

export type BillingMode = 'trial' | 'demo'

export const TRIAL_DAYS = 14

export function billingMode(env: NodeJS.ProcessEnv = process.env): BillingMode {
  return env.BILLING_MODE?.trim().toLowerCase() === 'demo' ? 'demo' : 'trial'
}

export const isDemoBilling = (env: NodeJS.ProcessEnv = process.env) => billingMode(env) === 'demo'

/** Status and trial end for a clinic created now on `plan`. */
export function newTenantBilling(
  plan: TenantPlan,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env
): { plan: TenantPlan; status: TenantStatus; trialEndsAt: Date | null } {
  if (isDemoBilling(env)) return { plan, status: 'ACTIVE', trialEndsAt: null }
  const trialEndsAt = new Date(now)
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS)
  return { plan, status: 'TRIAL', trialEndsAt }
}

/** The plan whose limits apply: the clinic's own, or the top one in demo mode. */
export function effectivePlan(
  plan: TenantPlan | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): TenantPlan {
  if (isDemoBilling(env)) return 'ENTERPRISE'
  return plan ?? 'FREE'
}
