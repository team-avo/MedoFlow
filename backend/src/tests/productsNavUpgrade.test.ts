/**
 * WS3 — upgrading an existing site to the Products / Medicine store defaults
 * (src/site/services/productsNavUpgrade.ts, used by
 * scripts/site-add-products-nav.ts): adds what's missing, keeps the clinic's
 * own choices, and is idempotent.
 */
import { describe, expect, it } from 'vitest'
import { upgradeSiteForProducts } from '../site/services/productsNavUpgrade'
import { defaultSiteSettings } from '../site/content/settings'

const legacySettings = () => {
  const s = structuredClone(defaultSiteSettings()) as Record<string, any>
  s.header.links = s.header.links.filter((l: any) => l.link.route !== 'store')
  delete s.homeMenu
  return s
}
const sec = (id: string, type: string, settings: Record<string, unknown> = {}) => ({
  id,
  type,
  settings,
})
const legacyHome = () => [
  sec('s_hero0001', 'hero', { headline: 'Welcome' }),
  sec('s_svcs0001', 'service-grid', { heading: 'Treatments' }),
  sec('s_cta00001', 'booking-cta', { heading: 'Book now' }),
]

describe('upgradeSiteForProducts', () => {
  it('adds Products after Services, a homepage menu, and Products + Medicine store after Treatments', () => {
    const r = upgradeSiteForProducts(legacySettings(), legacyHome())
    expect(r.settings.header.links.map((l) => l.label)).toEqual([
      'Services',
      'Products',
      'Our team',
      'Contact',
    ])
    expect(r.settings.homeMenu.items.map((i) => i.label)).toContain('Products')
    expect(r.homeSections!.map((s) => s.type)).toEqual([
      'hero',
      'service-grid',
      'featured-products',
      'medicine-store',
      'booking-cta',
    ])
    expect(r.homeSections![2]!.settings).toMatchObject({ excludeMedicines: true })
    expect(r.changes).toHaveLength(4)
  })

  it('is idempotent', () => {
    const first = upgradeSiteForProducts(legacySettings(), legacyHome())
    const second = upgradeSiteForProducts(first.settings, first.homeSections)
    expect(second.changes).toEqual([])
    expect(second.homeSections).toBeNull()
  })

  it('keeps a clinic’s own Products section where it is and puts the Medicine store after it', () => {
    const home = [...legacyHome(), sec('s_prod0001', 'featured-products', { heading: 'Shop' })]
    const r = upgradeSiteForProducts(legacySettings(), home)
    const types = r.homeSections!.map((s) => s.type)
    expect(types.filter((t) => t === 'featured-products')).toHaveLength(1)
    expect(types.slice(-2)).toEqual(['featured-products', 'medicine-store'])
    expect(r.homeSections!.find((s) => s.id === 's_prod0001')!.settings.heading).toBe('Shop')
  })

  it('leaves a full header alone and a site without a HOME page gets settings only', () => {
    const s = legacySettings()
    s.header.links = Array.from({ length: 8 }, (_, i) => ({
      label: `L${i}`,
      link: { kind: 'route', route: 'contact' },
    }))
    const r = upgradeSiteForProducts(s, null)
    expect(r.settings.header.links).toHaveLength(8)
    expect(r.settings.header.links.some((l) => l.label === 'Products')).toBe(false)
    expect(r.homeSections).toBeNull()
  })
})

describe('legacy (first-builder) home content', () => {
  it('upgrades the menus and reports the home page as skipped instead of failing', () => {
    const r = upgradeSiteForProducts(legacySettings(), [
      { id: 's_hero001', type: 'hero', settings: { ctaLabel: 'Book', ctaHref: '#x' } },
    ])
    expect(r.homeSections).toBeNull()
    expect(r.settings.header.links.some((l) => l.label === 'Products')).toBe(true)
    expect(r.changes.join(' ')).toMatch(/home: skipped \(legacy content/)
  })
})
