'use client'

/**
 * TopProgressBar — a thin, non-blocking progress line at the top of the
 * viewport. Replaces the old full-screen GlobalApiLoader overlay.
 *
 * Shown while:
 *   • a navigation is in flight (a same-origin link was clicked and the
 *     pathname / search params have not changed yet), or
 *   • a query is loading for the first time (no data on screen yet), or
 *   • a mutation is running.
 * Background refetches of data already on screen stay silent. Revealed only
 * after 150ms so fast calls never flash, and it never intercepts input.
 */

import React, { Suspense, useEffect, useRef, useState } from 'react'
import { useIsFetching, useIsMutating } from '@tanstack/react-query'
import { usePathname, useSearchParams } from 'next/navigation'
import { isOnClinicSiteHost } from '@/lib/site/host'

const REVEAL_DELAY_MS = 150
// A navigation that never lands (blocked, cancelled) must not leave the bar up.
const NAV_TIMEOUT_MS = 8000

/** True for a plain left-click on a same-origin link that changes the page. */
function isInternalNavigationClick(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0) return false
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  const anchor = (e.target as Element | null)?.closest?.('a')
  if (!anchor || !anchor.href) return false
  if (anchor.target && anchor.target !== '_self') return false
  if (anchor.hasAttribute('download')) return false
  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin) return false
  return url.pathname !== window.location.pathname || url.search !== window.location.search
}

function TopProgressBarContent() {
  const pathname = usePathname()
  // Compared by value: the route only "landed" when the URL actually changed.
  const search = useSearchParams()?.toString() ?? ''
  const firstLoads = useIsFetching({ predicate: (q) => q.state.data === undefined })
  const mutations = useIsMutating()
  const [navigating, setNavigating] = useState(false)
  const [visible, setVisible] = useState(false)
  const navTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!isInternalNavigationClick(e)) return
      setNavigating(true)
      clearTimeout(navTimer.current)
      navTimer.current = setTimeout(() => setNavigating(false), NAV_TIMEOUT_MS)
    }
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      clearTimeout(navTimer.current)
    }
  }, [])

  // The route landed.
  useEffect(() => {
    setNavigating(false)
    clearTimeout(navTimer.current)
  }, [pathname, search])

  const active = navigating || firstLoads > 0 || mutations > 0
  useEffect(() => {
    if (!active) {
      setVisible(false)
      return
    }
    const t = setTimeout(() => setVisible(true), REVEAL_DELAY_MS)
    return () => clearTimeout(t)
  }, [active])

  // Clinic websites (Component 8) never show MedoFlow chrome to their visitors.
  if (!visible || pathname?.startsWith('/s/') || isOnClinicSiteHost()) return null

  return (
    <div
      role="progressbar"
      aria-label="Loading"
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-0.5 overflow-hidden bg-teal-600/15"
      data-testid="top-progress-bar"
    >
      <div className="mf-progress-indeterminate h-full w-1/3 bg-teal-600" />
    </div>
  )
}

export function TopProgressBar() {
  return (
    <Suspense fallback={null}>
      <TopProgressBarContent />
    </Suspense>
  )
}
