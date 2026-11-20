/**
 * CTO-40: product catalog import. Every source (a live store connection or an
 * uploaded file) is turned into the same NormalizedItem list, then staged,
 * previewed and applied by one pipeline.
 */

export const STORE_PROVIDERS = ['SHOPIFY', 'SQUARE', 'WOOCOMMERCE', 'WIX'] as const
export type StoreProvider = (typeof STORE_PROVIDERS)[number]

export const IMPORT_SOURCES = [...STORE_PROVIDERS, 'CSV'] as const
export type ImportSource = (typeof IMPORT_SOURCES)[number]

export const isStoreProvider = (v: unknown): v is StoreProvider =>
  typeof v === 'string' && (STORE_PROVIDERS as readonly string[]).includes(v)

/** One sellable item, as every adapter reports it. Variants are already flattened. */
export interface NormalizedItem {
  /** Stable id in the source (variant id when the product has variants). */
  externalId: string
  name: string
  sku: string | null
  /** Unit price in the store's currency, or null when the source has none. */
  price: number | null
  description: string | null
  /** An https image URL, or null. */
  imageUrl: string | null
  /** Units on hand, or null when the source does not track stock. */
  stock: number | null
  /** Product type or first category, used for the class suggestion. */
  category: string | null
  tags: string[]
}

export interface FetchPage {
  items: NormalizedItem[]
  /** Opaque cursor for the next page; absent on the last page. */
  next?: string
}

/** Most items one import may hold (a staging-table and preview limit). */
export const MAX_IMPORT_ITEMS = 5_000

export const MAX_NAME = 200
export const MAX_SKU = 64
export const MAX_DESCRIPTION = 2_000
export const MAX_PRICE = 1_000_000

/** A safe, short reason for a failure. Never carries tokens or response bodies. */
export class ImportSourceError extends Error {
  constructor(
    message: string,
    readonly code: string = 'source_error',
    readonly retryable = true
  ) {
    super(message)
    this.name = 'ImportSourceError'
  }
}

const TAG_RE = /<[^>]*>/g
const ENTITY: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

/** HTML product descriptions become plain text (the Storefront stores text). */
export function plainText(html: string | null | undefined): string | null {
  if (!html) return null
  const text = html
    .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, '\n')
    .replace(TAG_RE, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITY[m] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
  return text ? text.slice(0, MAX_DESCRIPTION) : null
}

/** Parses "12.50", "$12.50", "1,299.00" or a number; null when it is not a price. */
export function parsePrice(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? round2(v) : null
  if (typeof v !== 'string') return null
  const cleaned = v.replace(/[^0-9.,-]/g, '').trim()
  if (!cleaned) return null
  // "1.299,00" (comma decimals) vs "1,299.00".
  const normal =
    /,\d{1,2}$/.test(cleaned) && !/\.\d{1,2}$/.test(cleaned)
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '')
  const n = Number(normal)
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? round2(n) : null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Whole units on hand; null when blank or not a number. Negative stock counts as 0. */
export function parseStock(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'number' && typeof v !== 'string') return null
  const n = typeof v === 'number' ? v : Number(v.replace(/,/g, '').trim())
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(1_000_000, Math.floor(n)))
}

export const httpsOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!/^https:\/\//i.test(s) || s.length > 2_000) return null
  try {
    new URL(s)
    return s
  } catch {
    return null
  }
}

export const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

/** Name for a flattened variant: "Magnesium Glycinate - 120 capsules". */
export function variantName(product: string, variant: string | null | undefined): string {
  const v = (variant ?? '').trim()
  if (!v || /^default( title)?$/i.test(v) || v === product) return product
  return `${product} - ${v}`
}
