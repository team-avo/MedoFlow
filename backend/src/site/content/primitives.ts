/**
 * Building blocks every section and site setting is made of: typed links,
 * image references, colours and bounded text. Raw in-site URLs are never
 * stored — a link names its target (page, service, route…) and is resolved
 * to a path at render time, so renaming a slug never breaks a menu.
 */
import { z } from 'zod'
import { LINKABLE_ROUTES } from '../routing/routeKeys'

export const entityId = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid id')

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:', 'tel:'])

/** https / mailto / tel only. Blocks javascript:, data:, http: and relative paths. */
export function isSafeExternalHref(href: string): boolean {
  // Whitespace or control characters can smuggle "java\tscript:" past a parser.
  // eslint-disable-next-line no-control-regex
  if (href.length > 2000 || /[\u0000- \u007f]/.test(href)) return false
  try {
    const url = new URL(href)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) return false
    if (url.protocol === 'https:' && !url.hostname) return false
    return true
  } catch {
    return false
  }
}

export const externalHref = z
  .string()
  .max(2000)
  .refine(isSafeExternalHref, 'Links must start with https://, mailto: or tel:')

export const siteLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), pageId: entityId }).strict(),
  z.object({ kind: z.literal('route'), route: z.enum(LINKABLE_ROUTES) }).strict(),
  z.object({ kind: z.literal('service'), serviceId: entityId }).strict(),
  z.object({ kind: z.literal('provider'), providerId: entityId }).strict(),
  z.object({ kind: z.literal('product'), productId: entityId }).strict(),
  z.object({ kind: z.literal('booking'), serviceId: entityId.optional() }).strict(),
  z.object({ kind: z.literal('anchor'), sectionId: entityId }).strict(),
  z.object({ kind: z.literal('external'), href: externalHref }).strict(),
])
export type SiteLink = z.infer<typeof siteLinkSchema>

export const SITE_LINK_KINDS = new Set([
  'page',
  'route',
  'service',
  'provider',
  'product',
  'booking',
  'anchor',
  'external',
])

/** A labelled button / menu item. */
export const ctaSchema = z
  .object({ label: z.string().trim().min(1).max(40), link: siteLinkSchema })
  .strict()

/**
 * Bundled template artwork served by the frontend (never user uploads);
 * uploaded images are referenced by SiteAsset id.
 */
export const SAMPLE_IMAGE_RE = /^\/site-samples\/[a-z0-9-]+\.(svg|webp|jpg|png)$/

export const imageRefSchema = z
  .object({
    assetId: entityId.optional(),
    src: z.string().regex(SAMPLE_IMAGE_RE, 'Unknown sample image').optional(),
    alt: z.string().max(200).default(''),
  })
  .strict()
  .refine((v) => Boolean(v.assetId) !== Boolean(v.src), 'An image needs an upload or a sample')
export type ImageRef = z.infer<typeof imageRefSchema>

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours are #rrggbb')

export const shortText = (max = 160) => z.string().max(max).default('')
export const longText = (max = 2000) => z.string().max(max).default('')
/** Safe markdown subset (bold, italic, links, lists) — rendered without HTML. */
export const markdownText = (max = 10000) => z.string().max(max).default('')
