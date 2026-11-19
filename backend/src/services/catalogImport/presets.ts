/**
 * CTO-40: file import presets. Each store's own product export has a known
 * shape (and its own way of listing variants); everything else goes through
 * the generic preset, whose column mapping is guessed from the headers and
 * can be edited by the owner. The generic preset covers marketplace seller
 * sheets (for example a Tata 1mg listing template), clinic and med-spa
 * software exports, and distributor price lists.
 */
import {
  MAX_DESCRIPTION,
  MAX_IMPORT_ITEMS,
  MAX_NAME,
  MAX_SKU,
  clip,
  httpsOrNull,
  parsePrice,
  parseStock,
  plainText,
  variantName,
  type NormalizedItem,
} from './types'

export const FILE_PRESETS = [
  'shopify_csv',
  'wix_csv',
  'square_items',
  'woocommerce_csv',
  'generic',
] as const
export type FilePreset = (typeof FILE_PRESETS)[number]

export const FILE_PRESET_LABELS: Record<FilePreset, string> = {
  shopify_csv: 'Shopify product export (CSV)',
  wix_csv: 'Wix Stores product export (CSV)',
  square_items: 'Square item library export (CSV or Excel)',
  woocommerce_csv: 'WooCommerce product export (CSV)',
  generic: 'Other platform, marketplace or spreadsheet',
}

export const MAPPED_FIELDS = [
  'name',
  'variant',
  'sku',
  'price',
  'description',
  'imageUrl',
  'stock',
  'category',
  'externalId',
] as const
export type MappedField = (typeof MAPPED_FIELDS)[number]
/** Field → header name, exactly as it appears in the file. */
export type ColumnMapping = Partial<Record<MappedField, string>>

/** Header synonyms, most specific first (the first one present wins). */
const SYNONYMS: Record<MappedField, string[]> = {
  name: [
    'product name',
    'item name',
    'product title',
    'name',
    'title',
    'medicine name',
    'product',
    'item',
  ],
  variant: [
    'variant',
    'variation name',
    'variant name',
    'pack size',
    'size',
    'option',
    'option1 value',
  ],
  sku: [
    'sku',
    'sku id',
    'variant sku',
    'item code',
    'product code',
    'code',
    'barcode',
    'ean',
    'upc',
    'mpn',
  ],
  price: [
    'selling price',
    'sale price',
    'unit price',
    'price',
    'variant price',
    'retail price',
    'regular price',
    'mrp',
    'rate',
  ],
  description: [
    'description',
    'product description',
    'short description',
    'details',
    'body (html)',
  ],
  imageUrl: [
    'image url',
    'image src',
    'image',
    'image link',
    'images',
    'picture',
    'photo',
    'product image url',
  ],
  stock: [
    'stock',
    'quantity',
    'qty',
    'inventory',
    'stock quantity',
    'on hand',
    'available',
    'current quantity',
    'variant inventory qty',
  ],
  category: [
    'category',
    'product type',
    'type',
    'department',
    'collection',
    'segment',
    'categories',
  ],
  externalId: ['product id', 'item id', 'id', 'token'],
}

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ')

/** Best-guess mapping from the header row. A header is used for one field only. */
export function guessMapping(headers: string[]): ColumnMapping {
  const byNorm = new Map(headers.map((h) => [norm(h), h]))
  const used = new Set<string>()
  const mapping: ColumnMapping = {}
  for (const field of MAPPED_FIELDS) {
    for (const syn of SYNONYMS[field]) {
      const h = byNorm.get(syn)
      if (h && !used.has(h)) {
        mapping[field] = h
        used.add(h)
        break
      }
    }
  }
  return mapping
}

/** Which preset a file looks like, from its header row. */
export function detectPreset(headers: string[]): FilePreset {
  const set = new Set(headers.map(norm))
  const has = (...h: string[]) => h.every((x) => set.has(x))
  if (has('handle', 'title', 'variant price')) return 'shopify_csv'
  if (has('handleid', 'fieldtype', 'name')) return 'wix_csv'
  if (has('item name', 'variation name')) return 'square_items'
  if (has('type', 'name', 'regular price') && (set.has('parent') || set.has('id'))) {
    return 'woocommerce_csv'
  }
  return 'generic'
}

export interface FileItemsResult {
  items: NormalizedItem[]
  /** Short, row-numbered notes for the preview ("Row 7: no product name"). */
  warnings: string[]
  mapping: ColumnMapping
  headers: string[]
}

type Row = Record<string, string>

function toRecords(table: string[][]): { headers: string[]; rows: { n: number; r: Row }[] } {
  const headers = (table[0] ?? []).map((h) => h.trim())
  const rows = table.slice(1).map((cells, i) => {
    const r: Row = {}
    headers.forEach((h, c) => {
      if (h) r[h] = (cells[c] ?? '').trim()
    })
    return { n: i + 2, r }
  })
  return { headers, rows }
}

/** Case-insensitive cell lookup by header name. */
const getter = (headers: string[]) => {
  const byNorm = new Map(headers.map((h) => [norm(h), h]))
  return (r: Row, name: string | undefined): string => {
    if (!name) return ''
    const h = byNorm.get(norm(name)) ?? name
    return r[h] ?? ''
  }
}

const tagsOf = (v: string) =>
  v
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20)

const firstImage = (v: string) => httpsOrNull(v.split(/[,;|\s]+/).find(Boolean) ?? '')

const keyOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function item(fields: {
  externalId: string
  name: string
  sku?: string
  price?: string | number
  description?: string | null
  imageUrl?: string | null
  stock?: string | number | null
  category?: string
  tags?: string[]
}): NormalizedItem {
  return {
    externalId: fields.externalId.slice(0, 200),
    name: clip(fields.name, MAX_NAME) ?? '',
    sku: clip(fields.sku, MAX_SKU),
    price: parsePrice(fields.price),
    description: fields.description ? fields.description.slice(0, MAX_DESCRIPTION) : null,
    imageUrl: fields.imageUrl ?? null,
    stock: parseStock(fields.stock),
    category: clip(fields.category, 100),
    tags: fields.tags ?? [],
  }
}

// ─── Shopify: one row per variant; extra rows of a handle carry images ──────

function shopify(headers: string[], rows: { n: number; r: Row }[]): NormalizedItem[] {
  const get = getter(headers)
  const out: NormalizedItem[] = []
  let current: {
    handle: string
    title: string
    desc: string | null
    type: string
    tags: string[]
    image: string | null
  } | null = null
  for (const { r } of rows) {
    const handle = get(r, 'Handle')
    if (!handle) continue
    if (get(r, 'Title')) {
      current = {
        handle,
        title: get(r, 'Title'),
        desc: plainText(get(r, 'Body (HTML)')),
        type: get(r, 'Type') || get(r, 'Product Category'),
        tags: tagsOf(get(r, 'Tags')),
        image: firstImage(get(r, 'Image Src')),
      }
    }
    if (!current || current.handle !== handle) continue
    if (get(r, 'Status').toLowerCase() === 'archived') continue
    // Image-only rows have no variant price.
    if (!get(r, 'Variant Price')) continue
    const options = ['Option1 Value', 'Option2 Value', 'Option3 Value']
      .map((o) => get(r, o))
      .filter((v) => v && !/^default title$/i.test(v))
      .join(' / ')
    const sku = get(r, 'Variant SKU')
    out.push(
      item({
        externalId: `${handle}:${sku || keyOf(options) || 'default'}`,
        name: variantName(current.title, options),
        sku,
        price: get(r, 'Variant Price'),
        description: current.desc,
        imageUrl: firstImage(get(r, 'Variant Image')) ?? current.image,
        stock: get(r, 'Variant Inventory Qty') || null,
        category: current.type,
        tags: current.tags,
      })
    )
  }
  return out
}

// ─── Wix: a Product row, then optional Variant rows of the same handleId ────

const WIX_MEDIA = 'https://static.wixstatic.com/media/'
const wixImage = (v: string) => {
  const first =
    v
      .split(';')
      .map((s) => s.trim())
      .find(Boolean) ?? ''
  if (!first) return null
  return httpsOrNull(/^https:\/\//i.test(first) ? first : WIX_MEDIA + first)
}

function wix(headers: string[], rows: { n: number; r: Row }[]): NormalizedItem[] {
  const get = getter(headers)
  const products = new Map<string, Row>()
  const variants = new Map<string, Row[]>()
  const order: string[] = []
  for (const { r } of rows) {
    const id = get(r, 'handleId')
    if (!id) continue
    const kind = get(r, 'fieldType').toLowerCase()
    if (kind === 'product') {
      products.set(id, r)
      order.push(id)
    } else if (kind === 'variant') {
      variants.set(id, [...(variants.get(id) ?? []), r])
    }
  }
  const out: NormalizedItem[] = []
  for (const id of order) {
    const p = products.get(id)!
    const base = {
      description: plainText(get(p, 'description')),
      imageUrl: wixImage(get(p, 'productImageUrl')),
      category: get(p, 'collection').split(';')[0] ?? '',
    }
    const vs = variants.get(id) ?? []
    if (vs.length === 0) {
      out.push(
        item({
          externalId: id,
          name: get(p, 'name'),
          sku: get(p, 'sku'),
          price: get(p, 'price'),
          stock: get(p, 'inventory'),
          ...base,
        })
      )
      continue
    }
    vs.forEach((v, i) => {
      const choice = [1, 2, 3, 4, 5, 6]
        .map((n) => get(v, `productOptionDescription${n}`))
        .filter(Boolean)
        .join(' / ')
      out.push(
        item({
          externalId: `${id}:${get(v, 'sku') || keyOf(choice) || String(i + 1)}`,
          name: variantName(get(p, 'name'), choice),
          sku: get(v, 'sku') || get(p, 'sku'),
          price: get(v, 'price') || get(p, 'price'),
          stock: get(v, 'inventory') || get(p, 'inventory'),
          ...base,
        })
      )
    })
  }
  return out
}

// ─── Square: one row per variation; stock per location columns ──────────────

function square(headers: string[], rows: { n: number; r: Row }[]): NormalizedItem[] {
  const get = getter(headers)
  const stockCols = headers.filter((h) => /^current quantity/i.test(h))
  const out: NormalizedItem[] = []
  for (const { r, n } of rows) {
    const name = get(r, 'Item Name')
    if (!name) continue
    if (/^y(es)?$/i.test(get(r, 'Archived'))) continue
    if (/service|appointment/i.test(get(r, 'Item Type'))) continue
    const counts = stockCols.map((c) => parseStock(r[c])).filter((v): v is number => v !== null)
    const variation = get(r, 'Variation Name')
    out.push(
      item({
        externalId: get(r, 'Token') || `${keyOf(name)}:${keyOf(variation) || 'regular'}:${n}`,
        name: variantName(name, /^regular$/i.test(variation) ? '' : variation),
        sku: get(r, 'SKU'),
        price: get(r, 'Price'),
        description: plainText(get(r, 'Description')),
        stock: counts.length ? counts.reduce((a, b) => a + b, 0) : null,
        category: get(r, 'Category') || get(r, 'Reporting Category'),
      })
    )
  }
  return out
}

// ─── WooCommerce: simple products and variations (variable parents skipped) ─

function wooCommerce(headers: string[], rows: { n: number; r: Row }[]): NormalizedItem[] {
  const get = getter(headers)
  const parents = new Map<string, Row>()
  for (const { r } of rows) {
    if (/variable/i.test(get(r, 'Type'))) {
      if (get(r, 'ID')) parents.set(`id:${get(r, 'ID')}`, r)
      if (get(r, 'SKU')) parents.set(get(r, 'SKU'), r)
    }
  }
  const out: NormalizedItem[] = []
  for (const { r, n } of rows) {
    const type = get(r, 'Type').toLowerCase()
    const isVariation = type.includes('variation')
    if (!isVariation && !type.includes('simple')) continue
    if (get(r, 'Published') === '-1') continue
    const parent = isVariation ? parents.get(get(r, 'Parent')) : undefined
    const name = get(r, 'Name') || (parent ? get(parent, 'Name') : '')
    out.push(
      item({
        externalId: get(r, 'ID') || get(r, 'SKU') || `${keyOf(name)}:${n}`,
        name,
        sku: get(r, 'SKU'),
        price: get(r, 'Regular price') || get(r, 'Sale price'),
        description: plainText(
          get(r, 'Short description') ||
            get(r, 'Description') ||
            (parent ? get(parent, 'Short description') : '')
        ),
        imageUrl: firstImage(get(r, 'Images') || (parent ? get(parent, 'Images') : '')),
        stock: get(r, 'Stock') || null,
        category: (get(r, 'Categories') || (parent ? get(parent, 'Categories') : ''))
          .split(/[,>]/)[0]
          ?.trim(),
        tags: tagsOf(get(r, 'Tags')),
      })
    )
  }
  return out
}

// ─── Generic: one row per item, mapped columns ───────────────────────────────

function generic(
  headers: string[],
  rows: { n: number; r: Row }[],
  mapping: ColumnMapping
): NormalizedItem[] {
  const get = getter(headers)
  const out: NormalizedItem[] = []
  for (const { r, n } of rows) {
    const name = get(r, mapping.name)
    if (!name && !Object.values(r).some(Boolean)) continue
    const variant = get(r, mapping.variant)
    const fullName = variantName(name, variant)
    const sku = get(r, mapping.sku)
    out.push(
      item({
        externalId:
          get(r, mapping.externalId) || sku || `${keyOf(fullName) || 'row'}${name ? '' : `:${n}`}`,
        name: fullName,
        sku,
        price: get(r, mapping.price),
        description: plainText(get(r, mapping.description)),
        imageUrl: firstImage(get(r, mapping.imageUrl)),
        stock: get(r, mapping.stock) || null,
        category: get(r, mapping.category),
      })
    )
  }
  return out
}

/** Turns a parsed file (header row first) into items for the chosen preset. */
export function fileToItems(
  table: string[][],
  preset: FilePreset,
  mappingOverride?: ColumnMapping
): FileItemsResult {
  const { headers, rows } = toRecords(table)
  // The owner's mapping replaces the guess entirely ("not in this file" is a choice).
  const mapping: ColumnMapping =
    preset === 'generic' ? (mappingOverride ? { ...mappingOverride } : guessMapping(headers)) : {}
  const warnings: string[] = []
  if (preset === 'generic' && !mapping.name) {
    warnings.push('Pick the column that holds the product name')
    return { items: [], warnings, mapping, headers }
  }
  const items =
    preset === 'shopify_csv'
      ? shopify(headers, rows)
      : preset === 'wix_csv'
        ? wix(headers, rows)
        : preset === 'square_items'
          ? square(headers, rows)
          : preset === 'woocommerce_csv'
            ? wooCommerce(headers, rows)
            : generic(headers, rows, mapping)
  if (items.length > MAX_IMPORT_ITEMS) {
    warnings.push(`Only the first ${MAX_IMPORT_ITEMS} products are imported`)
  }
  return { items: items.slice(0, MAX_IMPORT_ITEMS), warnings, mapping, headers }
}
