/**
 * Builder-canvas mirror of backend/src/site/content/resolve.ts: adds `href`
 * to typed links and `url` to image refs so the draft renders exactly as the
 * published page will. Drafts may link to unpublished pages, so every page
 * the clinic has counts as a target here.
 */
import type { ResolvedLink, SiteLink } from './types'
import { buildSitePath, trySitePath } from './routes'

export interface ClientTargets {
  pages: Map<string, string>
  services: Map<string, string>
  providers: Map<string, string>
  products: Map<string, string>
  assets: Map<string, { url: string; width: number | null; height: number | null }>
  hasStore: boolean
}

const LINK_KINDS = new Set([
  'page',
  'route',
  'service',
  'provider',
  'product',
  'booking',
  'anchor',
  'external',
])

export function hrefForClient(link: SiteLink, t: ClientTargets): string | null {
  switch (link.kind) {
    case 'external':
      return link.href
    case 'page':
      return t.pages.get(link.pageId) ?? null
    case 'route':
      return link.route === 'store' && !t.hasStore ? null : buildSitePath(link.route)
    case 'service': {
      const slug = t.services.get(link.serviceId)
      return slug ? trySitePath('service', { slug }) : null
    }
    case 'provider': {
      const slug = t.providers.get(link.providerId)
      return slug ? trySitePath('provider', { slug }) : null
    }
    case 'product': {
      const slug = t.products.get(link.productId)
      return slug ? trySitePath('product', { slug }) : null
    }
    case 'booking': {
      const slug = link.serviceId ? t.services.get(link.serviceId) : undefined
      return trySitePath('book', slug ? { slug } : {})
    }
    case 'anchor':
      return `#${link.sectionId}`
  }
}

export function resolveClient<T>(value: T, t: ClientTargets): T {
  const go = (v: unknown, depth: number): unknown => {
    if (depth > 12 || v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map((x) => go(x, depth + 1))
    const o = v as Record<string, unknown>
    if (typeof o.kind === 'string' && LINK_KINDS.has(o.kind) && !('settings' in o)) {
      const link = o as unknown as SiteLink
      return { ...link, href: hrefForClient(link, t) } as ResolvedLink
    }
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(o)) out[k] = go(x, depth + 1)
    if (typeof o.assetId === 'string') {
      const a = t.assets.get(o.assetId)
      out.url = a?.url ?? null
      out.width = a?.width ?? null
      out.height = a?.height ?? null
    } else if (typeof o.src === 'string' && 'alt' in o) {
      out.url = o.src
    }
    return out
  }
  return go(value, 0) as T
}

/** Links whose target is gone (for the builder's broken-link warning). */
export function brokenLinks(value: unknown, t: ClientTargets): SiteLink[] {
  const out: SiteLink[] = []
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || v === null || typeof v !== 'object') return
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1))
    const o = v as Record<string, unknown>
    if (typeof o.kind === 'string' && LINK_KINDS.has(o.kind) && !('settings' in o)) {
      if (hrefForClient(o as unknown as SiteLink, t) === null) out.push(o as unknown as SiteLink)
      return
    }
    Object.values(o).forEach((x) => walk(x, depth + 1))
  }
  walk(value, 0)
  return out
}
