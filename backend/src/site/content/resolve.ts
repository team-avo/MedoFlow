/**
 * Render-time resolution of stored content (B8.5):
 *   SiteLink  → adds `href` (site-relative path, external URL, or null when
 *               the target no longer exists / isn't published)
 *   ImageRef  → adds `url` (+ width/height) for uploads; samples keep `src`
 * Stored content never contains resolved values, so a renamed page or a
 * deleted image can't leave a stale URL behind.
 */
import { buildSitePath } from '../routing/buildSitePath'
import { siteLinkSchema, type SiteLink } from './primitives'

export interface LinkTargets {
  pages: Map<string, string> // pageId → path (published pages only)
  services: Map<string, string> // serviceId → slug
  providers: Map<string, string>
  products: Map<string, string>
  hasStore: boolean
}

export interface AssetInfo {
  url: string
  width: number | null
  height: number | null
}

export function hrefFor(link: SiteLink, t: LinkTargets): string | null {
  switch (link.kind) {
    case 'external':
      return link.href
    case 'page':
      return t.pages.get(link.pageId) ?? null
    case 'route':
      if (link.route === 'store' && !t.hasStore) return null
      return buildSitePath(link.route)
    case 'service': {
      const slug = t.services.get(link.serviceId)
      return slug ? buildSitePath('service', { slug }) : null
    }
    case 'provider': {
      const slug = t.providers.get(link.providerId)
      return slug ? buildSitePath('provider', { slug }) : null
    }
    case 'product': {
      const slug = t.products.get(link.productId)
      return slug ? buildSitePath('product', { slug }) : null
    }
    case 'booking': {
      const slug = link.serviceId ? t.services.get(link.serviceId) : undefined
      return buildSitePath('book', slug ? { slug } : {})
    }
    case 'anchor':
      return `#${link.sectionId}`
  }
}

/** Every id a piece of content refers to, by kind (to fetch targets in bulk). */
export function collectRefs(value: unknown) {
  const refs = {
    pages: new Set<string>(),
    services: new Set<string>(),
    providers: new Set<string>(),
    products: new Set<string>(),
    assets: new Set<string>(),
  }
  walk(value, (o) => {
    if (typeof o.assetId === 'string') refs.assets.add(o.assetId)
    if (typeof o.ogImageAssetId === 'string') refs.assets.add(o.ogImageAssetId)
    if (typeof o.kind === 'string') {
      if (typeof o.pageId === 'string') refs.pages.add(o.pageId)
      if (typeof o.serviceId === 'string') refs.services.add(o.serviceId)
      if (typeof o.providerId === 'string') refs.providers.add(o.providerId)
      if (typeof o.productId === 'string') refs.products.add(o.productId)
    }
    for (const key of ['serviceIds', 'providerIds', 'productIds'] as const) {
      const arr = o[key]
      if (Array.isArray(arr)) {
        const set =
          key === 'serviceIds'
            ? refs.services
            : key === 'providerIds'
              ? refs.providers
              : refs.products
        for (const id of arr) if (typeof id === 'string') set.add(id)
      }
    }
  })
  return refs
}

function walk(value: unknown, visit: (o: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 12 || value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visit, depth + 1)
    return
  }
  const o = value as Record<string, unknown>
  visit(o)
  for (const v of Object.values(o)) walk(v, visit, depth + 1)
}

/** Deep copy with links and images resolved. */
export function resolveContent<T>(value: T, t: LinkTargets, assets: Map<string, AssetInfo>): T {
  const go = (v: unknown, depth: number): unknown => {
    if (depth > 12 || v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map((x) => go(x, depth + 1))
    const o = v as Record<string, unknown>
    if (typeof o.kind === 'string' && !('settings' in o)) {
      const link = siteLinkSchema.safeParse(o)
      if (link.success) return { ...link.data, href: hrefFor(link.data, t) }
    }
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(o)) out[k] = go(x, depth + 1)
    if (typeof o.assetId === 'string') {
      const a = assets.get(o.assetId)
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
