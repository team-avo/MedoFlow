/**
 * CTO-40: product catalog import. Connect an outside store (Shopify, Square,
 * WooCommerce, Wix) or upload a CSV / Excel file, preview what would change,
 * classify, then import. Imported products stay unsellable until classified.
 */
import api from './api'
import type { FulfillmentClass } from './rxCartApi'

export type StoreProvider = 'SHOPIFY' | 'SQUARE' | 'WOOCOMMERCE' | 'WIX'

export interface ProviderInfo {
  provider: StoreProvider
  label: string
  connectKind: 'oauth' | 'key' | 'oauth_or_key'
  /** False until the platform team has set the provider's app credentials. */
  configured: boolean
}

export interface StoreConnection {
  id: string
  provider: StoreProvider
  displayName: string
  externalAccountId: string
  status: 'ACTIVE' | 'ERROR' | 'DISCONNECTED'
  scopes: string
  lastSyncedAt: string | null
  lastError: string | null
  connectedAt: string
  disconnectedAt: string | null
}

export type ImportStatus = 'FETCHING' | 'PREVIEW_READY' | 'APPLYING' | 'DONE' | 'FAILED'
export type RowAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'CONFLICT' | 'ERROR'

export interface ImportCounts {
  total: number
  create: number
  update: number
  unchanged: number
  conflict: number
  error: number
  skipped: number
  unclassified: number
  rxLike: number
}

export interface ImportSummary {
  counts?: ImportCounts
  warnings?: string[]
  headers?: string[]
  detectedPreset?: string
  missingUpstream?: { count: number; names: string[] }
  failedPhase?: 'fetch' | 'apply'
  result?: {
    created: number
    updated: number
    failed: number
    unclassified: number
    imagesImported: number
    imagesSkipped: number
  }
}

export type MappedField =
  | 'name'
  | 'variant'
  | 'sku'
  | 'price'
  | 'description'
  | 'imageUrl'
  | 'stock'
  | 'category'
  | 'externalId'
export type ColumnMapping = Partial<Record<MappedField, string>>

export interface CatalogImport {
  id: string
  source: StoreProvider | 'CSV'
  preset: string | null
  storeConnectionId: string | null
  status: ImportStatus
  options: { syncStock: boolean; syncPrice: boolean }
  columnMapping: ColumnMapping | null
  summary: ImportSummary
  attempts: number
  lastError: string | null
  appliedAt: string | null
  createdAt: string
}

export interface ImportRow {
  id: string
  position: number
  externalId: string
  name: string
  nameOverride: string | null
  sku: string | null
  price: number | null
  stock: number | null
  imageSourceUrl: string | null
  sourceCategory: string | null
  suggestedClass: FulfillmentClass | null
  chosenClass: FulfillmentClass | null
  rxLike: boolean
  skipped: boolean
  action: RowAction
  matchedProductId: string | null
  matchedBy: 'EXTERNAL_ID' | 'SKU' | 'NAME' | null
  diff: {
    price?: { from: number; to: number }
    stock?: { from: number | null; to: number }
    description?: true
    image?: true
    link?: true
    imageSkipped?: string
  } | null
  error: string | null
}

export type RowFilter =
  | 'all'
  | 'create'
  | 'update'
  | 'unchanged'
  | 'conflict'
  | 'error'
  | 'skipped'
  | 'unclassified'

export const PROVIDER_LABELS: Record<StoreProvider, string> = {
  SHOPIFY: 'Shopify',
  SQUARE: 'Square',
  WOOCOMMERCE: 'WooCommerce',
  WIX: 'Wix',
}

// ─── Connections ─────────────────────────────────────────────────────────────

export const getStoreConnections = async () => {
  const res = await api.get('/store-connections')
  return res.data.data as { providers: ProviderInfo[]; connections: StoreConnection[] }
}

/** Returns the store's consent screen to send the browser to. */
export const startStoreConnection = async (
  provider: StoreProvider,
  input: { shop?: string; storeUrl?: string } = {}
) => {
  const res = await api.post(`/store-connections/${provider.toLowerCase()}/start`, input)
  return res.data.data.url as string
}

export const completeStoreConnection = async (
  provider: StoreProvider,
  query: Record<string, string>
) => {
  const res = await api.post(`/store-connections/${provider.toLowerCase()}/complete`, { query })
  return res.data.data.connection as StoreConnection
}

export const connectWooCommerceKey = async (input: {
  storeUrl: string
  consumerKey: string
  consumerSecret: string
}) => {
  const res = await api.post('/store-connections/woocommerce/key', input)
  return res.data.data.connection as StoreConnection
}

export const connectWixKey = async (input: { siteId: string; apiKey: string; label?: string }) => {
  const res = await api.post('/store-connections/wix/key', input)
  return res.data.data.connection as StoreConnection
}

export const disconnectStore = async (id: string) => {
  const res = await api.post(`/store-connections/${id}/disconnect`)
  return res.data.data as {
    connection: StoreConnection
    revoked: boolean
    ownerAction: string | null
  }
}

// ─── Imports ─────────────────────────────────────────────────────────────────

export const listImports = async () => {
  const res = await api.get('/catalog-imports')
  return res.data.data as {
    imports: CatalogImport[]
    presets: { id: string; label: string }[]
    fields: MappedField[]
  }
}

export const startStoreImport = async (connectionId: string) => {
  const res = await api.post('/catalog-imports', { connectionId })
  return res.data.data.import as CatalogImport
}

export const uploadImportFile = async (
  file: File,
  input: { preset?: string; mapping?: ColumnMapping } = {}
) => {
  const form = new FormData()
  form.append('file', file)
  if (input.preset) form.append('preset', input.preset)
  if (input.mapping) form.append('mapping', JSON.stringify(input.mapping))
  const res = await api.post('/catalog-imports/file', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data.data.import as CatalogImport
}

export const getImport = async (id: string) => {
  const res = await api.get(`/catalog-imports/${id}`)
  return res.data.data.import as CatalogImport
}

export const getImportRows = async (id: string, filter: RowFilter, page = 1, pageSize = 50) => {
  const res = await api.get(`/catalog-imports/${id}/rows`, { params: { filter, page, pageSize } })
  return res.data.data as { total: number; page: number; pageSize: number; rows: ImportRow[] }
}

export interface ImportEdits {
  rows?: {
    id: string
    skipped?: boolean
    nameOverride?: string | null
    chosenClass?: FulfillmentClass | null
  }[]
  bulk?: {
    rowIds?: string[]
    acceptSuggestions?: boolean
    chosenClass?: FulfillmentClass | null
    skipped?: boolean
  }
  options?: { syncStock?: boolean; syncPrice?: boolean }
}

export const editImport = async (id: string, edits: ImportEdits) => {
  const res = await api.patch(`/catalog-imports/${id}`, edits)
  return res.data.data.import as CatalogImport
}

export const applyImport = async (id: string) => {
  const res = await api.post(`/catalog-imports/${id}/apply`)
  return res.data.data.import as CatalogImport
}

export const retryImport = async (id: string) => {
  const res = await api.post(`/catalog-imports/${id}/retry`)
  return res.data.data.import as CatalogImport
}

/** The import is still working (poll it). */
export const isImportBusy = (s: ImportStatus | undefined) => s === 'FETCHING' || s === 'APPLYING'
