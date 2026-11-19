/**
 * CTO-40: WooCommerce connector. WooCommerce's own app-authorisation screen
 * (/wc-auth/v1/authorize, scope=read) mints a read-only REST key and posts
 * it to our callback; pasting a key made under WooCommerce > Settings >
 * Advanced > REST API also works. No app review or platform credentials are
 * needed. The store URL is typed by the clinic, so every call goes through
 * the SSRF-guarded client.
 *
 * WooCommerce has no API to revoke a key: on disconnect the owner is told to
 * delete it in WooCommerce (we wipe our copy).
 */
import { assertSafeUrl, safeRequest } from '../catalogImport/safeHttp'
import { backendOrigin, callbackPath, frontendOrigin, type StoreConnector } from './types'
import {
  ImportSourceError,
  clip,
  httpsOrNull,
  parsePrice,
  parseStock,
  plainText,
  variantName,
  type FetchPage,
  type NormalizedItem,
} from '../catalogImport/types'

const PER_PAGE = 50

/** "shop.example.com" or "https://example.com/store/" → "https://example.com/store". */
export function normalizeStoreUrl(input: string): string {
  let s = input.trim()
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`
  const u = assertSafeUrl(s)
  const path = u.pathname.replace(/\/(wp-admin|wp-json|shop)(\/.*)?$/i, '').replace(/\/+$/, '')
  return `${u.origin}${path}`
}

export function wooAuthUrl(storeUrl: string, state: string): string {
  const q = new URLSearchParams({
    app_name: 'MedoFlow',
    scope: 'read',
    user_id: state,
    return_url: `${frontendOrigin()}${callbackPath('WOOCOMMERCE')}`,
    callback_url: `${backendOrigin()}/api/v1/store-connections/woocommerce/callback`,
  })
  return `${storeUrl}/wc-auth/v1/authorize?${q.toString()}`
}

/** Stored (encrypted) as one secret: "ck_…:cs_…". */
export const packWooKey = (consumerKey: string, consumerSecret: string) =>
  `${consumerKey}:${consumerSecret}`

const unpack = (token: string | null) => {
  const i = token?.indexOf(':') ?? -1
  if (!token || i <= 0) throw new ImportSourceError('Reconnect WooCommerce', 'unauthorized', false)
  return { key: token.slice(0, i), secret: token.slice(i + 1) }
}

export const isWooKey = (key: unknown, secret: unknown) =>
  typeof key === 'string' &&
  typeof secret === 'string' &&
  /^ck_[A-Za-z0-9]{20,80}$/.test(key) &&
  /^cs_[A-Za-z0-9]{20,80}$/.test(secret)

interface WooImage {
  src?: string
}
interface WooProduct {
  id: number
  name?: string
  type?: string
  status?: string
  sku?: string
  price?: string
  regular_price?: string
  description?: string
  short_description?: string
  stock_quantity?: number | null
  manage_stock?: boolean
  images?: WooImage[]
  categories?: { name?: string }[]
  tags?: { name?: string }[]
}
interface WooVariation {
  id: number
  sku?: string
  price?: string
  regular_price?: string
  stock_quantity?: number | null
  manage_stock?: boolean | string
  status?: string
  image?: WooImage | null
  attributes?: { name?: string; option?: string }[]
}

async function get<T>(
  storeUrl: string,
  token: string | null,
  path: string
): Promise<{ data: T; totalPages: number }> {
  const { key, secret } = unpack(token)
  const res = await safeRequest(`${storeUrl}/wp-json/wc/v3/${path}`, {
    headers: {
      authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
      accept: 'application/json',
    },
    timeoutMs: 15_000,
    maxBytes: 8 * 1024 * 1024,
  })
  if (res.status === 401 || res.status === 403) {
    throw new ImportSourceError(
      'WooCommerce refused the key. Reconnect the store',
      'unauthorized',
      false
    )
  }
  if (res.status === 404) {
    throw new ImportSourceError('No WooCommerce store answered at that address', 'not_found', false)
  }
  if (res.status !== 200)
    throw new ImportSourceError(`WooCommerce answered with an error (${res.status})`, 'http_error')
  try {
    return {
      data: JSON.parse(res.body.toString('utf8')) as T,
      totalPages: Number(res.headers['x-wp-totalpages'] ?? 1) || 1,
    }
  } catch {
    throw new ImportSourceError('WooCommerce sent an unreadable answer', 'bad_response')
  }
}

const stockOf = (manage: unknown, qty: number | null | undefined) =>
  manage === true || manage === 'parent' || manage === 'true' ? parseStock(qty) : null

/** Pure: a product (and its variations, for variable products) → items. */
export function wooItems(p: WooProduct, variations: WooVariation[] = []): NormalizedItem[] {
  if (!p.name || (p.status && p.status !== 'publish' && p.status !== 'private')) return []
  const base = {
    description: plainText(p.short_description || p.description),
    category: clip(p.categories?.[0]?.name, 100),
    tags: (p.tags ?? [])
      .map((t) => t.name ?? '')
      .filter(Boolean)
      .slice(0, 20),
  }
  const image = httpsOrNull(p.images?.[0]?.src)
  if (p.type === 'variable') {
    return variations
      .filter((v) => !v.status || v.status === 'publish' || v.status === 'private')
      .map((v) => ({
        externalId: String(v.id),
        name:
          clip(
            variantName(
              p.name!,
              (v.attributes ?? [])
                .map((a) => a.option)
                .filter(Boolean)
                .join(' / ')
            ),
            200
          ) ?? '',
        sku: clip(v.sku, 64),
        price: parsePrice(v.regular_price || v.price),
        imageUrl: httpsOrNull(v.image?.src) ?? image,
        stock: stockOf(
          v.manage_stock === 'parent' ? p.manage_stock : v.manage_stock,
          v.manage_stock === 'parent' ? p.stock_quantity : v.stock_quantity
        ),
        ...base,
      }))
  }
  if (p.type && p.type !== 'simple') return [] // grouped and external products are not stock
  return [
    {
      externalId: String(p.id),
      name: clip(p.name, 200) ?? '',
      sku: clip(p.sku, 64),
      price: parsePrice(p.regular_price || p.price),
      imageUrl: image,
      stock: stockOf(p.manage_stock, p.stock_quantity),
      ...base,
    },
  ]
}

/** A one-product call that proves the address and key work. */
export async function testWooConnection(storeUrl: string, token: string): Promise<void> {
  await get<unknown[]>(storeUrl, token, 'products?per_page=1')
}

export const wooCommerceConnector: StoreConnector = {
  provider: 'WOOCOMMERCE',
  label: 'WooCommerce',
  connectKind: 'oauth_or_key',
  isConfigured: () => true,
  async fetchPage(conn, cursor): Promise<FetchPage> {
    const page = Math.max(1, Number(cursor ?? 1) || 1)
    const { data, totalPages } = await get<WooProduct[]>(
      conn.externalAccountId,
      conn.accessToken,
      `products?per_page=${PER_PAGE}&page=${page}&orderby=id&order=asc`
    )
    const items: NormalizedItem[] = []
    for (const p of Array.isArray(data) ? data : []) {
      let variations: WooVariation[] = []
      if (p.type === 'variable') {
        variations = (
          await get<WooVariation[]>(
            conn.externalAccountId,
            conn.accessToken,
            `products/${p.id}/variations?per_page=100`
          )
        ).data
      }
      items.push(...wooItems(p, Array.isArray(variations) ? variations : []))
    }
    return page < totalPages ? { items, next: String(page + 1) } : { items }
  },
}
