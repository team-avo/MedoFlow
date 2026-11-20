/**
 * CTO-40: catalog import core. Pure functions: file readers, presets, class
 * suggestions and staging (the dry run). Synthetic data only.
 */
import zlib from 'zlib'
import { describe, expect, it } from 'vitest'
import { parseCsv, detectDelimiter } from '../services/catalogImport/csv'
import { readXlsx, columnIndex, XlsxError, MAX_PART_BYTES } from '../services/catalogImport/xlsx'
import { detectPreset, fileToItems, guessMapping } from '../services/catalogImport/presets'
import { suggestClass } from '../services/catalogImport/classify'
import { countRows, stageItems, type ExistingProduct } from '../services/catalogImport/staging'
import {
  parsePrice,
  parseStock,
  plainText,
  variantName,
  type NormalizedItem,
} from '../services/catalogImport/types'
import { parseUpload } from '../services/catalogImport/service'

// ─── A tiny .xlsx writer for tests (stored + deflated parts, no CRC check) ──

function zip(files: Record<string, string>, opts: { store?: boolean } = {}): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8')
    const data = opts.store ? raw : zlib.deflateRawSync(raw)
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(opts.store ? 0 : 8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(opts.store ? 0 : 8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cen = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  const count = Object.keys(files).length
  eocd.writeUInt16LE(count, 8)
  eocd.writeUInt16LE(count, 10)
  eocd.writeUInt32LE(cen.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cen, eocd])
}

const xlsxOf = (sheetXml: string, shared: string[]) =>
  zip({
    'xl/workbook.xml':
      '<workbook xmlns:r="r"><sheets><sheet name="Products" sheetId="1" r:id="rId7"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId7" Type="ws" Target="worksheets/products.xml"/></Relationships>',
    'xl/worksheets/products.xml': `<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`,
    'xl/sharedStrings.xml': `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
  })

// ─── CSV ─────────────────────────────────────────────────────────────────────

describe('parseCsv', () => {
  it('reads quotes, escaped quotes, embedded newlines, CRLF and a BOM', () => {
    const text =
      '﻿Name,Price,Description\r\n"Omega 3, 60 caps",24.00,"Line one\nline ""two"""\r\nZinc,9.5,\r\n'
    expect(parseCsv(text)).toEqual([
      ['Name', 'Price', 'Description'],
      ['Omega 3, 60 caps', '24.00', 'Line one\nline "two"'],
      ['Zinc', '9.5', ''],
    ])
  })

  it('detects semicolon and tab delimiters and skips blank lines', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(parseCsv('a\tb\n\n1\t2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('stops at the row cap (header + maxRows)', () => {
    const text = ['h', ...Array.from({ length: 30 }, (_, i) => `r${i}`)].join('\n')
    expect(parseCsv(text, 10)).toHaveLength(11)
  })
})

// ─── XLSX ────────────────────────────────────────────────────────────────────

describe('readXlsx', () => {
  it('reads shared strings, inline strings, numbers, gaps and the sheet the workbook names', () => {
    const buf = xlsxOf(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>Vitamin C &amp; Zinc</t></is></c><c r="B2"><v>12.5</v></c><c r="D2" t="b"><v>1</v></c></row>',
      ['Product Name', 'MRP', 'In stock']
    )
    expect(readXlsx(buf)).toEqual([
      ['Product Name', 'MRP', '', 'In stock'],
      ['Vitamin C & Zinc', '12.5', '', 'TRUE'],
    ])
  })

  it('reads stored (uncompressed) parts and falls back to sheet1', () => {
    const buf = zip(
      {
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData><row><c t="inlineStr"><is><t>Name</t></is></c></row></sheetData></worksheet>',
      },
      { store: true }
    )
    expect(readXlsx(buf)).toEqual([['Name']])
  })

  it('refuses non-zip bytes and parts bigger than the cap (zip bomb)', () => {
    expect(() => readXlsx(Buffer.from('not a zip'))).toThrow(XlsxError)
    const big = zip({ 'xl/worksheets/sheet1.xml': 'x' })
    // Claim an uncompressed size above the cap in the central directory.
    const cen = big.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    big.writeUInt32LE(MAX_PART_BYTES + 1, cen + 24)
    expect(() => readXlsx(big)).toThrow(/too large/)
  })

  it('maps column letters', () => {
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('Z9')).toBe(25)
    expect(columnIndex('AB12')).toBe(27)
  })

  it('parseUpload rejects legacy .xls and binaries, and accepts .xlsx', () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
    expect(() => parseUpload(ole)).toThrow(/xlsx or \.csv/)
    expect(() => parseUpload(Buffer.from([0x41, 0x00, 0x42]))).toThrow(/CSV or Excel/)
    expect(() => parseUpload(Buffer.alloc(0))).toThrow(/empty/)
    expect(parseUpload(xlsxOf('<row><c t="s"><v>0</v></c></row>', ['Name']))).toEqual([['Name']])
  })
})

// ─── Values ──────────────────────────────────────────────────────────────────

describe('value parsing', () => {
  it('prices: currency symbols, thousands and comma decimals', () => {
    expect(parsePrice('$1,299.00')).toBe(1299)
    expect(parsePrice('₹ 450')).toBe(450)
    expect(parsePrice('12,50')).toBe(12.5)
    expect(parsePrice('1.299,00')).toBe(1299)
    expect(parsePrice('')).toBeNull()
    expect(parsePrice('free')).toBeNull()
    expect(parsePrice(-3)).toBeNull()
  })

  it('stock: blanks are untracked, negatives are zero', () => {
    expect(parseStock('')).toBeNull()
    expect(parseStock('InStock')).toBeNull()
    expect(parseStock('-4')).toBe(0)
    expect(parseStock('1,200')).toBe(1200)
  })

  it('plain text from HTML and variant names', () => {
    expect(plainText('<p>Supports <b>sleep</b></p><p>60 caps &amp; more</p>')).toBe(
      'Supports sleep\n60 caps & more'
    )
    expect(variantName('Omega 3', 'Default Title')).toBe('Omega 3')
    expect(variantName('Omega 3', '120 softgels')).toBe('Omega 3 - 120 softgels')
  })
})

// ─── Presets ─────────────────────────────────────────────────────────────────

describe('file presets', () => {
  it('Shopify export: variants become products, image-only rows are ignored', () => {
    const table = parseCsv(
      [
        'Handle,Title,Body (HTML),Type,Tags,Option1 Value,Variant SKU,Variant Price,Variant Inventory Qty,Image Src,Status',
        'mag-gly,Magnesium Glycinate,<p>Calm</p>,Supplements,"sleep, minerals",60 caps,MAG-60,22.00,14,https://cdn.example.test/mag.png,active',
        'mag-gly,,,,,120 caps,MAG-120,38.00,3,,',
        'mag-gly,,,,,,,,,https://cdn.example.test/mag-2.png,',
        'old-thing,Old Thing,,,,Default Title,OLD-1,5.00,0,,archived',
      ].join('\n')
    )
    expect(detectPreset(table[0]!)).toBe('shopify_csv')
    const { items } = fileToItems(table, 'shopify_csv')
    expect(items.map((i) => [i.externalId, i.name, i.sku, i.price, i.stock])).toEqual([
      ['mag-gly:MAG-60', 'Magnesium Glycinate - 60 caps', 'MAG-60', 22, 14],
      ['mag-gly:MAG-120', 'Magnesium Glycinate - 120 caps', 'MAG-120', 38, 3],
    ])
    expect(items[1]!.imageUrl).toBe('https://cdn.example.test/mag.png')
    expect(items[0]!.tags).toEqual(['sleep', 'minerals'])
  })

  it('Wix export: Product rows with Variant rows, media ids become wixstatic URLs', () => {
    const table = parseCsv(
      [
        'handleId,fieldType,name,description,productImageUrl,collection,sku,price,inventory,productOptionDescription1',
        'p1,Product,Hydrating Serum,<p>Daily</p>,ab12~mv2.jpg,Skincare,SER-1,48,InStock,',
        'p1,Variant,,,,,SER-30,48,7,30 ml',
        'p1,Variant,,,,,SER-50,64,2,50 ml',
        'p2,Product,Electrolyte Mix,,https://img.example.test/e.png,,EL-1,19,25,',
      ].join('\n')
    )
    expect(detectPreset(table[0]!)).toBe('wix_csv')
    const { items } = fileToItems(table, 'wix_csv')
    expect(items.map((i) => [i.name, i.sku, i.price, i.stock])).toEqual([
      ['Hydrating Serum - 30 ml', 'SER-30', 48, 7],
      ['Hydrating Serum - 50 ml', 'SER-50', 64, 2],
      ['Electrolyte Mix', 'EL-1', 19, 25],
    ])
    expect(items[0]!.imageUrl).toBe('https://static.wixstatic.com/media/ab12~mv2.jpg')
  })

  it('Square item library: stock is summed across location columns, services skipped', () => {
    const table = parseCsv(
      [
        'Token,Item Name,Variation Name,SKU,Description,Category,Price,Current Quantity Main St,Current Quantity Uptown,Item Type,Archived',
        'TK1,Vitamin D3,Regular,VD3,,Supplements,18.00,4,6,Physical good,N',
        'TK2,Collagen Peptides,Unflavored,COL-U,,Supplements,42.00,1,,Physical good,N',
        'TK3,IV Consult,Regular,,,Services,0,,,Appointments service,N',
        'TK4,Old Balm,Regular,OB,,,9,0,0,Physical good,Y',
      ].join('\n')
    )
    expect(detectPreset(table[0]!)).toBe('square_items')
    const { items } = fileToItems(table, 'square_items')
    expect(items.map((i) => [i.externalId, i.name, i.stock])).toEqual([
      ['TK1', 'Vitamin D3', 10],
      ['TK2', 'Collagen Peptides - Unflavored', 1],
    ])
  })

  it('WooCommerce export: simple and variation rows, variable parents skipped', () => {
    const table = parseCsv(
      [
        'ID,Type,SKU,Name,Published,Short description,Description,Stock,Regular price,Sale price,Categories,Tags,Images,Parent',
        '10,simple,PRO-1,Probiotic 50B,1,Gut health,,30,35,29,Supplements,,https://shop.example.test/p.jpg,',
        '11,variable,SPF,Mineral SPF 50,1,Daily sun care,,,,,Skincare,,https://shop.example.test/spf.jpg,',
        '12,variation,SPF-50,Mineral SPF 50 - 50 ml,1,,,8,32,,,,,id:11',
      ].join('\n')
    )
    expect(detectPreset(table[0]!)).toBe('woocommerce_csv')
    const { items } = fileToItems(table, 'woocommerce_csv')
    expect(items.map((i) => [i.externalId, i.name, i.price, i.stock, i.category])).toEqual([
      ['10', 'Probiotic 50B', 35, 30, 'Supplements'],
      ['12', 'Mineral SPF 50 - 50 ml', 32, 8, 'Skincare'],
    ])
    expect(items[1]!.imageUrl).toBe('https://shop.example.test/spf.jpg')
  })

  it('generic: a marketplace seller sheet (Tata 1mg style) is mapped from its headers', () => {
    const headers = [
      'SKU ID',
      'Product Name',
      'Pack Size',
      'MRP',
      'Selling Price',
      'Manufacturer',
      'Quantity',
    ]
    const mapping = guessMapping(headers)
    expect(mapping).toMatchObject({
      sku: 'SKU ID',
      name: 'Product Name',
      variant: 'Pack Size',
      price: 'Selling Price',
      stock: 'Quantity',
    })
    const table = [
      headers,
      ['AB-101', 'Ashwagandha Tablets', '60 tablets', '450', '399', 'Herb Co', '40'],
    ]
    expect(detectPreset(headers)).toBe('generic')
    const { items } = fileToItems(table, 'generic')
    expect(items[0]).toMatchObject({
      externalId: 'AB-101',
      name: 'Ashwagandha Tablets - 60 tablets',
      price: 399,
      stock: 40,
    })
  })

  it('generic: the owner can override a column and must map a name', () => {
    const table = [
      ['Item', 'MRP', 'Code'],
      ['Arnica Gel', '12', 'AR-1'],
    ]
    const { items } = fileToItems(table, 'generic', { name: 'Item', sku: 'Code', price: 'MRP' })
    expect(items[0]).toMatchObject({ name: 'Arnica Gel', sku: 'AR-1', price: 12 })
    const none = fileToItems(
      [
        ['Foo', 'Bar'],
        ['1', '2'],
      ],
      'generic'
    )
    expect(none.items).toEqual([])
    expect(none.warnings[0]).toMatch(/product name/)
  })
})

// ─── Class suggestions ───────────────────────────────────────────────────────

describe('suggestClass', () => {
  const s = (name: string, category: string | null = null, tags: string[] = []) =>
    suggestClass({ name, category, tags })

  it('suggests supplement, aesthetic and OTC from type, tags and name', () => {
    expect(s('Magnesium Glycinate 120 caps').suggested).toBe('SUPPLEMENT')
    expect(s('Daily Glow', 'Skincare').suggested).toBe('AESTHETIC')
    expect(s('Ibuprofen 200', null).suggested).toBe('OTC')
    expect(s('Mystery Box').suggested).toBeNull()
  })

  it('never suggests a class for prescription-like products', () => {
    for (const name of [
      'Semaglutide 2.5mg vial',
      'Testosterone Cypionate',
      'BPC-157 peptide',
      'Botox 100 units',
    ]) {
      expect(s(name, 'Supplements')).toEqual({ suggested: null, rxLike: true })
    }
    expect(s('Thing', null, ['Rx only']).rxLike).toBe(true)
  })
})

// ─── Staging ─────────────────────────────────────────────────────────────────

const item = (over: Partial<NormalizedItem> = {}): NormalizedItem => ({
  externalId: 'ext-1',
  name: 'Magnesium Glycinate',
  sku: 'MAG-400',
  price: 22,
  description: null,
  imageUrl: null,
  stock: 10,
  category: 'Supplements',
  tags: [],
  ...over,
})

const product = (over: Partial<ExistingProduct> = {}): ExistingProduct => ({
  id: 'p1',
  name: 'Magnesium Glycinate',
  sku: 'MAG-400',
  price: 22,
  description: null,
  isActive: true,
  fulfillmentClass: 'SUPPLEMENT',
  externalSource: null,
  externalId: null,
  imageSourceUrl: null,
  stock: 10,
  ...over,
})

const opts = { source: 'SHOPIFY' as const, syncStock: true, syncPrice: true }

describe('stageItems', () => {
  it('creates new products and suggests (but does not choose) a class', () => {
    const [row] = stageItems(
      [item({ name: 'Omega 3', sku: 'OM-3', externalId: 'x' })],
      [product()],
      opts
    )
    expect(row).toMatchObject({ action: 'CREATE', suggestedClass: 'SUPPLEMENT', chosenClass: null })
  })

  it('matches by external id, then SKU, then name', () => {
    const linked = product({
      externalSource: 'SHOPIFY',
      externalId: 'ext-1',
      name: 'Renamed in MedoFlow',
      sku: null,
    })
    expect(stageItems([item()], [linked], opts)[0]).toMatchObject({
      matchedBy: 'EXTERNAL_ID',
      matchedProductId: 'p1',
    })
    expect(stageItems([item({ name: 'Other name' })], [product()], opts)[0]).toMatchObject({
      matchedBy: 'SKU',
    })
    expect(stageItems([item({ sku: null })], [product({ sku: null })], opts)[0]).toMatchObject({
      matchedBy: 'NAME',
    })
  })

  it('a second import of the same data is UNCHANGED once linked', () => {
    const linked = product({ externalSource: 'SHOPIFY', externalId: 'ext-1' })
    expect(stageItems([item()], [linked], opts)[0]!.action).toBe('UNCHANGED')
  })

  it('reports price and stock changes, honouring the sync options', () => {
    const linked = product({ externalSource: 'SHOPIFY', externalId: 'ext-1', price: 20, stock: 4 })
    const [row] = stageItems([item()], [linked], opts)
    expect(row).toMatchObject({
      action: 'UPDATE',
      diff: { price: { from: 20, to: 22 }, stock: { from: 4, to: 10 } },
    })
    const [quiet] = stageItems([item()], [linked], { ...opts, syncStock: false, syncPrice: false })
    expect(quiet!.action).toBe('UNCHANGED')
  })

  it('an unclassified product with a chosen class becomes an UPDATE', () => {
    const linked = product({
      externalSource: 'SHOPIFY',
      externalId: 'ext-1',
      fulfillmentClass: 'UNCLASSIFIED',
    })
    expect(stageItems([{ ...item(), chosenClass: 'OTC' }], [linked], opts)[0]!.action).toBe(
      'UPDATE'
    )
  })

  it('flags conflicts: shared SKU, name clash, two items for one product, already linked', () => {
    const two = [product({ id: 'a', name: 'A' }), product({ id: 'b', name: 'B' })]
    expect(stageItems([item()], two, opts)[0]).toMatchObject({ action: 'CONFLICT' })

    const clash = stageItems(
      [item({ sku: 'NEW', name: 'Taken', externalId: 'n1' })],
      [product({ name: 'Taken', sku: 'OLD', id: 't' })],
      {
        ...opts,
      }
    )
    // Same name and no other match: the name match links it instead of clashing.
    expect(clash[0]!.matchedBy).toBe('NAME')

    const renamedClash = stageItems(
      [{ ...item({ sku: null, externalId: 'n2' }), nameOverride: 'Taken' }],
      [product({ name: 'Taken', sku: null, id: 't' })],
      opts
    )
    expect(renamedClash[0]).toMatchObject({ action: 'CONFLICT' })

    const dup = stageItems(
      [item({ externalId: 'a1' }), item({ externalId: 'a2' })],
      [product()],
      opts
    )
    expect(dup.map((r) => r.action)).toEqual(['UPDATE', 'CONFLICT'])

    const otherLink = product({ externalSource: 'SHOPIFY', externalId: 'someone-else' })
    expect(stageItems([item()], [otherLink], opts)[0]).toMatchObject({ action: 'CONFLICT' })
  })

  it('duplicate names within one import, missing names and missing prices', () => {
    const rows = stageItems(
      [
        item({ externalId: 'n1', name: 'Kit', sku: null }),
        item({ externalId: 'n2', name: 'kit', sku: null }),
        item({ externalId: 'n3', name: '  ', sku: null }),
        item({ externalId: 'n4', name: 'No Price', sku: null, price: null }),
        item({ externalId: 'n1', name: 'Repeat', sku: null }),
      ],
      [],
      opts
    )
    expect(rows.map((r) => [r.action, r.error])).toEqual([
      ['CREATE', null],
      ['CONFLICT', expect.stringMatching(/same name/)],
      ['ERROR', 'No product name'],
      ['ERROR', 'No price'],
      ['ERROR', expect.stringMatching(/twice/)],
    ])
  })

  it('a rename resolves a clash; skipped rows claim nothing', () => {
    const existing = [product({ name: 'Kit', sku: null, id: 'k' })]
    const rows = stageItems(
      [
        { ...item({ externalId: 'n1', name: 'Kit', sku: 'K2' }), nameOverride: 'Kit (travel)' },
        { ...item({ externalId: 'n2', name: 'Kit', sku: null }), skipped: true },
      ],
      existing,
      opts
    )
    expect(rows[0]).toMatchObject({ action: 'CREATE', nameOverride: 'Kit (travel)' })
    expect(rows[1]!.skipped).toBe(true)
    expect(countRows(rows)).toMatchObject({ create: 1, skipped: 1, unclassified: 1 })
  })
})
