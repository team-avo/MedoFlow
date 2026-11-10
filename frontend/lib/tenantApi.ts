/**
 * New-clinic sign-up and the plan catalogue (WS4): backend routes/tenants.ts.
 */
import api from './api'

export type TenantPlanKey = 'FREE' | 'STARTER' | 'GROWTH' | 'ENTERPRISE'

export interface PlanInfo {
  key: TenantPlanKey
  name: string
  /** USD per month; null = custom (talk to sales). */
  monthlyPrice: number | null
  tagline: string
  highlights: string[]
  selfServe: boolean
  recommended?: boolean
}

export interface PlanCatalog {
  plans: PlanInfo[]
  /** demo = plans are illustrative, everything unlocked, nothing expires. */
  billingMode: 'trial' | 'demo'
  trialDays: number
}

export const getPlans = async (): Promise<PlanCatalog> => {
  const { data } = await api.get<{ data: PlanCatalog }>('/tenants/plans')
  return data.data
}

export const checkSubdomain = async (subdomain: string): Promise<boolean> => {
  const { data } = await api.get<{ data: { available: boolean } }>('/tenants/check-subdomain', {
    params: { subdomain },
  })
  return data.data.available
}

export interface ClinicSignup {
  ownerName: string
  ownerEmail: string
  password: string
  clinicName: string
  clinicEmail: string
  subdomain: string
  plan: TenantPlanKey
}

export interface ClinicSignupResult {
  tenantId: string
  clinicId: string
  subdomain: string
  plan: TenantPlanKey
  status: string
  trialEndsAt: string | null
  siteUrl: string
}

export const signupClinic = async (body: ClinicSignup): Promise<ClinicSignupResult> => {
  const { data } = await api.post<{ data: ClinicSignupResult }>('/tenants/signup', body)
  return data.data
}

/** What a subdomain becomes once typed: lowercase letters, digits and inner hyphens. */
export function toSubdomain(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 63)
}

export const isValidSubdomain = (s: string) => /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(s)

/** "$149/mo", "Free", "Custom". */
export function priceLabel(p: Pick<PlanInfo, 'monthlyPrice'>): string {
  if (p.monthlyPrice === null) return 'Custom'
  if (p.monthlyPrice === 0) return 'Free'
  return `$${p.monthlyPrice}/mo`
}

/** Sales contact for Enterprise and "Book a demo" (NEXT_PUBLIC_SALES_EMAIL overrides). */
export const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL || 'sales@medoflow.com'
export const salesMailto = (subject: string) =>
  `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(subject)}`
