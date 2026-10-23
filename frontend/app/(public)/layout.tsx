'use client'

/**
 * Public shell.
 *
 * Renders the marketing nav, the page content, and the marketing footer.
 * Auth gating for patient-only routes (store, book, checkout, etc.) happens
 * here so the nav and footer can stay presentational.
 */

import React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LoadingSkeleton } from '@/components/ui-system'
import { useAuth } from '@/contexts/AuthContext'
import { loginRedirect } from '@/lib/routeGuards'
import { PublicNav } from '@/components/layout/PublicNav'
import { PublicFooter } from '@/components/layout/PublicFooter'
import { AuthModalProvider } from '@/components/auth/AuthModal'
import { CartModalProvider } from '@/components/store/CartModal'
import { CartProvider } from '@/hooks/useCart'
import { ProductDetailProvider } from '@/components/store/ProductDetailModal'
import { BookingModalProvider } from '@/components/booking/BookingModal'
import { MedoflowFullScreen } from '@/components/common/MedoflowLoader'

// Routes within (public) that require authentication.
// `/book` is intentionally NOT here — the clinic page handles its own
// patient auth via the in-page modal so we never bounce a clinic visitor
// to the Medoflow marketing site.
const GATED_PREFIXES = ['/store', '/checkout', '/payment', '/intake', '/account']

function isGatedPath(pathname: string | null): boolean {
  if (!pathname) return false
  return GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

// On any clinic-owned route the visitor is a patient — they should never
// see the Medoflow marketing chrome (nav + footer).
//
// /checkout is shared between Medoflow and clinic flows, so it's only
// considered "clinic" when the cart drawer carried a `?clinic=<slug>`
// param through to it (see CartModal#goToCheckout).
function isClinicSite(pathname: string | null, search: URLSearchParams | null): boolean {
  if (!pathname) return false
  if (pathname.startsWith('/clinic/') || pathname.startsWith('/book/')) return true
  if (pathname === '/checkout' && search?.get('clinic')) return true
  return false
}

// useSearchParams needs a Suspense boundary for static rendering; the root
// app/loading.tsx used to provide it (moved per area for Component 8).
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<MedoflowFullScreen subtitle="Loading clinical OS" />}>
      <PublicLayoutInner>{children}</PublicLayoutInner>
    </React.Suspense>
  )
}

function PublicLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated, isLoading } = useAuth()

  // Auth gate for patient-only routes inside the public shell.
  React.useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated && isGatedPath(pathname)) {
      router.replace(loginRedirect(pathname, '/'))
    }
  }, [isLoading, isAuthenticated, pathname, router])

  const needsAuthRedirect = !isLoading && !isAuthenticated && isGatedPath(pathname)
  const isLanding = pathname === '/'
  const searchParams = useSearchParams()
  const onClinicSite = isClinicSite(pathname, searchParams)

  return (
    <AuthModalProvider>
      <CartProvider>
        <CartModalProvider>
          <ProductDetailProvider>
            <BookingModalProvider>
              <div className="min-h-screen bg-canvas">
                {/* Hide Medoflow chrome on clinic-owned URLs — patient never
                  sees the marketing brand. The clinic page renders its
                  own themed header + footer. */}
                {!onClinicSite && <PublicNav />}
                <main className={isLanding || onClinicSite ? '' : 'pt-16 md:pt-18'}>
                  {needsAuthRedirect ? (
                    <div className="mx-auto max-w-md px-4 py-20">
                      <LoadingSkeleton variant="card" />
                    </div>
                  ) : (
                    children
                  )}
                </main>
                {!onClinicSite && <PublicFooter />}
              </div>
            </BookingModalProvider>
          </ProductDetailProvider>
        </CartModalProvider>
      </CartProvider>
    </AuthModalProvider>
  )
}
