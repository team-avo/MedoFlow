/**
 * The clinic plans shown on the pricing page and at sign-up (WS4). Display
 * only: there is no billing yet (Stripe subscriptions are B12.2). Limits come
 * from the website entitlements, the one place plans gate anything today.
 *
 * Prices are placeholders for the marketing page; change them here.
 */
import type { TenantPlan } from '@prisma/client'
import { SITE_ENTITLEMENTS } from '../site/entitlements'
import { TRIAL_DAYS, billingMode, effectivePlan, type BillingMode } from './billingMode'

/**
 * Product features per plan (CTO-12), as configuration so the plan-gated
 * entitlements engine (B12.3) reads it rather than code. AI Scribe is the
 * core of MedoFlow, not a premium extra: it is in every plan and must never
 * be gated by the plan (nor by having a website, CTO-23).
 */
export type PlanFeature = 'aiScribe' | 'appointments' | 'storefront'

export const BASE_FEATURES: readonly PlanFeature[] = ['aiScribe', 'appointments', 'storefront']

export const PLAN_FEATURES: Record<TenantPlan, Record<PlanFeature, boolean>> = {
  FREE: { aiScribe: true, appointments: true, storefront: true },
  STARTER: { aiScribe: true, appointments: true, storefront: true },
  GROWTH: { aiScribe: true, appointments: true, storefront: true },
  ENTERPRISE: { aiScribe: true, appointments: true, storefront: true },
}

/** Whether a clinic on `plan` has `feature`, after BILLING_MODE (demo = top plan). */
export function planIncludes(
  plan: TenantPlan,
  feature: PlanFeature,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return PLAN_FEATURES[effectivePlan(plan, env)][feature]
}

/** Shown first on every plan card: the features no plan is without. */
const BASE_HIGHLIGHT = 'AI Scribe, included in every plan'

export interface PlanInfo {
  key: TenantPlan
  name: string
  /** Monthly price in USD; null = talk to sales. */
  monthlyPrice: number | null
  tagline: string
  highlights: string[]
  /** Can be chosen at self-serve sign-up (Enterprise goes through sales). */
  selfServe: boolean
  recommended?: boolean
}

const site = (plan: TenantPlan) => {
  const e = SITE_ENTITLEMENTS[plan]
  return [
    `Clinic website with up to ${e.maxPages} pages`,
    e.maxCustomDomains === 0
      ? 'Free <clinic>.medoflow subdomain'
      : `${e.maxCustomDomains} custom domain${e.maxCustomDomains > 1 ? 's' : ''}`,
    e.canRemoveBadge ? 'Remove the “Powered by MedoFlow” badge' : '“Powered by MedoFlow” badge',
  ]
}

export const PLANS: readonly PlanInfo[] = [
  {
    key: 'FREE',
    name: 'Free',
    monthlyPrice: 0,
    tagline: 'Try MedoFlow with a solo practice.',
    highlights: [
      BASE_HIGHLIGHT,
      'Online booking & reminders',
      'Patient records & intake forms',
      ...site('FREE'),
    ],
    selfServe: true,
  },
  {
    key: 'STARTER',
    name: 'Starter',
    monthlyPrice: 49,
    tagline: 'For a small clinic getting started online.',
    highlights: [BASE_HIGHLIGHT, 'Everything in Free', 'Payments & packages', ...site('STARTER')],
    selfServe: true,
  },
  {
    key: 'GROWTH',
    name: 'Growth',
    monthlyPrice: 149,
    tagline: 'For growing, multi-provider clinics.',
    highlights: [
      BASE_HIGHLIGHT,
      'Everything in Starter',
      'Video consultations',
      'Product & medicine store',
      ...site('GROWTH'),
    ],
    selfServe: true,
    recommended: true,
  },
  {
    key: 'ENTERPRISE',
    name: 'Enterprise',
    monthlyPrice: null,
    tagline: 'For groups and multi-location brands.',
    highlights: [
      BASE_HIGHLIGHT,
      'Everything in Growth',
      'Dedicated onboarding',
      'BAA & security review',
      ...site('ENTERPRISE'),
    ],
    selfServe: false,
  },
]

export const SELF_SERVE_PLANS = PLANS.filter((p) => p.selfServe).map((p) => p.key) as [
  TenantPlan,
  ...TenantPlan[],
]

export function planCatalog(env: NodeJS.ProcessEnv = process.env): {
  plans: readonly PlanInfo[]
  billingMode: BillingMode
  trialDays: number
} {
  return { plans: PLANS, billingMode: billingMode(env), trialDays: TRIAL_DAYS }
}
