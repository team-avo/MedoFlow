/**
 * Client route guards, as pure functions so every role × area rule is unit
 * tested (F0.4.2 b). Each returns the path to redirect to, or null when the
 * user may stay. The backend enforces the same boundaries on every API call;
 * these guards only decide what the UI renders.
 *
 * Protected layouts render nothing but a skeleton until auth has resolved
 * and the guard returns null (F0.2.4).
 */
import type { User } from '@/lib/types'

type GuardUser = Pick<User, 'role' | 'clinicId'> & {
  clinic?: {
    tenant?: {
      onboardingCompletedAt?: string | null
      onboardingStep?: number | null
      termsAcceptedAt?: string | null
    } | null
    clinicProfile?: {
      practiceCompletedAt?: string | null
      practitionersCompletedAt?: string | null
    } | null
  } | null
}

/**
 * Clinic onboarding is the practice application only: practice →
 * practitioners → agreement, in order. Signing the agreement finishes
 * onboarding (CTO-25): the owner lands on the Command Center, where branding,
 * locations, services, providers and the (optional) website are Quick setup
 * items. Nothing about the website gates the product.
 */
export const APPLICATION_PATHS = ['/practice', '/practitioners', '/agreement'] as const

/** The first application step still to do, or null when the agreement is signed. */
export function nextApplicationPath(user: GuardUser): (typeof APPLICATION_PATHS)[number] | null {
  const profile = user.clinic?.clinicProfile
  if (!profile?.practiceCompletedAt) return '/practice'
  if (!profile.practitionersCompletedAt) return '/practitioners'
  if (!user.clinic?.tenant?.termsAcceptedAt) return '/agreement'
  return null
}

/**
 * True once the owner is done with onboarding. A signed agreement counts even
 * where `onboardingCompletedAt` was never stamped, so a clinic left mid-way
 * through the old setup wizard is sent to the dashboard, not stranded.
 */
export function onboardingFinished(user: GuardUser): boolean {
  const tenant = user.clinic?.tenant
  return !!tenant?.onboardingCompletedAt || !!tenant?.termsAcceptedAt
}

/** Where an owner who hasn't finished onboarding should continue. */
export function onboardingResumePath(user: GuardUser): string {
  return nextApplicationPath(user) ?? '/dashboard'
}

/**
 * The (onboarding) area. Only a clinic owner who hasn't signed the agreement
 * may be here. Application steps can be revisited (to edit) up to the first
 * unfinished one; once the agreement is signed the whole area is closed and
 * the application is edited from /dashboard/clinic.
 */
export function onboardingRedirect(user: GuardUser | null, pathname: string): string | null {
  if (!user) return loginRedirect(pathname, '/practice')
  if (user.role !== 'SUPER_ADMIN' || !user.clinicId) return '/dashboard'
  if (onboardingFinished(user)) return '/dashboard'

  const next = nextApplicationPath(user) ?? '/agreement'
  const appIndex = APPLICATION_PATHS.indexOf(pathname as (typeof APPLICATION_PATHS)[number])
  const nextIndex = APPLICATION_PATHS.indexOf(next)
  if (appIndex === -1 || appIndex > nextIndex) return next
  return null
}

/**
 * Why the last session ended ('idle' | 'expired'), set by AuthProvider. Every
 * guard that bounces to sign-in carries it, so whichever redirect wins the
 * sign-in screen can say "you were signed out after inactivity".
 */
let sessionEndReason: 'idle' | 'expired' | null = null
export function setSessionEndReason(reason: 'idle' | 'expired' | null) {
  sessionEndReason = reason
}

export function loginRedirect(
  pathname: string | null | undefined,
  fallback = '/dashboard'
): string {
  const base = `/?auth=login&returnUrl=${encodeURIComponent(pathname || fallback)}`
  return sessionEndReason ? `${base}&reason=${sessionEndReason}` : base
}

const SUPER_ADMIN_ONLY_PREFIXES = [
  '/dashboard/admin',
  '/dashboard/providers',
  '/dashboard/services',
  '/dashboard/disciplines',
  '/dashboard/staff',
  '/dashboard/locations',
  '/dashboard/clinic',
]

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

/** True while a first-time SUPER_ADMIN must finish onboarding before seeing the dashboard. */
export function needsOnboarding(user: GuardUser, _pathname: string): boolean {
  return user.role === 'SUPER_ADMIN' && !!user.clinicId && !onboardingFinished(user)
}

/** /dashboard/**, staff, providers and clinic admins. */
export function dashboardRedirect(user: GuardUser | null, pathname: string): string | null {
  if (!user) return loginRedirect(pathname)
  // Patients live on /account/*.
  if (user.role === 'PATIENT') return '/account'
  if (needsOnboarding(user, pathname)) return onboardingResumePath(user)
  // An owner account without a clinic: create one.
  if (user.role === 'SUPER_ADMIN' && !user.clinicId) return '/get-started'

  const adminArea = SUPER_ADMIN_ONLY_PREFIXES.some((p) => matches(pathname, p))
  // SUPER_ADMIN and STAFF (custom roles) can open admin routes.
  if (adminArea && user.role !== 'SUPER_ADMIN' && user.role !== 'STAFF') return '/dashboard'

  if (
    matches(pathname, '/dashboard/front-desk') &&
    !['FRONT_DESK', 'SUPER_ADMIN', 'STAFF'].includes(user.role)
  ) {
    return '/dashboard'
  }
  // Website builder (Component 8): same roles the /site API allows:
  // editors are owners + marketing; enquiries (PHI) owners + front desk;
  // domains owners only.
  if (matches(pathname, '/dashboard/site')) {
    const allowed = matches(pathname, '/dashboard/site/leads')
      ? ['SUPER_ADMIN', 'FRONT_DESK']
      : matches(pathname, '/dashboard/site/domains')
        ? ['SUPER_ADMIN']
        : ['SUPER_ADMIN', 'MARKETING']
    if (!allowed.includes(user.role)) return '/dashboard'
  }
  return null
}

/** /account/**, the patient portal. */
export function accountRedirect(user: GuardUser | null, pathname: string): string | null {
  if (!user) return loginRedirect(pathname, '/account')
  if (user.role !== 'PATIENT') return '/dashboard'
  return null
}

/** /platform/**, MedoFlow operators only. */
export function platformRedirect(user: GuardUser | null): string | null {
  if (!user) return loginRedirect('/platform/clinics')
  if (user.role !== 'PLATFORM_ADMIN') return '/dashboard'
  return null
}
