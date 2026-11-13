/** F0.4.2 (b): each role's route guard. */
import { describe, expect, it } from 'vitest'
import {
  accountRedirect,
  dashboardRedirect,
  onboardingRedirect,
  onboardingResumePath,
  platformRedirect,
} from '@/lib/routeGuards'
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
    // Component 8: website builder
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

  it('a first-time clinic admin is sent to onboarding; a clinic-less admin to sign up a clinic', () => {
    // Nothing done yet → the first application step.
    expect(dashboardRedirect(u('SUPER_ADMIN', { clinic: { tenant: {} } }), '/dashboard')).toBe(
      '/practice'
    )
    expect(dashboardRedirect(u('SUPER_ADMIN', { clinicId: null }), '/dashboard')).toBe(
      '/get-started'
    )
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

// ─── Clinic onboarding ──────────────────────────────────────────────────────

const done = '2026-11-01T00:00:00.000Z'
const owner = (
  profile: { practiceCompletedAt?: string | null; practitionersCompletedAt?: string | null } | null,
  tenant: Record<string, unknown> = {}
) => ({
  role: 'SUPER_ADMIN' as Role,
  clinicId: 'clinic-1',
  clinic: { tenant: { onboardingCompletedAt: null, ...tenant }, clinicProfile: profile },
})
const signed = owner(
  { practiceCompletedAt: done, practitionersCompletedAt: done },
  { termsAcceptedAt: done }
)

describe('onboarding guard', () => {
  it('only an un-onboarded clinic owner may be in onboarding', () => {
    expect(onboardingRedirect(null, '/practice')).toBe('/?auth=login&returnUrl=%2Fpractice')
    expect(onboardingRedirect(u('PROVIDER'), '/practice')).toBe('/dashboard')
    expect(onboardingRedirect(u('SUPER_ADMIN'), '/welcome')).toBe('/dashboard') // already onboarded
    expect(onboardingRedirect({ ...owner(null), clinicId: null }, '/practice')).toBe('/dashboard')
  })

  it.each<[string, ReturnType<typeof owner>, string, string | null]>([
    ['nothing done: practice is the only open step', owner(null), '/practice', null],
    ['nothing done: practitioners is locked', owner(null), '/practitioners', '/practice'],
    ['nothing done: agreement is locked', owner(null), '/agreement', '/practice'],
    ['nothing done: setup is locked', owner(null), '/welcome', '/practice'],
    [
      'practice done: back to practice is fine',
      owner({ practiceCompletedAt: done }),
      '/practice',
      null,
    ],
    [
      'practice done: practitioners open',
      owner({ practiceCompletedAt: done }),
      '/practitioners',
      null,
    ],
    [
      'practice done: agreement still locked',
      owner({ practiceCompletedAt: done }),
      '/agreement',
      '/practitioners',
    ],
    [
      'both done: agreement open',
      owner({ practiceCompletedAt: done, practitionersCompletedAt: done }),
      '/agreement',
      null,
    ],
    // CTO-25: signing finishes onboarding; the whole area is closed.
    ['signed: application closed', signed, '/agreement', '/dashboard'],
    ['signed: application closed (practice)', signed, '/practice', '/dashboard'],
    ['signed: old wizard steps closed', signed, '/brand', '/dashboard'],
    [
      'unsigned: an unknown onboarding path goes to the next step',
      owner(null),
      '/brand',
      '/practice',
    ],
  ])('%s', (_name, user, path, expected) => {
    expect(onboardingRedirect(user, path)).toBe(expected)
  })

  it('resumes the application, then goes straight to the dashboard', () => {
    expect(onboardingResumePath(owner(null))).toBe('/practice')
    expect(onboardingResumePath(signed)).toBe('/dashboard')
    // A signed clinic is never sent to onboarding again, whatever its old step.
    expect(dashboardRedirect(signed, '/dashboard')).toBeNull()
    // Existing clinics left mid-wizard (signed, onboardingCompletedAt unset).
    const midWizard = owner(
      { practiceCompletedAt: done, practitionersCompletedAt: done },
      { termsAcceptedAt: done, onboardingStep: 4, onboardingCompletedAt: null }
    )
    expect(dashboardRedirect(midWizard, '/dashboard/admin')).toBeNull()
    expect(onboardingRedirect(midWizard, '/services')).toBe('/dashboard')
    expect(dashboardRedirect(owner({ practiceCompletedAt: done }), '/dashboard')).toBe(
      '/practitioners'
    )
  })
})
