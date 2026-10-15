'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { loginRedirect } from '@/lib/routeGuards'
import { LoadingSkeleton } from '@/components/ui-system'

/**
 * Minimal layout for the post-signup clinic onboarding wizard.
 * - No sidebar, no topbar (the wizard shell renders its own navigation)
 * - Only SUPER_ADMIN with a clinic + !onboardingCompletedAt can stay here.
 *   PATIENTs, PROVIDERs, and already-onboarded admins are redirected.
 * - Tenants who haven't accepted the agreement are redirected to /agreement
 *   before any other onboarding step is reachable.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isLoading, isAuthenticated } = useAuth()

  const isOnAgreement = pathname === '/agreement'

  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      router.replace(loginRedirect('/welcome'))
      return
    }
    if (!user) return

    if (user.role !== 'SUPER_ADMIN' || !user.clinicId) {
      router.replace('/dashboard')
      return
    }

    if (user.clinic?.tenant?.onboardingCompletedAt) {
      router.replace('/dashboard')
      return
    }

    // Gate: agreement must be on file before any other wizard step is reachable.
    const termsAccepted = Boolean(user.clinic?.tenant?.termsAcceptedAt)
    if (!termsAccepted && !isOnAgreement) {
      router.replace('/agreement')
      return
    }
    if (termsAccepted && isOnAgreement) {
      router.replace('/welcome')
      return
    }
  }, [user, isLoading, isAuthenticated, router, isOnAgreement])

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingSkeleton variant="avatar" count={1} />
      </div>
    )
  }

  if (user.role !== 'SUPER_ADMIN' || !user.clinicId || user.clinic?.tenant?.onboardingCompletedAt) {
    return null
  }

  const termsAccepted = Boolean(user.clinic?.tenant?.termsAcceptedAt)
  if (!termsAccepted && !isOnAgreement) return null
  if (termsAccepted && isOnAgreement) return null

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {children}
    </div>
  )
}
