/**
 * B5.1 mapping layer + B5.5 routing: scribe orders → clinic SKUs.
 * Pure functions: no database.
 */
import assert from 'node:assert/strict'
import {
  mapOrders,
  parseScribeOrders,
  routeFor,
  MAX_ORDERS,
  type CatalogProduct,
} from '../services/rxMappingService'

const catalog: CatalogProduct[] = [
  {
    id: 'p_mag',
    name: 'Magnesium Glycinate',
    sku: 'MAG-400',
    aliases: ['mag glycinate'],
    fulfillmentClass: 'SUPPLEMENT',
  },
  {
    id: 'p_vitd',
    name: 'Vitamin D3 2000 IU',
    sku: 'VD3-2000',
    aliases: ['cholecalciferol'],
    fulfillmentClass: 'SUPPLEMENT',
  },
  { id: 'p_arnica', name: 'Arnica Gel', sku: null, aliases: [], fulfillmentClass: 'OTC' },
  {
    id: 'p_retinol',
    name: 'Retinol Night Serum',
    sku: 'RET-30',
    aliases: [],
    fulfillmentClass: 'AESTHETIC',
  },
  {
    id: 'p_tramadol',
    name: 'Tramadol',
    sku: 'TRAM-50',
    aliases: [],
    fulfillmentClass: 'RX_SCHEDULED',
  },
  {
    id: 'p_tret',
    name: 'Tretinoin Cream',
    sku: null,
    aliases: [],
    fulfillmentClass: 'RX_NON_SCHEDULED',
  },
  {
    id: 'p_omega_a',
    name: 'Omega 3 Softgels',
    sku: null,
    aliases: [],
    fulfillmentClass: 'SUPPLEMENT',
  },
  {
    id: 'p_omega_b',
    name: 'Omega 3 Liquid',
    sku: null,
    aliases: [],
    fulfillmentClass: 'SUPPLEMENT',
  },
]

describe('mapOrders (B5.1)', () => {
  it('maps a sample scribe orders array to the correct clinic SKUs', () => {
    const lines = mapOrders(
      [
        { name: 'Magnesium glycinate 400 mg at night', quantity: 2 },
        { name: 'VD3-2000', quantity: 1 },
        { name: 'cholecalciferol', quantity: 3 },
        { name: 'arnica gel', quantity: 1 },
        { name: 'Serum, retinol night', quantity: 1 },
      ],
      catalog
    )
    assert.deepEqual(
      lines.map((l) => [l.matchedProductId, l.matchStatus, l.route, l.quantity]),
      [
        ['p_mag', 'MATCHED', 'CART', 2], // name mentioned inside the order text
        ['p_vitd', 'MATCHED', 'CART', 1], // SKU
        ['p_vitd', 'MATCHED', 'CART', 3], // alias
        ['p_arnica', 'MATCHED', 'CART', 1], // exact, case-insensitive
        ['p_retinol', 'MATCHED', 'CART', 1], // token overlap, different word order
      ]
    )
  })

  it('surfaces unmapped items for manual handling instead of dropping them', () => {
    const orders = [
      { name: 'Magnesium glycinate', quantity: 1 },
      { name: 'Ashwagandha root extract', quantity: 1 },
      { name: 'Turmeric complex', quantity: 2 },
    ]
    const lines = mapOrders(orders, catalog)
    // Never silently dropped: one line per order, in order.
    assert.equal(lines.length, orders.length)
    assert.deepEqual(
      lines.map((l) => l.rawText),
      orders.map((o) => o.name)
    )
    for (const unmapped of lines.slice(1)) {
      assert.equal(unmapped.matchStatus, 'UNMAPPED')
      assert.equal(unmapped.route, 'MANUAL')
      assert.equal(unmapped.matchedProductId, null)
    }
    assert.equal(lines[2]!.quantity, 2)
  })

  it('reports a tie as AMBIGUOUS and routes it to MANUAL, it never guesses', () => {
    const [line] = mapOrders([{ name: 'Omega 3', quantity: 1 }], catalog)
    assert.equal(line!.matchStatus, 'AMBIGUOUS')
    assert.equal(line!.route, 'MANUAL')
    assert.equal(line!.matchedProductId, null)
    assert.deepEqual([...line!.candidateIds].sort(), ['p_omega_a', 'p_omega_b'])

    // A shortened name that fits exactly one product is a match.
    const [short] = mapOrders([{ name: 'Retinol', quantity: 1 }], catalog)
    assert.equal(short!.matchedProductId, 'p_retinol')
  })

  it('routes prescription products to e-prescribe, never the cart (B5.5)', () => {
    const lines = mapOrders(
      [
        { name: 'Tramadol 50 mg for bad nights', quantity: 1 },
        { name: 'tretinoin cream', quantity: 1 },
      ],
      catalog
    )
    assert.deepEqual(
      lines.map((l) => [l.matchedProductId, l.route]),
      [
        ['p_tramadol', 'EPRESCRIBE'],
        ['p_tret', 'EPRESCRIBE'],
      ]
    )
  })

  it('an empty catalog maps every order to MANUAL', () => {
    const lines = mapOrders([{ name: 'Magnesium', quantity: 1 }], [])
    assert.equal(lines[0]!.route, 'MANUAL')
  })

  it('routeFor sends only supplement/OTC/aesthetic to the cart', () => {
    assert.equal(routeFor('SUPPLEMENT'), 'CART')
    assert.equal(routeFor('OTC'), 'CART')
    assert.equal(routeFor('AESTHETIC'), 'CART')
    assert.equal(routeFor('RX_NON_SCHEDULED'), 'EPRESCRIBE')
    assert.equal(routeFor('RX_SCHEDULED'), 'EPRESCRIBE')
    // CTO-40: an imported product nobody has classified is never sold.
    assert.equal(routeFor('UNCLASSIFIED'), 'MANUAL')
  })
})

describe('parseScribeOrders', () => {
  it('accepts the shapes an LLM produces and clamps quantities', () => {
    const orders = parseScribeOrders([
      'Arnica gel',
      { name: 'Magnesium', quantity: 2 },
      { product: 'Vitamin D', qty: '3' },
      { item: 'Fish oil', quantity: 0 },
      { medication: 'Zinc', quantity: 5000 },
      { name: '   ' },
      42,
      null,
    ])
    assert.deepEqual(orders, [
      { name: 'Arnica gel', dose: null, quantity: 1 },
      { name: 'Magnesium', dose: null, quantity: 2 },
      { name: 'Vitamin D', dose: null, quantity: 3 },
      { name: 'Fish oil', dose: null, quantity: 1 },
      { name: 'Zinc', dose: null, quantity: 99 },
    ])
  })

  it('B2.2: keeps the dose separate from the name (dose / strength / dosage)', () => {
    const orders = parseScribeOrders([
      { name: 'Magnesium glycinate', dose: '400 mg', quantity: 2 },
      { name: 'Vitamin D3', strength: '5000 IU' },
      { name: 'Zinc', dosage: 25 },
      { name: 'Arnica gel', dose: '   ' },
      { name: 'Fish oil', dose: { amount: 1 } },
    ])
    assert.deepEqual(orders, [
      { name: 'Magnesium glycinate', dose: '400 mg', quantity: 2 },
      { name: 'Vitamin D3', dose: '5000 IU', quantity: 1 },
      { name: 'Zinc', dose: '25', quantity: 1 },
      { name: 'Arnica gel', dose: null, quantity: 1 },
      { name: 'Fish oil', dose: null, quantity: 1 },
    ])
  })

  it('B2.2: a mapped line carries the dose through to the proposal', () => {
    const [line] = mapOrders([{ name: 'Magnesium glycinate', dose: '400 mg', quantity: 2 }], [])
    assert.equal(line!.dose, '400 mg')
    assert.equal(line!.rawText, 'Magnesium glycinate')
    assert.equal(line!.matchStatus, 'UNMAPPED')
  })

  it('CTO-40: an imported catalog maps by name and SKU; unclassified items route to MANUAL', () => {
    const imported: CatalogProduct[] = [
      {
        id: 'imp_col',
        name: 'Collagen Peptides - Unflavored',
        sku: 'COL-U',
        aliases: [],
        fulfillmentClass: 'SUPPLEMENT',
      },
      {
        id: 'imp_spf',
        name: 'Mineral SPF 50 - 50 ml',
        sku: 'SPF-50',
        aliases: [],
        fulfillmentClass: 'UNCLASSIFIED',
      },
    ]
    const [bySku, byName, unclassified] = mapOrders(
      [
        { name: 'COL-U one scoop daily' },
        { name: 'collagen peptides' },
        { name: 'mineral spf 50' },
      ],
      imported
    )
    assert.equal(bySku!.matchedProductId, 'imp_col')
    assert.equal(bySku!.route, 'CART')
    assert.equal(byName!.matchedProductId, 'imp_col')
    assert.equal(unclassified!.matchedProductId, 'imp_spf')
    assert.equal(unclassified!.matchStatus, 'MATCHED')
    assert.equal(unclassified!.route, 'MANUAL')
  })

  it('returns [] for anything that is not an array, and caps the count', () => {
    assert.deepEqual(parseScribeOrders(undefined), [])
    assert.deepEqual(parseScribeOrders('magnesium'), [])
    const many = parseScribeOrders(Array.from({ length: 60 }, (_, i) => `Item ${i}`))
    assert.equal(many.length, MAX_ORDERS)
  })
})
