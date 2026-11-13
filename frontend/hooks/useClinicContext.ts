'use client'

/**
 * useClinicContext: when the current pathname is under /clinic/[idOrSlug]
 * (or /clinic/[idOrSlug]/store), returns the resolved clinic + themeColor.
 * Returns `null` everywhere else so callers can fall back to default chrome.
 *
 * Used by the auth modal, checkout page, and anywhere else that wants to
 * pick up the clinic accent without prop-drilling.
 */

import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getClinic } from '@/lib/clinicApi'
import type { Clinic } from '@/lib/types/booking'

const CLINIC_DEFAULT_THEME = '#0D9488'

export interface ClinicContextValue {
  clinic: Clinic | null
  /** Resolved theme color, falls back to teal default if the clinic hasn't set one. */
  themeColor: string
  /** Slug or cuid as it appears in the URL, useful for back links. */
  routeId: string
}

export function useClinicContext(): ClinicContextValue | null {
  const pathname = usePathname()
  const match = pathname?.match(/^\/clinic\/([^/?#]+)/)
  const idOrSlug = match?.[1] ?? null
  const { data } = useQuery({
    queryKey: ['clinic', idOrSlug],
    queryFn: () => getClinic(idOrSlug as string),
    enabled: !!idOrSlug,
  })
  if (!idOrSlug) return null
  return {
    clinic: data ?? null,
    themeColor: data?.themeColor?.trim() || CLINIC_DEFAULT_THEME,
    routeId: idOrSlug,
  }
}
