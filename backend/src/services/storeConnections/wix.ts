/**
 * CTO-40: Wix Stores connector. The owner creates an API key in their Wix
 * account (API Keys, with the "Wix Stores: read products" permission) and
 * pastes it with the site id; no Wix App Market app is needed. A Wix OAuth
 * app is a later step.
 *
 * Wix sites run catalog V1 or V3, and an integration must read both. The
 * Catalog Versioning API says which one a site uses. V3 stock levels live in
 * a separate inventory API, so V3 imports carry no stock count.
 */
import { providerFetch } from './http'
import type { StoreConnector } from './types'
import {
  ImportSourceError,
  clip,
  httpsOrNull,
  parsePrice,
  parseStock,
  plainText,
  variantName,
  MAX_DESCRIPTION,
  type FetchPage,
  type NormalizedItem,
} from '../catalogImport/types'

const API = 'https://www.wixapis.com'
const PAGE = 100
const SITE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isWixSiteId = (v: unknown): v is string =>
  typeof v === 'string' && SITE_ID_RE.test(v.trim())

const headers = (apiKey: string, siteId: string) => ({
  authorization: apiKey,
  'wix-site-id': siteId,
})

export type WixCatalog = 'V1' | 'V3'

export async function wixCatalogVersion(apiKey: string, siteId: string): Promise<WixCatalog> {
  const res = await providerFetch<{ catalogVersion?: string }>(
    `${API}/stores/v3/provision/version`,
    {
      provider: 'Wix',
      headers: headers(apiKey, siteId),
    }
  )
  const v = res?.catalogVersion ?? ''
  if (/V3/i.test(v)) return 'V3'
  if (/V1/i.test(v)) return 'V1'
  throw new ImportSourceError('This Wix site has no Wix Stores catalog', 'not_found', false)
}

interface WixV1Product {
  id: string
  name?: string
  description?: string
  sku?: string
  visible?: boolean
  productType?: string
  priceData?: { price?: number }
  price?: { price?: number }
  stock?: { trackInventory?: boolean; quantity?: number }
  media?: { mainMedia?: { image?: { url?: string } } }
  manageVariants?: boolean
  variants?: {
    id: string
    choices?: Record<string, string>
    variant?: { priceData?: { price?: number }; sku?: string; visible?: boolean }
    stock?: { trackQuantity?: boolean; quantity?: number }
  }[]
}

interface WixV3Product {
  id: string
  name?: string
  plainDescription?: string
  visible?: boolean
  productType?: string
  media?: { main?: { image?: string | { url?: string } } }
  variantsInfo?: {
    variants?: {
      id: string
      sku?: string
      visible?: boolean
      price?: { actualPrice?: { amount?: string } }
      choices?: { optionChoiceNames?: { choiceName?: string } }[]
    }[]
  }
}

/** Pure: catalog V1 products → items (one per managed variant). */
export function wixV1Items(products: WixV1Product[]): NormalizedItem[] {
  const out: NormalizedItem[] = []
  for (const p of products) {
    if (!p.name || p.visible === false || p.productType === 'digital') continue
    const image = httpsOrNull(p.media?.mainMedia?.image?.url)
    const description = plainText(p.description)
    const variants = p.manageVariants
      ? (p.variants ?? []).filter((v) => v.variant?.visible !== false)
      : []
    if (variants.length > 1) {
      for (const v of variants) {
        out.push({
          externalId: `${p.id}:${v.id}`,
          name: clip(variantName(p.name, Object.values(v.choices ?? {}).join(' / ')), 200) ?? '',
          sku: clip(v.variant?.sku || p.sku, 64),
          price: parsePrice(v.variant?.priceData?.price ?? p.priceData?.price ?? p.price?.price),
          description,
          imageUrl: image,
          stock: v.stock?.trackQuantity ? parseStock(v.stock.quantity) : null,
          category: null,
          tags: [],
        })
      }
      continue
    }
    out.push({
      externalId: p.id,
      name: clip(p.name, 200) ?? '',
      sku: clip(p.sku, 64),
      price: parsePrice(p.priceData?.price ?? p.price?.price),
      description,
      imageUrl: image,
      stock: p.stock?.trackInventory ? parseStock(p.stock.quantity) : null,
      category: null,
      tags: [],
    })
  }
  return out
}

/** Pure: catalog V3 products → items. Stock is not in the V3 product read. */
export function wixV3Items(products: WixV3Product[]): NormalizedItem[] {
  const out: NormalizedItem[] = []
  for (const p of products) {
    if (!p.name || p.visible === false || p.productType === 'DIGITAL') continue
    const img = p.media?.main?.image
    const image = httpsOrNull(typeof img === 'string' ? img : img?.url)
    const description = clip(p.plainDescription, MAX_DESCRIPTION)
    const variants = (p.variantsInfo?.variants ?? []).filter((v) => v.visible !== false)
    for (const v of variants) {
      const choice = (v.choices ?? [])
        .map((c) => c.optionChoiceNames?.choiceName)
        .filter(Boolean)
        .join(' / ')
      out.push({
        externalId: variants.length > 1 ? `${p.id}:${v.id}` : p.id,
        name: clip(variants.length > 1 ? variantName(p.name, choice) : p.name, 200) ?? '',
        sku: clip(v.sku, 64),
        price: parsePrice(v.price?.actualPrice?.amount),
        description,
        imageUrl: image,
        stock: null,
        category: null,
        tags: [],
      })
    }
  }
  return out
}

/** Stored (encrypted) as one secret: the API key. The site id is the account id. */
export const wixConnector: StoreConnector = {
  provider: 'WIX',
  label: 'Wix',
  connectKind: 'key',
  isConfigured: () => true,
  async fetchPage(conn, cursor): Promise<FetchPage> {
    if (!conn.accessToken) throw new ImportSourceError('Reconnect Wix', 'unauthorized', false)
    const siteId = conn.externalAccountId
    const h = headers(conn.accessToken, siteId)
    // The cursor records the catalog version so it is detected once per import.
    const [ver, rest] = cursor
      ? [cursor.slice(0, 2) as WixCatalog, cursor.slice(3)]
      : [await wixCatalogVersion(conn.accessToken, siteId), '']
    if (ver === 'V1') {
      const offset = Number(rest || 0) || 0
      const res = await providerFetch<{ products?: WixV1Product[]; totalResults?: number }>(
        `${API}/stores-reader/v1/products/query`,
        {
          provider: 'Wix',
          headers: h,
          json: { query: { paging: { limit: PAGE, offset } }, includeVariants: true },
        }
      )
      const products = res?.products ?? []
      const next = offset + products.length
      const more =
        products.length === PAGE && (res?.totalResults === undefined || next < res.totalResults)
      return more
        ? { items: wixV1Items(products), next: `V1:${next}` }
        : { items: wixV1Items(products) }
    }
    const res = await providerFetch<{
      products?: WixV3Product[]
      pagingMetadata?: { cursors?: { next?: string | null }; hasNext?: boolean }
    }>(`${API}/stores/v3/products/query`, {
      provider: 'Wix',
      headers: h,
      json: { query: { cursorPaging: { limit: PAGE, ...(rest ? { cursor: rest } : {}) } } },
    })
    const items = wixV3Items(res?.products ?? [])
    const nextCursor = res?.pagingMetadata?.cursors?.next
    return nextCursor ? { items, next: `V3:${nextCursor}` } : { items }
  },
}
