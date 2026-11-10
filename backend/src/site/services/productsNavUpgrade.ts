/**
 * Brings an existing clinic site up to the WS3 defaults, idempotently:
 *
 *  - Products (→ the store route) in the header menu, after Services;
 *  - a homepage quick-links menu, when the site has none yet;
 *  - on the HOME page: Products (no medicines) and Medicine store, right
 *    after the Treatments / services section.
 *
 * Pure: takes the stored draft JSON, returns the new draft JSON and a list of
 * what changed. scripts/site-add-products-nav.ts applies it to drafts only;
 * the clinic still reviews and publishes. Nothing already present is moved
 * or duplicated, and running it twice changes nothing the second time.
 */
import {
  DEFAULT_HOME_MENU,
  parseSiteSettings,
  readSiteSettings,
  type SiteSettings,
} from '../content/settings'
import { newSectionId, parseSections, type Section } from '../content/sections'

export interface UpgradeResult {
  settings: SiteSettings
  homeSections: Section[] | null
  changes: string[]
}

const isStore = (l: { link: { kind: string; route?: string } }) =>
  l.link.kind === 'route' && l.link.route === 'store'

export function upgradeSiteForProducts(
  settingsRaw: unknown,
  homeSectionsRaw: unknown
): UpgradeResult {
  const changes: string[] = []
  const settings = structuredClone(readSiteSettings(settingsRaw))

  const links = settings.header.links
  const hasStoreLink = links.some((l) => isStore(l) || (l.children ?? []).some(isStore))
  if (!hasStoreLink && links.length < 8) {
    const services = links.findIndex(
      (l) => l.link.kind === 'route' && (l.link as { route?: string }).route === 'services'
    )
    links.splice(services >= 0 ? services + 1 : links.length, 0, {
      label: 'Products',
      link: { kind: 'route', route: 'store' },
    })
    changes.push('header: added Products')
  }
  if (!settings.homeMenu || settings.homeMenu.items.length === 0) {
    settings.homeMenu = { items: structuredClone(DEFAULT_HOME_MENU) }
    changes.push('homeMenu: added the default quick links')
  }
  // Fails loudly rather than storing something the builder would refuse.
  parseSiteSettings(settings)

  let homeSections: Section[] | null = null
  let parsed: Section[] | null = null
  if (homeSectionsRaw !== null) {
    try {
      parsed = parseSections(homeSectionsRaw)
    } catch {
      // First-builder (legacy) content: the builder converts it when the page
      // is opened and saved; until then only the menus are upgraded.
      changes.push(
        'home: skipped (legacy content: open and save the Home page in the builder, then re-run)'
      )
    }
  }
  if (parsed) {
    const sections = parsed
    const hasMedicine = sections.some((s) => s.type === 'medicine-store')
    const hasProducts = sections.some((s) => s.type === 'featured-products')
    if (!hasMedicine || !hasProducts) {
      const services = sections.findIndex((s) => s.type === 'service-grid')
      let at = services >= 0 ? services + 1 : sections.length
      if (!hasProducts) {
        sections.splice(at, 0, {
          id: newSectionId(),
          type: 'featured-products',
          variant: 'grid',
          hidden: false,
          settings: {
            heading: 'Products',
            intro: '',
            productIds: [],
            maxItems: 4,
            excludeMedicines: true,
          },
        })
        changes.push('home: added Products after Treatments')
        at += 1
      } else {
        // Keep the clinic's own Products section where it is; the Medicine
        // store goes right after it.
        at = sections.findIndex((s) => s.type === 'featured-products') + 1
      }
      if (!hasMedicine) {
        sections.splice(at, 0, {
          id: newSectionId(),
          type: 'medicine-store',
          variant: 'grid',
          hidden: false,
          settings: {
            heading: 'Medicine store',
            intro: 'Over-the-counter medicines and supplements, no prescription needed.',
            productIds: [],
            maxItems: 4,
          },
        })
        changes.push('home: added Medicine store')
      }
      homeSections = parseSections(sections)
    }
  }
  return { settings, homeSections, changes }
}
