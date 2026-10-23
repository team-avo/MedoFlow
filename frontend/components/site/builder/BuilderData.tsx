'use client'

/**
 * Data every builder screen shares: the site (draft settings, pages, URLs,
 * entitlements) and the editor data (live clinic data for previews and
 * pickers, images). Cached with react-query; mutations invalidate it.
 */
import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import type { PageKind, SectionData } from '@/lib/site/types'
import { siteApi } from '@/lib/site/siteApi'
import type { ClientTargets } from '@/lib/site/resolveClient'

export interface EditorData {
  data: SectionData
  pages: {
    id: string
    kind: PageKind
    slug: string
    title: string
    status: 'DRAFT' | 'PUBLISHED'
    path: string
  }[]
  assets: { id: string; url: string; alt: string; width: number | null; height: number | null }[]
  clinic: { name: string; legacyLogoUrl: string | null } | null
  hasStore: boolean
  showBadge: boolean
}

export const SITE_KEY = ['site', 'overview'] as const
export const EDITOR_DATA_KEY = ['site', 'editor-data'] as const

export function useSiteOverview() {
  return useQuery({ queryKey: SITE_KEY, queryFn: siteApi.getSite })
}

export function useEditorData() {
  return useQuery({
    queryKey: EDITOR_DATA_KEY,
    queryFn: () => api.get('/site/editor-data').then((r) => r.data.data as EditorData),
  })
}

export function useInvalidateSite() {
  const qc = useQueryClient()
  return React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['site'] })
  }, [qc])
}

export function targetsFrom(ed: EditorData | undefined): ClientTargets {
  return {
    pages: new Map((ed?.pages ?? []).map((p) => [p.id, p.path])),
    services: new Map((ed?.data.services ?? []).filter((s) => s.slug).map((s) => [s.id, s.slug!])),
    providers: new Map(
      (ed?.data.providers ?? []).filter((p) => p.slug).map((p) => [p.id, p.slug!])
    ),
    products: new Map((ed?.data.products ?? []).filter((p) => p.slug).map((p) => [p.id, p.slug!])),
    assets: new Map(
      (ed?.assets ?? []).map((a) => [a.id, { url: a.url, width: a.width, height: a.height }])
    ),
    hasStore: ed?.hasStore ?? false,
  }
}
