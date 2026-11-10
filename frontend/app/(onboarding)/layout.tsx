'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { onboardingRedirect } from '@/lib/routeGuards'
import { LoadingSkeleton } from '@/components/ui-system'

/**
 * Minimal layout for clinic onboarding: the practice application
 * (/practice → /practitioners → /agreement) and then the setup wizard
 * (/welcome … /done). No sidebar or topbar — the step shells render their
 * own navigation. Who may be on which step is decided by the pure, unit-tested
 * `onboardingRedirect` (lib/routeGuards.ts).
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? '/welcome'
  const { user, isLoading, isAuthenticated } = useAuth()

  const target = isLoading ? null : onboardingRedirect(isAuthenticated ? user : null, pathname)

  useEffect(() => {
    if (isLoading) return
    if (isAuthenticated && !user) return
    if (target && target !== pathname) router.replace(target)
  }, [target, pathname, isLoading, isAuthenticated, user, router])

  if (isLoading || !user || target) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingSkeleton variant="avatar" count={1} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      {children}
    </div>
  )
}
