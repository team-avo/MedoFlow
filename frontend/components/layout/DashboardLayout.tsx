'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { AppSidebar } from './AppSidebar'
import { AppSidebarMobile } from './AppSidebarMobile'
import { TopBar } from './TopBar'
import { DashboardErrorBoundary, LoadingSkeleton } from '@/components/ui-system'
import { useTour } from '@/contexts/TourContext'
import { dashboardRedirect } from '@/lib/routeGuards'

export interface DashboardLayoutProps {
  children: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated, isLoading, user } = useAuth()
  const { start: startTour } = useTour()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Route guard (lib/routeGuards.ts, unit tested per role). Until auth has
  // resolved and the guard allows this user, nothing protected is rendered:
  // no page content flashes before the redirect (F0.2.4).
  const redirectTo = !isLoading ? dashboardRedirect(user, pathname || '/dashboard') : null

  useEffect(() => {
    if (!isLoading && redirectTo) router.replace(redirectTo)
  }, [isLoading, redirectTo, router])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingSkeleton variant="avatar" count={1} />
      </div>
    )
  }

  if (!isAuthenticated || !user || redirectTo) {
    return null
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Desktop fixed sidebar */}
      <div className="hidden md:block">
        <AppSidebar />
      </div>

      {/* Mobile drawer */}
      <AppSidebarMobile open={mobileNavOpen} onOpenChange={setMobileNavOpen} />

      <div className="relative md:ml-[264px]">
        <TopBar
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onRestartTour={() => startTour({ force: true })}
        />
        <main className="min-h-[calc(100vh-3.5rem)]">
          <DashboardErrorBoundary>{children}</DashboardErrorBoundary>
        </main>
      </div>
    </div>
  )
}
