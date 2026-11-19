/**
 * CTO-40: Square connector (Square POS is common for in-clinic retail).
 * OAuth code flow with ITEMS_READ, INVENTORY_READ and MERCHANT_PROFILE_READ.
 * Access tokens last about 30 days and are refreshed before they expire.
 *
 * Env: SQUARE_APP_ID, SQUARE_APP_SECRET, SQUARE_ENV (sandbox | production),
 * SQUARE_API_VERSION. The app's redirect URL must be
 * <frontend>/dashboard/settings/integrations/callback/square.
 */
import { providerFetch } from './http'
import { callbackPath, frontendOrigin, type StoreConnector } from './types'
import {
  ImportSourceError,
  clip,
  httpsOrNull,
  variantName,
  MAX_DESCRIPTION,
  type FetchPage,
  type NormalizedItem,
} from '../catalogImport/types'

export const SQUARE_SCOPES = 'ITEMS_READ INVENTORY_READ MERCHANT_PROFILE_READ'
/** Refresh when fewer than this many ms are left on the token. */
const REFRESH_MARGIN_MS = 7 * 24 * 3600 * 1000

export const squareConfig = (env: NodeJS.ProcessEnv = process.env) => {
  const appId = env.SQUARE_APP_ID?.trim()
  const appSecret = env.SQUARE_APP_SECRET?.trim()
  if (!appId || !appSecret) return null
  const production = (env.SQUARE_ENV ?? '').trim().toLowerCase() === 'production'
  return {
    appId,
    appSecret,
    base: production ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com',
    version: env.SQUARE_API_VERSION?.trim() || '2025-10-16',
  }
}

const cfgOrThrow = () => {
  const c = squareConfig()
  if (!c)
    throw new ImportSourceError('Square is not set up on this server', 'not_configured', false)
  return c
}

const redirectUri = () => `${frontendOrigin()}${callbackPath('SQUARE')}`

export function squareAuthUrl(state: string): string {
  const c = cfgOrThrow()
  const q = new URLSearchParams({
    client_id: c.appId,
    scope: SQUARE_SCOPES,
    session: 'false',
    state,
    redirect_uri: redirectUri(),
  })
  return `${c.base}/oauth2/authorize?${q.toString()}`
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_at?: string
  merchant_id?: string
}

export async function exchangeSquareCode(code: string) {
  const c = cfgOrThrow()
  const res = await providerFetch<TokenResponse>(`${c.base}/oauth2/token`, {
    provider: 'Square',
    headers: { 'square-version': c.version },
    json: {
      client_id: c.appId,
      client_secret: c.appSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
    },
  })
  if (!res?.access_token || !res.merchant_id) {
    throw new ImportSourceError('Square did not grant access', 'oauth_failed', false)
  }
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? null,
    tokenExpiresAt: res.expires_at ? new Date(res.expires_at) : null,
    merchantId: res.merchant_id,
  }
}

export async function squareMerchantName(token: string, merchantId: string): Promise<string> {
  const c = cfgOrThrow()
  try {
    const res = await providerFetch<{ merchant?: { business_name?: string } }>(
      `${c.base}/v2/merchants/${encodeURIComponent(merchantId)}`,
      {
        provider: 'Square',
        headers: { authorization: `Bearer ${token}`, 'square-version': c.version },
      }
    )
    return clip(res?.merchant?.business_name, 120) ?? 'Square store'
  } catch {
    return 'Square store'
  }
}

interface CatalogObject {
  type: string
  id: string
  is_deleted?: boolean
  image_data?: { url?: string }
  item_data?: {
    name?: string
    description?: string
    product_type?: string
    image_ids?: string[]
    categories?: { id: string }[]
    variations?: {
      id: string
      is_deleted?: boolean
      item_variation_data?: {
        name?: string
        sku?: string
        price_money?: { amount?: number; currency?: string }
      }
    }[]
  }
  category_data?: { name?: string }
}

/** Pure: a catalog search page (with related objects) and stock counts → items. */
export function squareItems(
  objects: CatalogObject[],
  related: CatalogObject[],
  stock: Map<string, number>
): NormalizedItem[] {
  const images = new Map(
    related.filter((o) => o.type === 'IMAGE').map((o) => [o.id, httpsOrNull(o.image_data?.url)])
  )
  const categories = new Map(
    related.filter((o) => o.type === 'CATEGORY').map((o) => [o.id, o.category_data?.name ?? null])
  )
  const items: NormalizedItem[] = []
  for (const o of objects) {
    const d = o.item_data
    if (o.type !== 'ITEM' || o.is_deleted || !d?.name) continue
    if (d.product_type && /APPOINTMENTS_SERVICE|EVENT|DONATION/.test(d.product_type)) continue
    const variations = (d.variations ?? []).filter((v) => !v.is_deleted)
    const image = d.image_ids?.map((id) => images.get(id)).find(Boolean) ?? null
    const category = d.categories?.map((c) => categories.get(c.id)).find(Boolean) ?? null
    for (const v of variations) {
      const vd = v.item_variation_data ?? {}
      const multi = variations.length > 1
      const amount = vd.price_money?.amount
      items.push({
        externalId: v.id,
        name: clip(multi ? variantName(d.name, vd.name) : d.name, 200) ?? '',
        sku: clip(vd.sku, 64),
        price: typeof amount === 'number' ? Math.round(amount) / 100 : null,
        description: clip(d.description, MAX_DESCRIPTION),
        imageUrl: image,
        stock: stock.has(v.id) ? stock.get(v.id)! : null,
        category,
        tags: [],
      })
    }
  }
  return items
}

export const squareConnector: StoreConnector = {
  provider: 'SQUARE',
  label: 'Square',
  connectKind: 'oauth',
  isConfigured: () => squareConfig() !== null,
  async fetchPage(conn, cursor, onTokenRefresh): Promise<FetchPage> {
    const c = cfgOrThrow()
    let token = conn.accessToken
    if (!token) throw new ImportSourceError('Reconnect Square', 'unauthorized', false)
    if (
      conn.refreshToken &&
      conn.tokenExpiresAt &&
      conn.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS
    ) {
      const res = await providerFetch<TokenResponse>(`${c.base}/oauth2/token`, {
        provider: 'Square',
        headers: { 'square-version': c.version },
        json: {
          client_id: c.appId,
          client_secret: c.appSecret,
          grant_type: 'refresh_token',
          refresh_token: conn.refreshToken,
        },
      })
      if (!res?.access_token) throw new ImportSourceError('Reconnect Square', 'unauthorized', false)
      token = res.access_token
      await onTokenRefresh({
        accessToken: token,
        refreshToken: res.refresh_token ?? conn.refreshToken,
        tokenExpiresAt: res.expires_at ? new Date(res.expires_at) : null,
      })
    }
    const headers = { authorization: `Bearer ${token}`, 'square-version': c.version }
    const page = await providerFetch<{
      objects?: CatalogObject[]
      related_objects?: CatalogObject[]
      cursor?: string
    }>(`${c.base}/v2/catalog/search`, {
      provider: 'Square',
      headers,
      json: {
        object_types: ['ITEM'],
        include_related_objects: true,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      },
    })
    const objects = page?.objects ?? []
    const variationIds = objects.flatMap((o) => (o.item_data?.variations ?? []).map((v) => v.id))
    const stock = new Map<string, number>()
    for (let i = 0; i < variationIds.length; i += 500) {
      let invCursor: string | undefined
      do {
        const inv = await providerFetch<{
          counts?: { catalog_object_id: string; quantity?: string; state?: string }[]
          cursor?: string
        }>(`${c.base}/v2/inventory/counts/batch-retrieve`, {
          provider: 'Square',
          headers,
          json: {
            catalog_object_ids: variationIds.slice(i, i + 500),
            states: ['IN_STOCK'],
            ...(invCursor ? { cursor: invCursor } : {}),
          },
        })
        for (const count of inv?.counts ?? []) {
          const q = Math.max(0, Math.floor(Number(count.quantity ?? 0)))
          stock.set(
            count.catalog_object_id,
            (stock.get(count.catalog_object_id) ?? 0) + (Number.isFinite(q) ? q : 0)
          )
        }
        invCursor = inv?.cursor
      } while (invCursor)
    }
    const items = squareItems(objects, page?.related_objects ?? [], stock)
    return page?.cursor ? { items, next: page.cursor } : { items }
  },
  async revoke(conn) {
    const c = squareConfig()
    if (!c || !conn.accessToken) return
    await providerFetch(`${c.base}/oauth2/revoke`, {
      provider: 'Square',
      headers: { authorization: `Client ${c.appSecret}`, 'square-version': c.version },
      json: { client_id: c.appId, access_token: conn.accessToken },
    })
  },
}
