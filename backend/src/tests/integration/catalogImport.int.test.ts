/**
 * CTO-40: product catalog import against real Postgres (medoflow_app role,
 * RLS on). Store APIs are stubbed; jobs run in-process.
 *
 *  - a dry run writes staging rows only; apply creates products and stock;
 *  - imported products arrive UNCLASSIFIED: never in a cart, never on the
 *    public storefront, MANUAL in Rx→Cart, until a person classifies them;
 *  - a second import of the same data is all UNCHANGED (idempotent);
 *  - a re-sync updates price and stock, never the class or the name;
 *  - store credentials are field-encrypted at rest and wiped on disconnect;
 *  - the Shopify uninstall webhook disconnects the store;
 *  - another clinic cannot see or touch the import; providers are refused.
 */
import crypto from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'
import {
  setCatalogImportQueueForTests,
  waitForInlineImportJobs,
} from '../../services/catalogImport/service'
import { setProviderFetchForTests } from '../../services/storeConnections/http'
import { setSafeTransportForTests } from '../../services/catalogImport/safeHttp'
import { mapOrdersToCatalog } from '../../services/rxMappingService'
import { withTenantBypass } from '../../config/tenantContext'

let server: TestServer
let fx: ClinicFixture
let other: ClinicFixture
let owner = ''
let otherOwner = ''
let provider = ''
let patient = ''

const WOO_URL = 'https://shop.example.com'
const KEY = `ck_${'a'.repeat(40)}`
const SECRET = `cs_${'b'.repeat(40)}`
let wooProducts: unknown[] = []
const SHOPIFY_SECRET = 'it-shopify-secret'

beforeAll(async () => {
  setCatalogImportQueueForTests(null)
  process.env.SHOPIFY_CLIENT_ID = 'it-shopify-client'
  process.env.SHOPIFY_CLIENT_SECRET = SHOPIFY_SECRET
  // WooCommerce goes through the SSRF-guarded transport: stub it.
  setSafeTransportForTests((url) => {
    const u = new URL(url)
    const json = (data: unknown, headers: Record<string, string> = {}) =>
      Promise.resolve({
        status: 200,
        headers: { 'content-type': 'application/json', ...headers },
        body: Buffer.from(JSON.stringify(data)),
        url,
      })
    if (u.pathname.endsWith('/products') && u.searchParams.get('per_page') === '1') return json([])
    if (u.pathname.endsWith('/products')) return json(wooProducts, { 'x-wp-totalpages': '1' })
    // Images: a 1x1 PNG.
    return Promise.resolve({
      status: 200,
      headers: {},
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      ),
      url,
    })
  })
  setProviderFetchForTests(() => Promise.resolve(new Response('{}', { status: 200 })))
  server = await startServer()
  fx = await createClinicFixture('catimp')
  other = await createClinicFixture('catimp-other')
  owner = (await login(server.url, fx.users.admin.email)).accessToken
  otherOwner = (await login(server.url, other.users.admin.email)).accessToken
  provider = (await login(server.url, fx.users.provider.email)).accessToken
  patient = (await login(server.url, fx.users.patient.email)).accessToken
})

afterAll(async () => {
  setCatalogImportQueueForTests(undefined)
  setSafeTransportForTests(null)
  setProviderFetchForTests(null)
  delete process.env.SHOPIFY_CLIENT_ID
  delete process.env.SHOPIFY_CLIENT_SECRET
  await server.close()
})

const woo = (id: number, name: string, price: string, stock: number, extra: object = {}) => ({
  id,
  name,
  type: 'simple',
  status: 'publish',
  sku: `IT-${id}`,
  regular_price: price,
  manage_stock: true,
  stock_quantity: stock,
  images: [{ src: `https://cdn.example.com/${id}.png` }],
  categories: [{ name: 'Supplements' }],
  ...extra,
})

const getImport = async (id: string) =>
  (await api(server.url, `/catalog-imports/${id}`, { token: owner })).body.data.import

const runImport = async (connectionId: string) => {
  const start = await api(server.url, '/catalog-imports', { token: owner, body: { connectionId } })
  expect(start.status, JSON.stringify(start.body)).toBe(202)
  await waitForInlineImportJobs()
  return getImport(start.body.data.import.id as string)
}

const rowsOf = async (id: string) =>
  (await api(server.url, `/catalog-imports/${id}/rows?pageSize=200`, { token: owner })).body.data
    .rows as {
    id: string
    name: string
    action: string
    suggestedClass: string | null
    chosenClass: string | null
  }[]

const apply = async (id: string) => {
  const res = await api(server.url, `/catalog-imports/${id}/apply`, {
    token: owner,
    method: 'POST',
  })
  expect(res.status, JSON.stringify(res.body)).toBe(202)
  await waitForInlineImportJobs()
  return getImport(id)
}

let connectionId = ''

describe('connecting a WooCommerce store', () => {
  it('a pasted key is tested, stored encrypted, and never returned', async () => {
    const res = await api(server.url, '/store-connections/woocommerce/key', {
      token: owner,
      body: { storeUrl: 'shop.example.com', consumerKey: KEY, consumerSecret: SECRET },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    connectionId = res.body.data.connection.id
    expect(JSON.stringify(res.body)).not.toContain(SECRET)
    const raw = await adminDb.storeConnection.findUniqueOrThrow({ where: { id: connectionId } })
    expect(raw.externalAccountId).toBe(WOO_URL)
    expect(raw.accessToken).toMatch(/^fle:v1:/)
    expect(raw.accessToken).not.toContain(SECRET)
  })

  it('a private store address is refused', async () => {
    const res = await api(server.url, '/store-connections/woocommerce/key', {
      token: owner,
      body: { storeUrl: 'https://192.168.1.20', consumerKey: KEY, consumerSecret: SECRET },
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/private/)
  })

  it('providers cannot manage store connections; other clinics cannot see them', async () => {
    expect((await api(server.url, '/store-connections', { token: provider })).status).toBe(403)
    const list = await api(server.url, '/store-connections', { token: otherOwner })
    expect(list.body.data.connections).toEqual([])
  })
})

let firstImportId = ''

describe('importing from the store', () => {
  it('the dry run stages rows and writes no products', async () => {
    wooProducts = [
      woo(1, 'Magnesium Glycinate', '22.00', 10),
      woo(2, 'Semaglutide 2.5 mg vial', '199.00', 3, { categories: [{ name: 'Weight' }] }),
    ]
    const before = await adminDb.product.count({ where: { clinicId: fx.clinicId } })
    const imp = await runImport(connectionId)
    expect(imp.status, imp.lastError).toBe('PREVIEW_READY')
    firstImportId = imp.id
    expect(imp.summary.counts).toMatchObject({ create: 2, rxLike: 1 })
    expect(await adminDb.product.count({ where: { clinicId: fx.clinicId } })).toBe(before)
    const rows = await rowsOf(imp.id)
    const mag = rows.find((r) => r.name === 'Magnesium Glycinate')!
    const sema = rows.find((r) => r.name.startsWith('Semaglutide'))!
    expect(mag.suggestedClass).toBe('SUPPLEMENT')
    expect(sema.suggestedClass).toBeNull()
  })

  it('another clinic cannot read or apply the import', async () => {
    expect(
      (await api(server.url, `/catalog-imports/${firstImportId}`, { token: otherOwner })).status
    ).toBe(404)
    const res = await api(server.url, `/catalog-imports/${firstImportId}/apply`, {
      token: otherOwner,
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  it('apply creates UNCLASSIFIED products with stock and a re-hosted photo', async () => {
    const done = await apply(firstImportId)
    expect(done.status, done.lastError).toBe('DONE')
    expect(done.summary.result).toMatchObject({ created: 2, unclassified: 2, imagesImported: 2 })
    const products = await adminDb.product.findMany({
      where: { clinicId: fx.clinicId, externalSource: 'WOOCOMMERCE' },
      include: { inventoryItem: true },
      orderBy: { name: 'asc' },
    })
    expect(
      products.map((p) => [p.name, p.fulfillmentClass, p.inventoryItem?.quantityInStock])
    ).toEqual([
      ['Magnesium Glycinate', 'UNCLASSIFIED', 10],
      ['Semaglutide 2.5 mg vial', 'UNCLASSIFIED', 3],
    ])
    expect(products[0]!.imageAssetId).toBeTruthy()
    const asset = await adminDb.siteAsset.findUniqueOrThrow({
      where: { id: products[0]!.imageAssetId! },
    })
    expect(asset).toMatchObject({
      clinicId: fx.clinicId,
      status: 'AVAILABLE',
      mimeType: 'image/png',
    })
    const audit = await adminDb.auditLog.findFirst({
      where: { clinicId: fx.clinicId, action: 'CATALOG_IMPORT_APPLIED', entityId: firstImportId },
    })
    expect(audit).not.toBeNull()
  })

  it('unclassified products are never sold: cart 422, absent from the public storefront, MANUAL in Rx→Cart', async () => {
    const mag = await adminDb.product.findFirstOrThrow({
      where: { clinicId: fx.clinicId, name: 'Magnesium Glycinate' },
    })
    const add = await api(server.url, '/carts/items', {
      token: patient,
      body: { itemType: 'PRODUCT', itemId: mag.id, quantity: 1 },
    })
    expect(add.status, JSON.stringify(add.body)).toBe(422)
    expect(add.body.code).toBe('PRODUCT_UNCLASSIFIED')

    const pub = await api(server.url, `/public/clinics/${fx.clinicId}/products`)
    const names = ((pub.body.data?.products ?? []) as { name: string }[]).map((p) => p.name)
    expect(names).not.toContain('Magnesium Glycinate')
    expect((await api(server.url, `/public/products/${mag.id}`)).status).toBe(404)

    const [line] = await withTenantBypass('test', () =>
      mapOrdersToCatalog(fx.clinicId, [{ name: 'magnesium glycinate 400 mg' }])
    )
    expect(line).toMatchObject({ matchedProductId: mag.id, route: 'MANUAL' })
  })

  it('classifying on the Storefront makes it sellable', async () => {
    const mag = await adminDb.product.findFirstOrThrow({
      where: { clinicId: fx.clinicId, name: 'Magnesium Glycinate' },
    })
    const put = await api(server.url, `/products/${mag.id}`, {
      token: owner,
      method: 'PUT',
      body: { fulfillmentClass: 'SUPPLEMENT' },
    })
    expect(put.status, JSON.stringify(put.body)).toBe(200)
    const add = await api(server.url, '/carts/items', {
      token: patient,
      body: { itemType: 'PRODUCT', itemId: mag.id, quantity: 1 },
    })
    expect(add.status, JSON.stringify(add.body)).toBe(201)
    const [line] = await withTenantBypass('test', () =>
      mapOrdersToCatalog(fx.clinicId, [{ name: 'IT-1' }])
    )
    expect(line).toMatchObject({ matchedProductId: mag.id, route: 'CART' })
  })

  it('importing the same data again is all UNCHANGED', async () => {
    const imp = await runImport(connectionId)
    expect(imp.summary.counts).toMatchObject({ unchanged: 2, create: 0, update: 0 })
  })

  it('a re-sync updates price and stock but never the class or the owner’s rename', async () => {
    await adminDb.product.updateMany({
      where: { clinicId: fx.clinicId, name: 'Magnesium Glycinate' },
      data: { name: 'Magnesium (house brand)' },
    })
    wooProducts = [
      woo(1, 'Magnesium Glycinate', '24.50', 4),
      woo(2, 'Semaglutide 2.5 mg vial', '199.00', 3),
    ]
    const imp = await runImport(connectionId)
    expect(imp.summary.counts).toMatchObject({ update: 1, unchanged: 1 })
    const done = await apply(imp.id)
    expect(done.status).toBe('DONE')
    const mag = await adminDb.product.findFirstOrThrow({
      where: { clinicId: fx.clinicId, externalId: '1', externalSource: 'WOOCOMMERCE' },
      include: { inventoryItem: true },
    })
    expect(mag).toMatchObject({ name: 'Magnesium (house brand)', fulfillmentClass: 'SUPPLEMENT' })
    expect(Number(mag.price)).toBe(24.5)
    expect(mag.inventoryItem?.quantityInStock).toBe(4)
  })

  it('choosing a class in the preview imports the product already classified', async () => {
    wooProducts = [woo(3, 'Arnica Gel', '12.00', 5, { categories: [{ name: 'Pain relief' }] })]
    const imp = await runImport(connectionId)
    const [row] = (await rowsOf(imp.id)).filter((r) => r.name === 'Arnica Gel')
    const edit = await api(server.url, `/catalog-imports/${imp.id}`, {
      token: owner,
      method: 'PATCH',
      body: { bulk: { acceptSuggestions: true } },
    })
    expect(edit.status, JSON.stringify(edit.body)).toBe(200)
    const after = (await rowsOf(imp.id)).find((r) => r.id === row!.id)!
    expect(after.chosenClass).toBe('OTC')
    await apply(imp.id)
    const arnica = await adminDb.product.findFirstOrThrow({
      where: { clinicId: fx.clinicId, name: 'Arnica Gel' },
    })
    expect(arnica.fulfillmentClass).toBe('OTC')
  })
})

describe('file import', () => {
  it('a generic marketplace sheet is previewed and applied', async () => {
    const csv = [
      'SKU ID,Product Name,Pack Size,MRP,Selling Price,Quantity',
      'MK-1,Vitamin B12 Drops,30 ml,350,299,12',
      'MK-2,Vitamin B12 Drops,60 ml,600,549,0',
    ].join('\n')
    const form = new FormData()
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'seller.csv')
    form.append('preset', 'auto')
    const res = await fetch(`${server.url}/catalog-imports/file`, {
      method: 'POST',
      headers: { authorization: `Bearer ${owner}`, 'x-medoflow-client': 'web' },
      body: form,
    })
    const body = (await res.json()) as {
      data: { import: { id: string; preset: string; summary: { counts: Record<string, number> } } }
    }
    expect(res.status, JSON.stringify(body)).toBe(201)
    expect(body.data.import.preset).toBe('generic')
    expect(body.data.import.summary.counts).toMatchObject({ create: 2 })
    const done = await apply(body.data.import.id)
    expect(done.summary.result).toMatchObject({ created: 2 })
    const b12 = await adminDb.product.findFirstOrThrow({
      where: { clinicId: fx.clinicId, name: 'Vitamin B12 Drops - 30 ml' },
    })
    expect(Number(b12.price)).toBe(299)
    expect(b12.externalSource).toBe('CSV')
  })
})

describe('disconnecting', () => {
  it('wipes the credentials and keeps the imported products', async () => {
    const res = await api(server.url, `/store-connections/${connectionId}/disconnect`, {
      token: owner,
      method: 'POST',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.ownerAction).toMatch(/WooCommerce/)
    const raw = await adminDb.storeConnection.findUniqueOrThrow({ where: { id: connectionId } })
    expect(raw).toMatchObject({ status: 'DISCONNECTED', accessToken: null, refreshToken: null })
    expect(
      await adminDb.product.count({
        where: { clinicId: fx.clinicId, externalSource: 'WOOCOMMERCE' },
      })
    ).toBe(3)
    const again = await api(server.url, '/catalog-imports', {
      token: owner,
      body: { connectionId },
    })
    expect(again.status).toBe(409)
  })

  it('the Shopify uninstall webhook disconnects every connection to that shop', async () => {
    const shop = 'it-demo.myshopify.com'
    const conn = await adminDb.storeConnection.create({
      data: {
        clinicId: fx.clinicId,
        provider: 'SHOPIFY',
        externalAccountId: shop,
        displayName: 'it-demo',
        accessToken: 'fle-not-needed-for-this-test',
        connectedById: fx.users.admin.id,
      },
    })
    const body = JSON.stringify({ domain: shop })
    const sig = crypto.createHmac('sha256', SHOPIFY_SECRET).update(body).digest('base64')
    const bad = await api(server.url, '/webhooks/shopify', {
      body,
      headers: {
        'x-shopify-hmac-sha256': 'nope',
        'x-shopify-topic': 'app/uninstalled',
        'x-shopify-shop-domain': shop,
      },
    })
    expect(bad.status).toBe(401)
    const ok = await api(server.url, '/webhooks/shopify', {
      body,
      headers: {
        'x-shopify-hmac-sha256': sig,
        'x-shopify-topic': 'app/uninstalled',
        'x-shopify-shop-domain': shop,
      },
    })
    expect(ok.status).toBe(200)
    const raw = await adminDb.storeConnection.findUniqueOrThrow({ where: { id: conn.id } })
    expect(raw).toMatchObject({ status: 'DISCONNECTED', accessToken: null })
  })
})
