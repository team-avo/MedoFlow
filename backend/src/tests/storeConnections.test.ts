/**
 * CTO-40: store connectors (pure parts) and their security checks: the signed
 * OAuth state, Shopify HMACs, address validation and the SSRF guard.
 * Recorded-style responses are synthetic.
 */
import crypto from 'crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { signState, verifyState, STATE_TTL_MS } from '../services/storeConnections/state'
import {
  normalizeShop,
  shopifyItems,
  verifyShopifyCallback,
  verifyShopifyWebhook,
} from '../services/storeConnections/shopify'
import { squareItems } from '../services/storeConnections/square'
import { isWooKey, normalizeStoreUrl, wooItems } from '../services/storeConnections/wooCommerce'
import { isWixSiteId, wixV1Items, wixV3Items } from '../services/storeConnections/wix'
import {
  assertSafeUrl,
  isPublicAddress,
  safeRequest,
  setSafeTransportForTests,
} from '../services/catalogImport/safeHttp'
import { importProductImage } from '../services/catalogImport/imageImport'
import { ImportSourceError } from '../services/catalogImport/types'

afterEach(() => setSafeTransportForTests(null))

// ─── Signed state ────────────────────────────────────────────────────────────

describe('connect state', () => {
  const base = {
    clinicId: 'c1',
    userId: 'u1',
    provider: 'SHOPIFY' as const,
    account: 'demo.myshopify.com',
  }

  it('round-trips and carries the account', () => {
    expect(verifyState(signState(base))).toMatchObject(base)
  })

  it('refuses tampered, re-signed-by-guess, malformed and expired states', () => {
    const s = signState(base)
    const [body, mac] = s.split('.')
    const forged = Buffer.from(
      JSON.stringify({ ...base, clinicId: 'other', nonce: 'n', exp: Date.now() + 60_000 })
    ).toString('base64url')
    expect(verifyState(`${forged}.${mac}`)).toBeNull()
    expect(verifyState(`${body}.${mac}x`)).toBeNull()
    expect(verifyState(`${body}`)).toBeNull()
    expect(verifyState(`${s}.extra`)).toBeNull()
    expect(verifyState(42)).toBeNull()
    const old = signState(base, Date.now() - STATE_TTL_MS - 1_000)
    expect(verifyState(old)).toBeNull()
  })
})

// ─── Shopify ─────────────────────────────────────────────────────────────────

describe('Shopify', () => {
  const secret = 'test-shopify-secret'

  it('normalises shop addresses and refuses anything else', () => {
    expect(normalizeShop('Demo-Store')).toBe('demo-store.myshopify.com')
    expect(normalizeShop('https://demo-store.myshopify.com/admin/products')).toBe(
      'demo-store.myshopify.com'
    )
    expect(normalizeShop('evil.example.com')).toBeNull()
    expect(normalizeShop('demo.myshopify.com.evil.test')).toBeNull()
    expect(normalizeShop('')).toBeNull()
  })

  it('verifies the OAuth callback HMAC', () => {
    const query: Record<string, string> = {
      code: 'abc',
      shop: 'demo.myshopify.com',
      state: 's',
      timestamp: '1',
    }
    const message = Object.keys(query)
      .sort()
      .map((k) => `${k}=${query[k]}`)
      .join('&')
    const hmac = crypto.createHmac('sha256', secret).update(message).digest('hex')
    expect(verifyShopifyCallback({ ...query, hmac }, secret)).toBe(true)
    expect(verifyShopifyCallback({ ...query, code: 'changed', hmac }, secret)).toBe(false)
    expect(verifyShopifyCallback(query, secret)).toBe(false)
    expect(verifyShopifyCallback({ ...query, hmac }, undefined)).toBe(false)
  })

  it('verifies webhook bodies', () => {
    const body = Buffer.from('{"shop_domain":"demo.myshopify.com"}')
    const good = crypto.createHmac('sha256', secret).update(body).digest('base64')
    expect(verifyShopifyWebhook(body, good, secret)).toBe(true)
    expect(verifyShopifyWebhook(Buffer.from('{}'), good, secret)).toBe(false)
    expect(verifyShopifyWebhook(body, undefined, secret)).toBe(false)
  })

  it('flattens variants and pages with the cursor', () => {
    const page = shopifyItems({
      products: {
        pageInfo: { hasNextPage: true, endCursor: 'CUR1' },
        nodes: [
          {
            id: 'gid://shopify/Product/1',
            title: 'Collagen',
            description: 'Unflavoured',
            productType: 'Supplements',
            tags: ['protein'],
            status: 'ACTIVE',
            featuredMedia: { preview: { image: { url: 'https://cdn.shopify.com/c.png' } } },
            variants: {
              nodes: [
                {
                  id: 'gid://shopify/ProductVariant/11',
                  title: '300 g',
                  sku: 'COL-300',
                  price: '39.00',
                  inventoryQuantity: 5,
                },
                {
                  id: 'gid://shopify/ProductVariant/12',
                  title: '600 g',
                  sku: 'COL-600',
                  price: '69.00',
                  inventoryQuantity: -2,
                },
              ],
            },
          },
          {
            id: 'gid://shopify/Product/2',
            title: 'Retired',
            status: 'ARCHIVED',
            variants: { nodes: [{ id: 'gid://shopify/ProductVariant/21', price: '1.00' }] },
          },
          {
            id: 'gid://shopify/Product/3',
            title: 'Arnica Gel',
            status: 'ACTIVE',
            variants: {
              nodes: [
                { id: 'gid://shopify/ProductVariant/31', title: 'Default Title', price: '12.00' },
              ],
            },
          },
        ],
      },
    })
    expect(page.next).toBe('CUR1')
    expect(page.items.map((i) => [i.externalId, i.name, i.price, i.stock])).toEqual([
      ['gid://shopify/ProductVariant/11', 'Collagen - 300 g', 39, 5],
      ['gid://shopify/ProductVariant/12', 'Collagen - 600 g', 69, 0],
      ['gid://shopify/ProductVariant/31', 'Arnica Gel', 12, null],
    ])
    expect(page.items[0]!.imageUrl).toBe('https://cdn.shopify.com/c.png')
  })
})

// ─── Square ──────────────────────────────────────────────────────────────────

describe('Square', () => {
  it('turns catalog items into products with images, categories and summed stock', () => {
    const items = squareItems(
      [
        {
          type: 'ITEM',
          id: 'I1',
          item_data: {
            name: 'Vitamin D3',
            image_ids: ['IMG1'],
            categories: [{ id: 'CAT1' }],
            variations: [
              {
                id: 'V1',
                item_variation_data: {
                  name: 'Regular',
                  sku: 'VD3',
                  price_money: { amount: 1800, currency: 'USD' },
                },
              },
            ],
          },
        },
        {
          type: 'ITEM',
          id: 'I2',
          item_data: {
            name: 'Electrolytes',
            variations: [
              { id: 'V2', item_variation_data: { name: 'Lemon', price_money: { amount: 2500 } } },
              { id: 'V3', item_variation_data: { name: 'Berry', price_money: { amount: 2500 } } },
              { id: 'V4', is_deleted: true },
            ],
          },
        },
        {
          type: 'ITEM',
          id: 'I3',
          item_data: {
            name: 'Consult',
            product_type: 'APPOINTMENTS_SERVICE',
            variations: [{ id: 'V5' }],
          },
        },
        {
          type: 'ITEM',
          id: 'I4',
          is_deleted: true,
          item_data: { name: 'Gone', variations: [{ id: 'V6' }] },
        },
      ],
      [
        {
          type: 'IMAGE',
          id: 'IMG1',
          image_data: { url: 'https://items-images.example.test/vd3.png' },
        },
        { type: 'CATEGORY', id: 'CAT1', category_data: { name: 'Supplements' } },
      ],
      new Map([
        ['V1', 7],
        ['V2', 0],
      ])
    )
    expect(items.map((i) => [i.externalId, i.name, i.price, i.stock, i.category])).toEqual([
      ['V1', 'Vitamin D3', 18, 7, 'Supplements'],
      ['V2', 'Electrolytes - Lemon', 25, 0, null],
      ['V3', 'Electrolytes - Berry', 25, null, null],
    ])
    expect(items[0]!.imageUrl).toBe('https://items-images.example.test/vd3.png')
  })
})

// ─── WooCommerce ─────────────────────────────────────────────────────────────

describe('WooCommerce', () => {
  it('normalises store URLs and refuses private or non-https ones', () => {
    expect(normalizeStoreUrl('shop.example.com/wp-admin/')).toBe('https://shop.example.com')
    expect(normalizeStoreUrl('https://example.com/store/')).toBe('https://example.com/store')
    expect(() => normalizeStoreUrl('http://shop.example.com')).toThrow(ImportSourceError)
    expect(() => normalizeStoreUrl('https://localhost')).toThrow(/private/)
    expect(() => normalizeStoreUrl('https://10.0.0.5')).toThrow(/private/)
  })

  it('recognises key shapes', () => {
    expect(isWooKey(`ck_${'a'.repeat(40)}`, `cs_${'b'.repeat(40)}`)).toBe(true)
    expect(isWooKey('ck_short', `cs_${'b'.repeat(40)}`)).toBe(false)
  })

  it('maps simple and variable products, skipping drafts and grouped products', () => {
    expect(
      wooItems({
        id: 5,
        name: 'Probiotic',
        type: 'simple',
        status: 'publish',
        sku: 'PB',
        regular_price: '30',
        price: '25',
        manage_stock: true,
        stock_quantity: 9,
        images: [{ src: 'https://shop.example.test/p.jpg' }],
        categories: [{ name: 'Supplements' }],
      })
    ).toEqual([
      expect.objectContaining({
        externalId: '5',
        name: 'Probiotic',
        price: 30,
        stock: 9,
        category: 'Supplements',
        imageUrl: 'https://shop.example.test/p.jpg',
      }),
    ])
    expect(wooItems({ id: 6, name: 'Draft', type: 'simple', status: 'draft', price: '1' })).toEqual(
      []
    )
    expect(wooItems({ id: 7, name: 'Bundle', type: 'grouped', status: 'publish' })).toEqual([])
    const variable = wooItems(
      {
        id: 8,
        name: 'SPF 50',
        type: 'variable',
        status: 'publish',
        manage_stock: true,
        stock_quantity: 4,
      },
      [
        {
          id: 81,
          sku: 'SPF-50',
          regular_price: '32',
          manage_stock: true,
          stock_quantity: 2,
          attributes: [{ name: 'Size', option: '50 ml' }],
        },
        {
          id: 82,
          sku: 'SPF-100',
          regular_price: '52',
          manage_stock: 'parent',
          attributes: [{ name: 'Size', option: '100 ml' }],
        },
      ]
    )
    expect(variable.map((i) => [i.externalId, i.name, i.price, i.stock])).toEqual([
      ['81', 'SPF 50 - 50 ml', 32, 2],
      ['82', 'SPF 50 - 100 ml', 52, 4],
    ])
  })
})

// ─── Wix ─────────────────────────────────────────────────────────────────────

describe('Wix', () => {
  it('validates site ids', () => {
    expect(isWixSiteId('0a1b2c3d-1111-2222-3333-444455556666')).toBe(true)
    expect(isWixSiteId('not-a-site')).toBe(false)
  })

  it('reads catalog V1 products, with managed variants flattened', () => {
    const items = wixV1Items([
      {
        id: 'w1',
        name: 'Night Cream',
        sku: 'NC',
        priceData: { price: 55 },
        stock: { trackInventory: true, quantity: 3 },
        media: { mainMedia: { image: { url: 'https://static.wixstatic.com/media/nc.jpg' } } },
        description: '<p>Rich</p>',
      },
      {
        id: 'w2',
        name: 'Greens',
        manageVariants: true,
        priceData: { price: 40 },
        variants: [
          {
            id: 'v1',
            choices: { Flavor: 'Mint' },
            variant: { priceData: { price: 40 }, sku: 'GR-M' },
            stock: { trackQuantity: true, quantity: 6 },
          },
          {
            id: 'v2',
            choices: { Flavor: 'Berry' },
            variant: { priceData: { price: 42 }, sku: 'GR-B' },
            stock: { trackQuantity: false },
          },
        ],
      },
      { id: 'w3', name: 'E-book', productType: 'digital', priceData: { price: 5 } },
    ])
    expect(items.map((i) => [i.externalId, i.name, i.price, i.stock])).toEqual([
      ['w1', 'Night Cream', 55, 3],
      ['w2:v1', 'Greens - Mint', 40, 6],
      ['w2:v2', 'Greens - Berry', 42, null],
    ])
    expect(items[0]!.description).toBe('Rich')
  })

  it('reads catalog V3 products (no stock in the product read)', () => {
    const items = wixV3Items([
      {
        id: 'p3',
        name: 'Hair Serum',
        plainDescription: 'Light',
        media: { main: { image: 'https://static.wixstatic.com/media/hs.jpg' } },
        variantsInfo: {
          variants: [{ id: 'only', sku: 'HS', price: { actualPrice: { amount: '29.5' } } }],
        },
      },
    ])
    expect(items).toEqual([
      expect.objectContaining({
        externalId: 'p3',
        name: 'Hair Serum',
        price: 29.5,
        stock: null,
        imageUrl: 'https://static.wixstatic.com/media/hs.jpg',
      }),
    ])
  })
})

// ─── SSRF guard ──────────────────────────────────────────────────────────────

describe('SSRF guard', () => {
  it('classifies public and private addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
      expect(isPublicAddress(ip)).toBe(true)
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:10.0.0.1',
      '::ffff:127.0.0.1',
      '64:ff9b::a00:1',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(ip)).toBe(false)
    }
  })

  it('refuses unsafe URL shapes before any network call', () => {
    for (const url of [
      'http://example.com/a.png',
      'https://user:pw@example.com/',
      'https://example.com:8443/',
      'https://localhost/',
      'https://metadata.internal/',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://169.254.169.254/latest/meta-data',
      'file:///etc/passwd',
      'https://intranet/',
    ]) {
      expect(() => assertSafeUrl(url), url).toThrow(ImportSourceError)
    }
    expect(assertSafeUrl('https://cdn.example.com/a.png').hostname).toBe('cdn.example.com')
  })

  it('safeRequest checks the URL even when the network is replaced', async () => {
    let called = false
    setSafeTransportForTests(() => {
      called = true
      return Promise.resolve({ status: 200, headers: {}, body: Buffer.alloc(0), url: '' })
    })
    await expect(safeRequest('https://10.0.0.1/x')).rejects.toThrow(/private/)
    expect(called).toBe(false)
  })

  it('an image import from a private address is skipped, not fetched', async () => {
    const res = await importProductImage('c1', 'u1', 'https://192.168.0.10/photo.png', 'Photo')
    expect(res).toEqual({ skipped: expect.stringMatching(/private/) })
  })
})
