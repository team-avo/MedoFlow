'use client'

/**
 * GlobalApiLoader — full-screen overlay shown while React Query is fetching
 * or mutating, or while the router is mid-navigation.
 *
 * Design: uses MedoflowLoader so all transient loading states in the app
 * share the same mark and animation. Debounced by 400ms so fast queries
 * never flash the overlay.
 */

import React, { Suspense, useEffect, useState } from 'react'
import { useIsFetching, useIsMutating } from '@tanstack/react-query'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { MedoflowLoader } from './MedoflowLoader'
import { isOnClinicSiteHost } from '@/lib/site/host'

function GlobalApiLoaderContent() {
  const isFetching = useIsFetching()
  const isMutating = useIsMutating()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [showApi, setShowApi] = useState(false)
  const [showNav, setShowNav] = useState(false)

  // Route-change pulse
  useEffect(() => {
    setShowNav(true)
    const t = setTimeout(() => setShowNav(false), 600)
    return () => clearTimeout(t)
  }, [pathname, searchParams])

  // Debounced API loader — hide instantly, reveal after 400ms of real work
  useEffect(() => {
    const active = isFetching > 0 || isMutating > 0
    let t: ReturnType<typeof setTimeout> | undefined
    if (active) {
      t = setTimeout(() => setShowApi(true), 400)
    } else {
      setShowApi(false)
    }
    return () => {
      if (t) clearTimeout(t)
    }
  }, [isFetching, isMutating])

  const visible = showApi || showNav
  // Clinic websites (Component 8) never show MedoFlow chrome to their visitors.
  if (!visible || pathname?.startsWith('/s/') || isOnClinicSiteHost()) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-5',
        'bg-white/85 backdrop-blur-md animate-in fade-in duration-300'
      )}
      role="status"
      aria-live="polite"
    >
      <MedoflowLoader size="xl" tone="brand" label="Loading" />
      <div className="text-center">
        <p className="mf-display text-[16px] text-navy">Medoflow</p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-ink-muted">
          {showNav ? 'Updating module' : 'Syncing'}
        </p>
      </div>
    </div>
  )
}

export function GlobalApiLoader() {
  return (
    <Suspense fallback={null}>
      <GlobalApiLoaderContent />
    </Suspense>
  )
}
