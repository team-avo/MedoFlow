/**
 * CTO-40: import a product catalog from a file. Upload a marketplace seller
 * sheet → preview (counts, Rx-like warning) → use the suggested classes →
 * Import → summary, then the Storefront shows the unclassified product with
 * its "Needs classification" picker. Mocked API.
 */
import { expect, test, type Route } from '@playwright/test'
import { installMockApi, ok } from './mockApi'

test('upload a seller sheet, classify, import, and see the result on the Storefront', async ({
  page,
}) => {
  await installMockApi(page, { role: 'SUPER_ADMIN', signedIn: true })

  let status: 'PREVIEW_READY' | 'APPLYING' | 'DONE' = 'PREVIEW_READY'
  let chosen: string | null = null
  const edits: unknown[] = []
  const counts = {
    total: 2,
    create: 2,
    update: 0,
    unchanged: 0,
    conflict: 0,
    error: 0,
    skipped: 0,
    unclassified: 2,
    rxLike: 1,
  }
  const imp = () => ({
    id: 'imp-e2e',
    source: 'CSV',
    preset: 'generic',
    storeConnectionId: null,
    status,
    options: { syncStock: true, syncPrice: true },
    columnMapping: { name: 'Product Name', price: 'Selling Price', sku: 'SKU ID' },
    summary: {
      counts: { ...counts, unclassified: chosen ? 1 : 2 },
      headers: ['SKU ID', 'Product Name', 'Selling Price'],
      ...(status === 'DONE'
        ? {
            result: {
              created: 2,
              updated: 0,
              failed: 0,
              unclassified: 1,
              imagesImported: 0,
              imagesSkipped: 0,
            },
          }
        : {}),
    },
    attempts: 0,
    lastError: null,
    appliedAt: null,
    createdAt: '2026-11-18T10:00:00.000Z',
  })
  const rows = () => [
    {
      id: 'r1',
      position: 0,
      externalId: 'AB-101',
      name: 'Ashwagandha Tablets',
      nameOverride: null,
      sku: 'AB-101',
      price: 399,
      stock: 40,
      imageSourceUrl: null,
      sourceCategory: null,
      suggestedClass: 'SUPPLEMENT',
      chosenClass: chosen,
      rxLike: false,
      skipped: false,
      action: 'CREATE',
      matchedProductId: null,
      matchedBy: null,
      diff: null,
      error: null,
    },
    {
      id: 'r2',
      position: 1,
      externalId: 'TS-1',
      name: 'Testosterone Cream',
      nameOverride: null,
      sku: 'TS-1',
      price: 89,
      stock: 5,
      imageSourceUrl: null,
      sourceCategory: null,
      suggestedClass: null,
      chosenClass: null,
      rxLike: true,
      skipped: false,
      action: 'CREATE',
      matchedProductId: null,
      matchedBy: null,
      diff: null,
      error: null,
    },
  ]

  const handler = async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, '')
    if (path === '/store-connections') {
      return ok(route, {
        providers: [
          { provider: 'SHOPIFY', label: 'Shopify', connectKind: 'oauth', configured: false },
          { provider: 'SQUARE', label: 'Square', connectKind: 'oauth', configured: false },
          {
            provider: 'WOOCOMMERCE',
            label: 'WooCommerce',
            connectKind: 'oauth_or_key',
            configured: true,
          },
          { provider: 'WIX', label: 'Wix', connectKind: 'key', configured: true },
        ],
        connections: [],
      })
    }
    if (path === '/catalog-imports' && req.method() === 'GET') {
      return ok(route, {
        imports: [],
        presets: [{ id: 'generic', label: 'Other platform, marketplace or spreadsheet' }],
        fields: ['name', 'price'],
      })
    }
    if (path === '/catalog-imports/file') return ok(route, { import: imp() })
    if (path === '/catalog-imports/imp-e2e/rows')
      return ok(route, { total: 2, page: 1, pageSize: 50, rows: rows() })
    if (path === '/catalog-imports/imp-e2e' && req.method() === 'PATCH') {
      edits.push(req.postDataJSON())
      chosen = 'SUPPLEMENT'
      return ok(route, { import: imp() })
    }
    if (path === '/catalog-imports/imp-e2e/apply') {
      status = 'APPLYING'
      setTimeout(() => (status = 'DONE'), 300)
      return ok(route, { import: imp() })
    }
    if (path === '/catalog-imports/imp-e2e') return ok(route, { import: imp() })
    return route.fallback()
  }
  await page.route('http://127.0.0.1:3999/api/v1/store-connections**', handler)
  await page.route('http://127.0.0.1:3999/api/v1/catalog-imports**', handler)
  await page.route('http://127.0.0.1:3999/api/v1/products**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback()
    return ok(route, {
      products: [
        {
          id: 'p1',
          name: 'Testosterone Cream',
          price: '89.00',
          fulfillmentClass: 'UNCLASSIFIED',
          externalSource: 'CSV',
          imageUrl: null,
          inventoryItem: { quantityInStock: 5 },
        },
      ],
    })
  })

  await page.goto('/dashboard/products/import')
  await expect(page.getByTestId('connect-shopify')).toContainText('not set up on this server yet')
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'seller.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('SKU ID,Product Name,Selling Price\nAB-101,Ashwagandha Tablets,399\n'),
  })
  await page.getByRole('button', { name: 'Read file' }).click()

  const preview = page.getByTestId('import-preview')
  await expect(preview).toContainText('2 new')
  await expect(preview).toContainText('look like prescription items')
  await expect(preview).toContainText('Suggested: Supplement')
  await expect(page).toHaveURL(/\/dashboard\/products\/import\?id=imp-e2e/)

  await preview.getByRole('button', { name: 'Use the suggested classes' }).click()
  await expect.poll(() => edits.length).toBe(1)
  expect(edits[0]).toEqual({ bulk: { acceptSuggestions: true } })

  await preview.getByRole('button', { name: 'Import 2 products' }).click()
  const done = page.getByTestId('import-done')
  await expect(done).toContainText('2 products added', { timeout: 15_000 })
  await expect(done).toContainText('1 product needs a class')

  await done.getByRole('button', { name: 'Go to the Storefront' }).click()
  await expect(page).toHaveURL(/\/dashboard\/products$/)
  const card = page.getByTestId('needs-classification')
  await expect(card).toContainText('Not for sale until you choose')
  await expect(page.getByText('From a file')).toBeVisible()
})
