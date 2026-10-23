'use client'

/**
 * Render context for clinic-site components: the site base for links, the
 * live data sections pull from, and the commerce/auth actions. The live
 * site, the draft preview and the builder canvas each provide their own
 * actions, so section code never depends on which one it is in.
 */
import React from 'react'
import type { SectionData, SiteSettings } from '@/lib/site/types'

export type SiteMode = 'live' | 'preview' | 'editor'

export interface CartableItem {
  id: string
  name: string
  price: number
}

export interface SiteActions {
  addToCart: (item: CartableItem, type: 'PRODUCT' | 'PACKAGE' | 'MEMBERSHIP') => void
  openCart: () => void
  openLogin: () => void
  cartCount: number
  signedIn: boolean
}

export interface SiteRenderContext {
  base: string
  mode: SiteMode
  clinicId: string
  clinicName: string
  /** Logo from onboarding / the first builder, until a site logo is uploaded. */
  legacyLogoUrl: string | null
  settings: SiteSettings
  data: SectionData
  hasStore: boolean
  currentPath: string
  actions: SiteActions
}

export const noopActions: SiteActions = {
  addToCart: () => undefined,
  openCart: () => undefined,
  openLogin: () => undefined,
  cartCount: 0,
  signedIn: false,
}

const Ctx = React.createContext<SiteRenderContext | null>(null)

export function SiteContextProvider({
  value,
  children,
}: {
  value: SiteRenderContext
  children: React.ReactNode
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSite(): SiteRenderContext {
  const v = React.useContext(Ctx)
  if (!v) throw new Error('useSite must be used inside <SiteContextProvider>')
  return v
}
