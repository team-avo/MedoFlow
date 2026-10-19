/**
 * Rx→Cart mapping layer (B5.1).
 *
 * Turns the orders the AI scribe heard in a visit into lines against the
 * clinic's own SKU catalog. Every input order produces exactly one output
 * line — an order that cannot be matched with confidence is kept as
 * UNMAPPED / AMBIGUOUS and routed to MANUAL so the provider sees it. Nothing
 * is ever dropped silently.
 *
 * Routing (B5.5): only supplements, OTC and aesthetic products may reach the
 * frictionless cart. Anything classified as a prescription product goes to
 * the e-prescribe path, never the cart.
 */
import type { ProductFulfillmentClass, RxMatchStatus, RxRoute } from '@prisma/client'
import prisma from '../config/prisma'

/** One order as the scribe extracted it. */
export interface ScribeOrder {
  name: string
  quantity?: number
}

/** The catalog facts the mapper needs. */
export interface CatalogProduct {
  id: string
  name: string
  sku: string | null
  aliases: string[]
  fulfillmentClass: ProductFulfillmentClass
}

export interface MappedLine {
  rawText: string
  quantity: number
  matchedProductId: string | null
  matchStatus: RxMatchStatus
  route: RxRoute
  /** Product ids that tied, for AMBIGUOUS lines. */
  candidateIds: string[]
}

export const MAX_ORDERS = 25
const MAX_ORDER_TEXT = 300
const MAX_QUANTITY = 99
const FUZZY_THRESHOLD = 0.6

/** Prescription classes never go to the cart. */
export const isPrescriptionClass = (cls: ProductFulfillmentClass): boolean =>
  cls === 'RX_SCHEDULED' || cls === 'RX_NON_SCHEDULED'

export const routeFor = (cls: ProductFulfillmentClass): RxRoute =>
  isPrescriptionClass(cls) ? 'EPRESCRIBE' : 'CART'

export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// Dose, unit and frequency words carry no product identity.
const NOISE = new Set([
  'mg',
  'mcg',
  'g',
  'ml',
  'iu',
  'tab',
  'tabs',
  'tablet',
  'tablets',
  'cap',
  'caps',
  'capsule',
  'capsules',
  'daily',
  'twice',
  'once',
  'a',
  'an',
  'the',
  'of',
  'per',
  'day',
  'take',
  'bid',
  'tid',
  'qd',
  'prn',
  'x',
])

const tokens = (text: string): Set<string> =>
  new Set(
    normalize(text)
      .split(' ')
      .filter((t) => t && !NOISE.has(t) && !/^\d+(mg|mcg|g|ml|iu)?$/.test(t))
  )

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared += 1
  return shared / (a.size + b.size - shared)
}

const containsPhrase = (haystack: string, phrase: string): boolean =>
  phrase.length > 0 && ` ${haystack} `.includes(` ${phrase} `)

const clampQuantity = (q: unknown): number => {
  const n =
    typeof q === 'number' ? Math.floor(q) : typeof q === 'string' ? Number.parseInt(q, 10) : NaN
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, MAX_QUANTITY)
}

/**
 * Accepts whatever shape the LLM produced — an array of strings, or of
 * objects with name/product/item and quantity/qty — and returns clean orders.
 * Blank entries are not orders; everything else is kept.
 */
export function parseScribeOrders(value: unknown): ScribeOrder[] {
  if (!Array.isArray(value)) return []
  const out: ScribeOrder[] = []
  for (const entry of value) {
    let name = ''
    let quantity: unknown
    if (typeof entry === 'string') {
      name = entry
    } else if (entry && typeof entry === 'object') {
      const rec = entry as Record<string, unknown>
      const raw = rec.name ?? rec.product ?? rec.item ?? rec.medication ?? ''
      name = typeof raw === 'string' ? raw : ''
      quantity = rec.quantity ?? rec.qty
    }
    name = name.trim().slice(0, MAX_ORDER_TEXT)
    if (!name) continue
    out.push({ name, quantity: clampQuantity(quantity) })
    if (out.length >= MAX_ORDERS) break
  }
  return out
}

/** Picks the single best product, or reports a tie. */
const pick = (
  ids: string[]
): { id: string | null; status: RxMatchStatus; candidates: string[] } | null => {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return null
  if (unique.length === 1) return { id: unique[0]!, status: 'MATCHED', candidates: unique }
  return { id: null, status: 'AMBIGUOUS', candidates: unique }
}

function matchOne(
  order: ScribeOrder,
  catalog: CatalogProduct[]
): { id: string | null; status: RxMatchStatus; candidates: string[] } {
  const text = normalize(order.name)

  // 1. SKU named in the order.
  const bySku = pick(
    catalog.filter((p) => p.sku && containsPhrase(text, normalize(p.sku))).map((p) => p.id)
  )
  if (bySku) return bySku

  const names = (p: CatalogProduct) => [p.name, ...p.aliases].map(normalize).filter(Boolean)

  // 2. Exact name or alias.
  const exact = pick(catalog.filter((p) => names(p).includes(text)).map((p) => p.id))
  if (exact) return exact

  // 3. The order mentions a product name or alias ("magnesium glycinate 400mg nightly").
  //    The longest mention wins; equally long mentions of different products tie.
  let best = 0
  let mentioned: string[] = []
  for (const p of catalog) {
    for (const n of names(p)) {
      if (!containsPhrase(text, n)) continue
      if (n.length > best) {
        best = n.length
        mentioned = [p.id]
      } else if (n.length === best) {
        mentioned.push(p.id)
      }
    }
  }
  const byMention = pick(mentioned)
  if (byMention) return byMention

  // 4. The order is a shortened product name ("omega 3" → "Omega 3 Softgels").
  if (text.length >= 4) {
    const byPrefix = pick(
      catalog.filter((p) => names(p).some((n) => containsPhrase(n, text))).map((p) => p.id)
    )
    if (byPrefix) return byPrefix
  }

  // 5. Token overlap, for word-order and small wording differences.
  const orderTokens = tokens(order.name)
  let bestScore = 0
  let fuzzy: string[] = []
  for (const p of catalog) {
    const score = Math.max(...names(p).map((n) => jaccard(orderTokens, tokens(n))))
    if (score < FUZZY_THRESHOLD) continue
    if (score > bestScore) {
      bestScore = score
      fuzzy = [p.id]
    } else if (score === bestScore) {
      fuzzy.push(p.id)
    }
  }
  return pick(fuzzy) ?? { id: null, status: 'UNMAPPED', candidates: [] }
}

/** Pure mapping: one line per order, in order. */
export function mapOrders(orders: ScribeOrder[], catalog: CatalogProduct[]): MappedLine[] {
  const byId = new Map(catalog.map((p) => [p.id, p]))
  return orders.map((order) => {
    const m = matchOne(order, catalog)
    const product = m.id ? byId.get(m.id) : undefined
    return {
      rawText: order.name.trim().slice(0, MAX_ORDER_TEXT),
      quantity: clampQuantity(order.quantity),
      matchedProductId: product?.id ?? null,
      matchStatus: m.status,
      route: product ? routeFor(product.fulfillmentClass) : 'MANUAL',
      candidateIds: m.candidates,
    }
  })
}

/** Loads the clinic's active catalog. */
export const loadCatalog = (clinicId: string): Promise<CatalogProduct[]> =>
  prisma.product.findMany({
    where: { clinicId, isActive: true },
    select: { id: true, name: true, sku: true, aliases: true, fulfillmentClass: true },
  })

/** Maps scribe orders against one clinic's catalog. */
export async function mapOrdersToCatalog(
  clinicId: string,
  orders: ScribeOrder[]
): Promise<MappedLine[]> {
  return mapOrders(orders, await loadCatalog(clinicId))
}
