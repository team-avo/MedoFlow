/**
 * CTO-40: Shopify connector. A public (or Dev Dashboard) OAuth app using the
 * GraphQL Admin API; admin-created custom apps cannot be made since
 * 2026-01-01. Scopes: read_products, read_inventory (read only).
 *
 * Env: SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_API_VERSION.
 * The app's redirect URL must be <frontend>/dashboard/settings/integrations/callback/shopify,
 * and its webhook URL (app/uninstalled plus the three mandatory privacy
 * topics) <backend>/api/v1/webhooks/shopify.
 */
import crypto from 'crypto'
import { providerFetch } from './http'
import {
  backendOrigin,
  callbackPath,
  frontendOrigin,
  type ConnectionCredentials,
  type StoreConnector,
} from './types'
import {
  ImportSourceError,
  clip,
  httpsOrNull,
  parsePrice,
  parseStock,
  variantName,
  MAX_DESCRIPTION,
  type FetchPage,
  type NormalizedItem,
} from '../catalogImport/types'

export const SHOPIFY_SCOPES = 'read_products,read_inventory'
const SHOP_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/

export const shopifyConfig = (env: NodeJS.ProcessEnv = process.env) => {
  const clientId = env.SHOPIFY_CLIENT_ID?.trim()
  const clientSecret = env.SHOPIFY_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, apiVersion: env.SHOPIFY_API_VERSION?.trim() || '2026-10' }
}

/** "my-store", "my-store.myshopify.com" or its admin URL → "my-store.myshopify.com". */
export function normalizeShop(input: string): string | null {
  let s = input.trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '').split(/[/?#]/)[0]!
  if (!s.includes('.')) s = `${s}.myshopify.com`
  return SHOP_RE.test(s) ? s : null
}

export function shopifyAuthUrl(shop: string, state: string): string {
  const cfg = shopifyConfig()
  if (!cfg)
    throw new ImportSourceError('Shopify is not set up on this server', 'not_configured', false)
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    scope: SHOPIFY_SCOPES,
    redirect_uri: `${frontendOrigin()}${callbackPath('SHOPIFY')}`,
    state,
  })
  return `https://${shop}/admin/oauth/authorize?${q.toString()}`
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** Checks the `hmac` Shopify adds to the OAuth redirect. */
export function verifyShopifyCallback(
  query: Record<string, string>,
  secret = shopifyConfig()?.clientSecret
): boolean {
  if (!secret || typeof query.hmac !== 'string') return false
  const message = Object.keys(query)
    .filter((k) => k !== 'hmac' && k !== 'signature')
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&')
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex')
  return safeEqual(digest, query.hmac.toLowerCase())
}

/** Checks X-Shopify-Hmac-Sha256 on a webhook (base64 HMAC of the raw body). */
export function verifyShopifyWebhook(
  rawBody: Buffer,
  header: string | undefined,
  secret = shopifyConfig()?.clientSecret
): boolean {
  if (!secret || !header) return false
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
  return safeEqual(digest, header)
}

export async function exchangeShopifyCode(
  shop: string,
  code: string
): Promise<{ accessToken: string; scope: string }> {
  const cfg = shopifyConfig()
  if (!cfg)
    throw new ImportSourceError('Shopify is not set up on this server', 'not_configured', false)
  const res = await providerFetch<{ access_token?: string; scope?: string }>(
    `https://${shop}/admin/oauth/access_token`,
    {
      provider: 'Shopify',
      json: { client_id: cfg.clientId, client_secret: cfg.clientSecret, code },
    }
  )
  if (!res?.access_token)
    throw new ImportSourceError('Shopify did not grant access', 'oauth_failed', false)
  return { accessToken: res.access_token, scope: res.scope ?? SHOPIFY_SCOPES }
}

async function graphql<T>(
  shop: string,
  token: string,
  query: string,
  variables: unknown
): Promise<T> {
  const cfg = shopifyConfig()
  const version = cfg?.apiVersion ?? '2026-10'
  const res = await providerFetch<{ data?: T; errors?: unknown }>(
    `https://${shop}/admin/api/${version}/graphql.json`,
    {
      provider: 'Shopify',
      headers: { 'x-shopify-access-token': token },
      json: { query, variables },
    }
  )
  if (!res?.data) throw new ImportSourceError('Shopify could not list the products', 'bad_response')
  return res.data
}

export const PRODUCTS_QUERY = `query MedoFlowProducts($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      description
      productType
      tags
      status
      featuredMedia { preview { image { url } } }
      variants(first: 100) {
        nodes { id title sku price inventoryQuantity }
      }
    }
  }
}`

interface ShopifyProductsData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes: {
      id: string
      title: string
      description?: string | null
      productType?: string | null
      tags?: string[]
      status?: string
      featuredMedia?: { preview?: { image?: { url?: string } | null } | null } | null
      variants: {
        nodes: {
          id: string
          title?: string | null
          sku?: string | null
          price?: string | null
          inventoryQuantity?: number | null
        }[]
      }
    }[]
  }
}

/** Pure: one GraphQL page → items (one per variant). */
export function shopifyItems(data: ShopifyProductsData): FetchPage {
  const items: NormalizedItem[] = []
  for (const p of data.products.nodes) {
    if (p.status === 'ARCHIVED') continue
    const image = httpsOrNull(p.featuredMedia?.preview?.image?.url)
    const multi = p.variants.nodes.length > 1
    for (const v of p.variants.nodes) {
      items.push({
        externalId: v.id,
        name: clip(multi ? variantName(p.title, v.title) : p.title, 200) ?? '',
        sku: clip(v.sku, 64),
        price: parsePrice(v.price),
        description: clip(p.description, MAX_DESCRIPTION),
        imageUrl: image,
        stock: parseStock(v.inventoryQuantity),
        category: clip(p.productType, 100),
        tags: (p.tags ?? []).slice(0, 20),
      })
    }
  }
  const { hasNextPage, endCursor } = data.products.pageInfo
  return hasNextPage && endCursor ? { items, next: endCursor } : { items }
}

/** Best effort: ask Shopify to tell us when the app is uninstalled. */
export async function registerShopifyWebhooks(shop: string, token: string): Promise<void> {
  try {
    await graphql(
      shop,
      token,
      `
        mutation ($url: URL!) {
          webhookSubscriptionCreate(
            topic: APP_UNINSTALLED
            webhookSubscription: { callbackUrl: $url, format: JSON }
          ) {
            userErrors {
              message
            }
          }
        }
      `,
      { url: `${backendOrigin()}/api/v1/webhooks/shopify` }
    )
  } catch (err) {
    console.warn('[store-connect] Shopify webhook not registered:', (err as Error).message)
  }
}

export const shopifyConnector: StoreConnector = {
  provider: 'SHOPIFY',
  label: 'Shopify',
  connectKind: 'oauth',
  isConfigured: () => shopifyConfig() !== null,
  async fetchPage(conn: ConnectionCredentials, cursor) {
    if (!conn.accessToken) throw new ImportSourceError('Reconnect Shopify', 'unauthorized', false)
    const data = await graphql<ShopifyProductsData>(
      conn.externalAccountId,
      conn.accessToken,
      PRODUCTS_QUERY,
      {
        cursor: cursor ?? null,
      }
    )
    return shopifyItems(data)
  },
  async revoke(conn) {
    if (!conn.accessToken) return
    // Uninstalls the app from the shop, which invalidates the token.
    await providerFetch(`https://${conn.externalAccountId}/admin/api_permissions/current.json`, {
      provider: 'Shopify',
      method: 'DELETE',
      headers: { 'x-shopify-access-token': conn.accessToken },
    })
  },
}
