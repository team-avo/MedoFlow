/** F0.4.2 (b) — each role's route guard. */
import { describe, expect, it } from 'vitest'
import { accountRedirect, dashboardRedirect, platformRedirect } from '@/lib/routeGuards'
import type { Role } from '@/lib/types'

const onboarded = { tenant: { onboardingCompletedAt: '2026-01-01T00:00:00.000Z' } }
const u = (role: Role, extra: Record<string, unknown> = {}) => ({
  role,
  clinicId: 'clinic-1',
  clinic: onboarded,
  ...extra,
})

describe('dashboard guard', () => {
  it('anonymous → sign-in with a return URL', () => {
    expect(dashboardRedirect(null, '/dashboard/patients')).toBe(
      '/?auth=login&returnUrl=%2Fdashboard%2Fpatients'
    )
  })

  it('patients never see /dashboard', () => {
    expect(dashboardRedirect(u('PATIENT'), '/dashboard')).toBe('/account')
    expect(dashboardRedirect(u('PATIENT'), '/dashboard/patients')).toBe('/account')
  })

  it.each<[Role, string, string | null]>([
    ['SUPER_ADMIN', '/dashboard/admin', null],
    ['SUPER_ADMIN', '/dashboard/staff', null],
    ['SUPER_ADMIN', '/dashboard/front-desk', null],
    ['STAFF', '/dashboard/providers', null],
    ['STAFF', '/dashboard/front-desk/pos', null],
    ['PROVIDER', '/dashboard', null],
    ['PROVIDER', '/dashboard/provider/calendar', null],
    ['PROVIDER', '/dashboard/admin', '/dashboard'],
    ['PROVIDER', '/dashboard/staff/new', '/dashboard'],
    ['PROVIDER', '/dashboard/front-desk', '/dashboard'],
    ['FRONT_DESK', '/dashboard/front-desk', null],
    ['FRONT_DESK', '/dashboard/services', '/dashboard'],
    ['ACCOUNTING', '/dashboard/front-desk', '/dashboard'],
    // Component 8 — website builder
    ['SUPER_ADMIN', '/dashboard/site/editor', null],
    ['MARKETING', '/dashboard/site/editor', null],
    ['MARKETING', '/dashboard/site/domains', '/dashboard'],
    ['MARKETING', '/dashboard/site/leads', '/dashboard'],
    ['FRONT_DESK', '/dashboard/site/leads', null],
    ['FRONT_DESK', '/dashboard/site', '/dashboard'],
    ['PROVIDER', '/dashboard/site/templates', '/dashboard'],
    ['SUPER_ADMIN', '/dashboard/site/domains', null],
    ['MARKETING', '/dashboard/locations', '/dashboard'],
  ])('%s on %s → %s', (role, path, expected) => {
    expect(dashboardRedirect(u(role), path)).toBe(expected)
  })

  it('a first-time clinic admin is sent to onboarding; a clinic-less admin to signup', () => {
    expect(dashboardRedirect(u('SUPER_ADMIN', { clinic: { tenant: {} } }), '/dashboard')).toBe(
      '/welcome'
    )
    expect(dashboardRedirect(u('SUPER_ADMIN', { clinicId: null }), '/dashboard')).toBe('/signup')
  })

  it('does not match look-alike prefixes', () => {
    expect(dashboardRedirect(u('PROVIDER'), '/dashboard/administration-help')).toBeNull()
  })
})

describe('patient portal guard', () => {
  it('anonymous → sign-in; staff → dashboard; patient stays', () => {
    expect(accountRedirect(null, '/account/billing')).toBe(
      '/?auth=login&returnUrl=%2Faccount%2Fbilling'
    )
    for (const role of [
      'SUPER_ADMIN',
      'PROVIDER',
      'FRONT_DESK',
      'STAFF',
      'PLATFORM_ADMIN',
    ] as Role[]) {
      expect(accountRedirect(u(role), '/account')).toBe('/dashboard')
    }
    expect(accountRedirect(u('PATIENT'), '/account')).toBeNull()
  })
})

describe('platform guard', () => {
  it('only platform admins', () => {
    expect(platformRedirect(null)).toMatch(/^\/\?auth=login/)
    expect(platformRedirect(u('SUPER_ADMIN'))).toBe('/dashboard')
    expect(platformRedirect(u('PATIENT'))).toBe('/dashboard')
    expect(platformRedirect(u('PLATFORM_ADMIN'))).toBeNull()
  })
})
