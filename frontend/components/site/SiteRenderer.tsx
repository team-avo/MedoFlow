'use client'

/**
 * Renders one clinic-site page from a render payload — the same component
 * for the live site (SSR), draft previews, the template gallery and the
 * builder canvas. Only `mode`, `base` and `actions` differ between them.
 */
import React from 'react'
import type { RenderPayload } from '@/lib/site/types'
import { themeStyle } from '@/lib/site/theme'
import { SiteContextProvider, noopActions, type SiteActions, type SiteMode } from './SiteContext'
import { SiteFooter, SiteHeader } from './SiteShell'
import { SectionList } from './sections'
import {
  BookView,
  NotFoundView,
  ProductView,
  ProviderView,
  ServiceView,
  StoreView,
} from './routeViews'

export interface SiteRendererProps {
  payload: RenderPayload
  base: string
  mode: SiteMode
  actions?: SiteActions
  /** Builder canvas only. */
  selectedId?: string | null
  onSelect?: (id: string) => void
  fontClassName?: string
}

function RouteBody({
  payload,
  selectedId,
  onSelect,
}: Pick<SiteRendererProps, 'payload' | 'selectedId' | 'onSelect'>) {
  const { route, page, entity } = payload
  if (page)
    return <SectionList sections={page.sections} selectedId={selectedId} onSelect={onSelect} />
  if (entity?.type === 'service') return <ServiceView service={entity.service} />
  if (entity?.type === 'provider') return <ProviderView provider={entity.provider} />
  if (entity?.type === 'product') return <ProductView product={entity.product} />
  if (route.key === 'store') return <StoreView />
  if (route.key === 'book') return <BookView />
  return <NotFoundView />
}

export function SiteRenderer({
  payload,
  base,
  mode,
  actions,
  selectedId,
  onSelect,
  fontClassName = '',
}: SiteRendererProps) {
  const settings = payload.site.settings
  const ctx = React.useMemo(
    () => ({
      base,
      mode,
      clinicId: payload.site.clinicId,
      clinicName: payload.site.name,
      legacyLogoUrl: payload.site.legacyLogoUrl,
      settings,
      data: payload.data,
      hasStore: payload.site.hasStore,
      currentPath: payload.route.path,
      actions: actions ?? noopActions,
    }),
    [base, mode, payload, settings, actions]
  )
  // In the builder and previews nothing navigates away from the canvas.
  const swallowClicks = (e: React.MouseEvent) => {
    if (mode !== 'editor') return
    const target = (e.target as HTMLElement).closest('a,button')
    if (target) e.preventDefault()
  }
  return (
    <SiteContextProvider value={ctx}>
      <div
        className={`mf-site ${fontClassName}`}
        style={themeStyle(settings.theme)}
        onClickCapture={swallowClicks}
      >
        {payload.preview && mode === 'preview' && (
          <div
            role="status"
            style={{
              background: '#111827',
              color: '#fff',
              textAlign: 'center',
              fontSize: '0.85rem',
              padding: '0.45rem',
            }}
          >
            Draft preview — visitors don’t see these changes until you publish.
          </div>
        )}
        <SiteHeader />
        <main id="main">
          <RouteBody payload={payload} selectedId={selectedId} onSelect={onSelect} />
        </main>
        <SiteFooter showBadge={payload.site.showBadge} />
      </div>
    </SiteContextProvider>
  )
}
