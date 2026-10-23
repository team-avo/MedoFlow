/**
 * Turning resolved links into hrefs for the current site base: "" on a
 * clinic's own host, "/s/<slug>" on the app host, or "" inside the builder
 * preview (where clicks are intercepted).
 */
import type { ResolvedLink } from './types'
import { withSiteBase } from './routes'

const ALLOWED = new Set(['https:', 'mailto:', 'tel:'])

/** https / mailto / tel only (mirror of the backend check). */
export function isSafeExternalHref(href: string): boolean {
  if (href.length > 2000 || /[\u0000- \u007f]/.test(href)) return false
  try {
    const url = new URL(href)
    if (!ALLOWED.has(url.protocol)) return false
    if (url.protocol === 'https:' && !url.hostname) return false
    return true
  } catch {
    return false
  }
}

/** Final href for a resolved link, or null when its target no longer exists. */
export function siteHref(base: string, link: ResolvedLink | null | undefined): string | null {
  if (!link) return null
  if (link.kind === 'external') return isSafeExternalHref(link.href) ? link.href : null
  const href = link.href
  if (!href) return null
  if (href.startsWith('#')) return href
  if (!href.startsWith('/')) return null
  return withSiteBase(base, href)
}

export const isExternalLink = (link: ResolvedLink | null | undefined) => link?.kind === 'external'
