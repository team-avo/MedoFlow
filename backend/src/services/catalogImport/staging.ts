/**
 * CTO-40: works out what an import would do to the catalog (the dry run).
 * Pure: items and the clinic's current products in, one staged row per item
 * out. Nothing is written here.
 *
 * Matching, in order:
 *  1. same source and external id (a product this source imported before);
 *  2. same SKU (exactly one product);
 *  3. same name (normalised like the Rx→Cart mapper, so scribe matching and
 *     import matching agree).
 *
 * A re-sync never renames a product, never changes its class once it is
 * classified, and never reactivates one the clinic removed. Name clashes,
 * two items for one product, and SKUs shared by several products are
 * CONFLICT rows the owner resolves (rename or skip) before applying.
 */
import type { ProductFulfillmentClass } from '@prisma/client'
import { normalize } from '../rxMappingService'
import { suggestClass } from './classify'
import { MAX_NAME, type ImportSource, type NormalizedItem } from './types'

export type RowAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'CONFLICT' | 'ERROR'
export type MatchedBy = 'EXTERNAL_ID' | 'SKU' | 'NAME'

export interface ExistingProduct {
  id: string
  name: string
  sku: string | null
  price: number
  description: string | null
  isActive: boolean
  fulfillmentClass: ProductFulfillmentClass
  externalSource: string | null
  externalId: string | null
  imageSourceUrl: string | null
  stock: number | null
}

export interface StageOptions {
  source: ImportSource
  syncStock: boolean
  syncPrice: boolean
}

/** What the owner changed on a row in the preview. */
export interface RowOverride {
  nameOverride?: string | null
  skipped?: boolean
  chosenClass?: ProductFulfillmentClass | null
}

export interface RowDiff {
  price?: { from: number; to: number }
  stock?: { from: number | null; to: number }
  description?: true
  image?: true
  /** The product gets linked to this source's id. */
  link?: true
}

export interface StagedRow {
  position: number
  externalId: string
  name: string
  nameOverride: string | null
  sku: string | null
  price: number | null
  description: string | null
  imageSourceUrl: string | null
  stock: number | null
  sourceCategory: string | null
  suggestedClass: ProductFulfillmentClass | null
  chosenClass: ProductFulfillmentClass | null
  rxLike: boolean
  skipped: boolean
  action: RowAction
  matchedProductId: string | null
  matchedBy: MatchedBy | null
  diff: RowDiff | null
  error: string | null
}

const skuKey = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

export function stageItems(
  items: (NormalizedItem & RowOverride)[],
  existing: ExistingProduct[],
  opts: StageOptions
): StagedRow[] {
  const byExternal = new Map<string, ExistingProduct>()
  const bySku = new Map<string, ExistingProduct[]>()
  const byName = new Map<string, ExistingProduct>()
  for (const p of existing) {
    if (p.externalSource === opts.source && p.externalId) byExternal.set(p.externalId, p)
    const k = skuKey(p.sku)
    if (k) bySku.set(k, [...(bySku.get(k) ?? []), p])
    byName.set(normalize(p.name), p)
  }

  const seenExternal = new Set<string>()
  const claimedProducts = new Set<string>()
  const claimedNames = new Set<string>()

  return items.map((item, position) => {
    const nameOverride = item.nameOverride?.trim().slice(0, MAX_NAME) || null
    const finalName = nameOverride ?? item.name
    const { suggested, rxLike } = suggestClass(item)
    const row: StagedRow = {
      position,
      externalId: item.externalId,
      name: item.name,
      nameOverride,
      sku: item.sku,
      price: item.price,
      description: item.description,
      imageSourceUrl: item.imageUrl,
      stock: item.stock,
      sourceCategory: item.category,
      suggestedClass: suggested,
      chosenClass: item.chosenClass ?? null,
      rxLike,
      skipped: item.skipped ?? false,
      action: 'CREATE',
      matchedProductId: null,
      matchedBy: null,
      diff: null,
      error: null,
    }
    const result = (action: RowAction, error: string | null = null) => {
      row.action = action
      row.error = error
      return row
    }

    if (!finalName.trim()) return result('ERROR', 'No product name')
    if (seenExternal.has(item.externalId))
      return result('ERROR', 'The same item appears twice in this import')
    seenExternal.add(item.externalId)
    // Skipped rows hold no claim on a product or a name.
    if (row.skipped) return row

    let match: ExistingProduct | undefined = byExternal.get(item.externalId)
    let matchedBy: MatchedBy | null = match ? 'EXTERNAL_ID' : null
    if (!match && skuKey(item.sku)) {
      const hits = bySku.get(skuKey(item.sku)) ?? []
      if (hits.length > 1) return result('CONFLICT', 'Several products already use this SKU')
      if (hits.length === 1) {
        match = hits[0]
        matchedBy = 'SKU'
      }
    }
    if (!match && !nameOverride) {
      match = byName.get(normalize(item.name))
      if (match) matchedBy = 'NAME'
    }

    if (match) {
      row.matchedProductId = match.id
      row.matchedBy = matchedBy
      if (
        matchedBy !== 'EXTERNAL_ID' &&
        match.externalSource === opts.source &&
        match.externalId &&
        match.externalId !== item.externalId
      ) {
        return result('CONFLICT', 'That product is already linked to another item from this store')
      }
      if (claimedProducts.has(match.id)) {
        return result('CONFLICT', 'Two items in this import match the same product')
      }
      claimedProducts.add(match.id)

      const diff: RowDiff = {}
      if (opts.syncPrice && item.price !== null && Math.abs(item.price - match.price) >= 0.005) {
        diff.price = { from: match.price, to: item.price }
      }
      if (opts.syncStock && item.stock !== null && item.stock !== match.stock) {
        diff.stock = { from: match.stock, to: item.stock }
      }
      if (item.description && item.description !== match.description) diff.description = true
      if (item.imageUrl && item.imageUrl !== match.imageSourceUrl) diff.image = true
      if (match.externalSource !== opts.source || match.externalId !== item.externalId)
        diff.link = true
      const classifies = !!row.chosenClass && match.fulfillmentClass === 'UNCLASSIFIED'
      row.diff = Object.keys(diff).length ? diff : null
      return result(row.diff || classifies ? 'UPDATE' : 'UNCHANGED')
    }

    const nameKey = normalize(finalName)
    if (byName.has(nameKey)) {
      return result('CONFLICT', 'Another product already has this name. Rename it or skip it')
    }
    if (claimedNames.has(nameKey)) {
      return result('CONFLICT', 'Two items in this import have the same name. Rename one')
    }
    if (item.price === null) return result('ERROR', 'No price')
    claimedNames.add(nameKey)
    return result('CREATE')
  })
}

/** Counts per action, for the preview header and the import summary. */
export function countRows(
  rows: (Pick<StagedRow, 'skipped' | 'chosenClass' | 'rxLike'> & { action: string })[]
) {
  const c = {
    total: rows.length,
    create: 0,
    update: 0,
    unchanged: 0,
    conflict: 0,
    error: 0,
    skipped: 0,
    unclassified: 0,
    rxLike: 0,
  }
  for (const r of rows) {
    if (r.skipped) {
      c.skipped += 1
      continue
    }
    const key = r.action.toLowerCase() as 'create' | 'update' | 'unchanged' | 'conflict' | 'error'
    if (key in c) c[key] += 1
    if (r.action === 'CREATE' && !r.chosenClass) c.unclassified += 1
    if (r.rxLike) c.rxLike += 1
  }
  return c
}
