/**
 * CTO-40: a clinic's connections to outside stores. Credentials are stored
 * field-encrypted (StoreConnection.accessToken / refreshToken, fle:v1) and
 * are wiped on disconnect; imported products stay, keeping their external
 * ids so a reconnect links them again.
 */
import type { StoreConnection } from '@prisma/client'
import prisma from '../../config/prisma'
import { withTenantBypass } from '../../config/tenantContext'
import * as auditService from '../auditService'
import { ImportSourceError, type StoreProvider } from '../catalogImport/types'
import { signState, verifyState } from './state'
import {
  exchangeShopifyCode,
  normalizeShop,
  registerShopifyWebhooks,
  shopifyAuthUrl,
  shopifyConnector,
  verifyShopifyCallback,
} from './shopify'
import { exchangeSquareCode, squareAuthUrl, squareConnector, squareMerchantName } from './square'
import {
  isWooKey,
  normalizeStoreUrl,
  packWooKey,
  testWooConnection,
  wooAuthUrl,
  wooCommerceConnector,
} from './wooCommerce'
import { isWixSiteId, wixCatalogVersion, wixConnector } from './wix'
import type { ConnectionCredentials, StoreConnector, TokenUpdate } from './types'

export const CONNECTORS: Record<StoreProvider, StoreConnector> = {
  SHOPIFY: shopifyConnector,
  SQUARE: squareConnector,
  WOOCOMMERCE: wooCommerceConnector,
  WIX: wixConnector,
}

export interface Actor {
  clinicId: string
  userId: string
  ipAddress?: string | null
  userAgent?: string | null
}

const fail = (status: number, message: string, code: string) =>
  Object.assign(new Error(message), { statusCode: status, code })

/** A connection as the dashboard sees it: never a token. */
export const publicConnection = (c: StoreConnection) => ({
  id: c.id,
  provider: c.provider,
  displayName: c.displayName,
  externalAccountId: c.externalAccountId,
  status: c.status,
  scopes: c.scopes,
  lastSyncedAt: c.lastSyncedAt,
  lastError: c.lastError,
  connectedAt: c.createdAt,
  disconnectedAt: c.disconnectedAt,
})

/** Which providers this server can connect, for the source picker. */
export const providerCatalog = () =>
  Object.values(CONNECTORS).map((c) => ({
    provider: c.provider,
    label: c.label,
    connectKind: c.connectKind,
    configured: c.isConfigured(),
  }))

export async function listConnections(clinicId: string) {
  const rows = await prisma.storeConnection.findMany({
    where: { clinicId },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(publicConnection)
}

async function audit(actor: Actor | null, clinicId: string, conn: StoreConnection, action: string) {
  await auditService.logAudit({
    clinicId,
    entityType: 'StoreConnection',
    entityId: conn.id,
    action,
    newValue: { provider: conn.provider },
    performedById: actor?.userId ?? null,
    ipAddress: actor?.ipAddress ?? null,
    userAgent: actor?.userAgent ?? null,
  })
}

async function saveConnection(
  actor: Actor,
  data: {
    provider: StoreProvider
    externalAccountId: string
    displayName: string
    accessToken: string
    refreshToken?: string | null
    tokenExpiresAt?: Date | null
    apiKeyId?: string | null
    scopes?: string
  }
) {
  const fields = {
    displayName: data.displayName.slice(0, 120),
    status: 'ACTIVE',
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? null,
    tokenExpiresAt: data.tokenExpiresAt ?? null,
    apiKeyId: data.apiKeyId ?? null,
    scopes: data.scopes ?? '',
    connectedById: actor.userId,
    lastError: null,
    disconnectedAt: null,
  }
  const conn = await prisma.storeConnection.upsert({
    where: {
      clinicId_provider_externalAccountId: {
        clinicId: actor.clinicId,
        provider: data.provider,
        externalAccountId: data.externalAccountId,
      },
    },
    create: {
      clinicId: actor.clinicId,
      provider: data.provider,
      externalAccountId: data.externalAccountId,
      ...fields,
    },
    update: fields,
  })
  await audit(actor, actor.clinicId, conn, 'STORE_CONNECTED')
  return publicConnection(conn)
}

// ─── Starting a connection ───────────────────────────────────────────────────

/** Returns where to send the browser (OAuth providers and the WooCommerce key screen). */
export function startConnection(
  actor: Actor,
  provider: StoreProvider,
  input: { shop?: string; storeUrl?: string }
) {
  const connector = CONNECTORS[provider]
  if (!connector.isConfigured()) {
    throw fail(
      400,
      `${connector.label} is not set up on this server yet`,
      'provider_not_configured'
    )
  }
  const base = { clinicId: actor.clinicId, userId: actor.userId, provider }
  if (provider === 'SHOPIFY') {
    const shop = normalizeShop(input.shop ?? '')
    if (!shop)
      throw fail(
        400,
        'Enter your Shopify address, for example your-store.myshopify.com',
        'invalid_shop'
      )
    return { url: shopifyAuthUrl(shop, signState({ ...base, account: shop })) }
  }
  if (provider === 'SQUARE') return { url: squareAuthUrl(signState(base)) }
  if (provider === 'WOOCOMMERCE') {
    const storeUrl = safeStoreUrl(input.storeUrl ?? '')
    return { url: wooAuthUrl(storeUrl, signState({ ...base, account: storeUrl })) }
  }
  throw fail(400, 'Wix connects with an API key', 'use_key')
}

function safeStoreUrl(raw: string): string {
  try {
    return normalizeStoreUrl(raw)
  } catch (err) {
    throw fail(
      400,
      err instanceof ImportSourceError ? err.message : 'Enter your store address',
      'invalid_store_url'
    )
  }
}

function stateFor(actor: Actor, provider: StoreProvider, state: unknown) {
  const p = verifyState(state)
  if (!p || p.provider !== provider || p.clinicId !== actor.clinicId || p.userId !== actor.userId) {
    throw fail(400, 'This connection link has expired. Start again', 'invalid_state')
  }
  return p
}

const asSourceError = (err: unknown): never => {
  if (err instanceof ImportSourceError) throw fail(err.retryable ? 424 : 400, err.message, err.code)
  throw err
}

/** The browser came back from Shopify or Square with ?code=…&state=… */
export async function completeOAuth(
  actor: Actor,
  provider: StoreProvider,
  query: Record<string, string>
) {
  const p = stateFor(actor, provider, query.state)
  if (typeof query.code !== 'string' || !query.code)
    throw fail(400, 'The store did not grant access', 'no_code')
  try {
    if (provider === 'SHOPIFY') {
      const shop = normalizeShop(query.shop ?? '')
      if (!shop || shop !== p.account || !verifyShopifyCallback(query)) {
        throw fail(400, 'Shopify could not be verified. Start again', 'invalid_hmac')
      }
      const { accessToken, scope } = await exchangeShopifyCode(shop, query.code)
      const conn = await saveConnection(actor, {
        provider,
        externalAccountId: shop,
        displayName: shop.replace(/\.myshopify\.com$/, ''),
        accessToken,
        scopes: scope,
      })
      void registerShopifyWebhooks(shop, accessToken)
      return conn
    }
    if (provider === 'SQUARE') {
      const t = await exchangeSquareCode(query.code)
      return await saveConnection(actor, {
        provider,
        externalAccountId: t.merchantId,
        displayName: await squareMerchantName(t.accessToken, t.merchantId),
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        tokenExpiresAt: t.tokenExpiresAt,
        scopes: 'ITEMS_READ INVENTORY_READ MERCHANT_PROFILE_READ',
      })
    }
  } catch (err) {
    return asSourceError(err)
  }
  throw fail(400, 'This store does not use that sign-in', 'unsupported')
}

/**
 * WooCommerce posts the new key here (server to server, no session). The
 * signed state, sent as WooCommerce's user_id, says which clinic and store.
 */
export async function wooCallback(body: Record<string, unknown>) {
  const p = verifyState(body.user_id)
  if (!p || p.provider !== 'WOOCOMMERCE' || !p.account)
    throw fail(400, 'Invalid or expired request', 'invalid_state')
  if (!isWooKey(body.consumer_key, body.consumer_secret))
    throw fail(400, 'Invalid key', 'invalid_key')
  if (body.key_permissions !== undefined && body.key_permissions !== 'read') {
    throw fail(400, 'Only a read-only key is accepted', 'key_not_read_only')
  }
  const actor: Actor = { clinicId: p.clinicId, userId: p.userId }
  await withTenantBypass('store-connect:woocommerce-callback', () =>
    saveConnection(actor, {
      provider: 'WOOCOMMERCE',
      externalAccountId: p.account!,
      displayName: new URL(p.account!).host,
      accessToken: packWooKey(body.consumer_key as string, body.consumer_secret as string),
      apiKeyId:
        typeof body.key_id === 'string' || typeof body.key_id === 'number'
          ? String(body.key_id).slice(0, 40)
          : null,
      scopes: 'read',
    })
  )
}

/** WooCommerce with a key the owner made by hand. The key is tried first. */
export async function connectWooKey(
  actor: Actor,
  input: { storeUrl: string; consumerKey: string; consumerSecret: string }
) {
  const storeUrl = safeStoreUrl(input.storeUrl)
  if (!isWooKey(input.consumerKey, input.consumerSecret)) {
    throw fail(400, 'Paste the consumer key (ck_...) and consumer secret (cs_...)', 'invalid_key')
  }
  const token = packWooKey(input.consumerKey, input.consumerSecret)
  try {
    await testWooConnection(storeUrl, token)
  } catch (err) {
    return asSourceError(err)
  }
  return saveConnection(actor, {
    provider: 'WOOCOMMERCE',
    externalAccountId: storeUrl,
    displayName: new URL(storeUrl).host,
    accessToken: token,
    apiKeyId: input.consumerKey.slice(-6),
    scopes: 'read',
  })
}

/** Wix with an account API key and the site id. The key is tried first. */
export async function connectWix(
  actor: Actor,
  input: { siteId: string; apiKey: string; label?: string }
) {
  const siteId = input.siteId.trim()
  const apiKey = input.apiKey.trim()
  if (!isWixSiteId(siteId))
    throw fail(400, 'Paste the site id from your Wix dashboard URL', 'invalid_site_id')
  if (apiKey.length < 20 || apiKey.length > 4_000)
    throw fail(400, 'Paste the whole API key', 'invalid_key')
  let version: string
  try {
    version = await wixCatalogVersion(apiKey, siteId)
  } catch (err) {
    return asSourceError(err)
  }
  return saveConnection(actor, {
    provider: 'WIX',
    externalAccountId: siteId,
    displayName: input.label?.trim() || `Wix site ${siteId.slice(0, 8)}`,
    accessToken: apiKey,
    scopes: `stores:read catalog:${version}`,
  })
}

// ─── Using and ending a connection ───────────────────────────────────────────

export async function getActiveConnection(clinicId: string, id: string) {
  const conn = await prisma.storeConnection.findFirst({ where: { id, clinicId } })
  if (!conn) throw fail(404, 'Store connection not found', 'not_found')
  if (conn.status === 'DISCONNECTED' || !conn.accessToken) {
    throw fail(409, 'This store is disconnected. Connect it again', 'disconnected')
  }
  return conn
}

export const credentialsOf = (c: StoreConnection): ConnectionCredentials => ({
  id: c.id,
  clinicId: c.clinicId,
  provider: c.provider as StoreProvider,
  externalAccountId: c.externalAccountId,
  accessToken: c.accessToken,
  refreshToken: c.refreshToken,
  tokenExpiresAt: c.tokenExpiresAt,
  apiKeyId: c.apiKeyId,
})

export async function saveTokenUpdate(clinicId: string, id: string, t: TokenUpdate) {
  await prisma.storeConnection.update({
    where: { id, clinicId },
    data: {
      accessToken: t.accessToken,
      ...(t.refreshToken !== undefined ? { refreshToken: t.refreshToken } : {}),
      ...(t.tokenExpiresAt !== undefined ? { tokenExpiresAt: t.tokenExpiresAt } : {}),
    },
  })
}

export async function markSynced(clinicId: string, id: string, error: string | null) {
  await prisma.storeConnection.update({
    where: { id, clinicId },
    data: error
      ? { status: 'ERROR', lastError: error.slice(0, 200) }
      : { status: 'ACTIVE', lastError: null, lastSyncedAt: new Date() },
  })
}

const WIPED = {
  status: 'DISCONNECTED',
  accessToken: null,
  refreshToken: null,
  tokenExpiresAt: null,
  apiKeyId: null,
}

/** Revokes where the provider allows it, then wipes the credentials. */
export async function disconnect(actor: Actor, id: string) {
  const conn = await prisma.storeConnection.findFirst({ where: { id, clinicId: actor.clinicId } })
  if (!conn) throw fail(404, 'Store connection not found', 'not_found')
  let revoked = false
  const connector = CONNECTORS[conn.provider as StoreProvider] as StoreConnector | undefined
  if (connector?.revoke && conn.accessToken) {
    try {
      await connector.revoke(credentialsOf(conn))
      revoked = true
    } catch (err) {
      console.warn('[store-connect] revoke failed:', (err as Error).message)
    }
  }
  const row = await prisma.storeConnection.update({
    where: { id, clinicId: actor.clinicId },
    data: { ...WIPED, disconnectedAt: new Date() },
  })
  await audit(actor, actor.clinicId, row, 'STORE_DISCONNECTED')
  return {
    connection: publicConnection(row),
    revoked,
    // WooCommerce and Wix keys can only be deleted by their owner.
    ownerAction:
      conn.provider === 'WOOCOMMERCE'
        ? 'Also delete the MedoFlow key in WooCommerce > Settings > Advanced > REST API.'
        : conn.provider === 'WIX'
          ? 'Also delete the API key in your Wix account (API Keys).'
          : null,
  }
}

/**
 * Shopify webhooks (HMAC checked by the route). app/uninstalled and
 * shop/redact wipe every connection to that shop. The customer privacy
 * topics need no action: MedoFlow reads products only, never Shopify
 * customers.
 */
export async function handleShopifyWebhook(topic: string, shopDomain: string): Promise<number> {
  const shop = normalizeShop(shopDomain)
  if (!shop || !(topic === 'app/uninstalled' || topic === 'shop/redact')) return 0
  return withTenantBypass('store-connect:shopify-webhook', async () => {
    const rows = await prisma.storeConnection.findMany({
      where: { provider: 'SHOPIFY', externalAccountId: shop, status: { not: 'DISCONNECTED' } },
    })
    for (const r of rows) {
      const row = await prisma.storeConnection.update({
        where: { id: r.id, clinicId: r.clinicId },
        data: {
          ...WIPED,
          disconnectedAt: new Date(),
          lastError: 'The MedoFlow app was removed from Shopify',
        },
      })
      await audit(null, r.clinicId, row, 'STORE_DISCONNECTED')
    }
    return rows.length
  })
}
