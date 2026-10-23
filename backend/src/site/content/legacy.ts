/**
 * Pages written by the first builder stored sections as
 * `{ type, settings, blocks }` with free-text links ("#services"), FAQ lines
 * ("Q|A") and quote strings. These helpers upgrade them to the current
 * section schema so old published sites keep rendering and stay editable.
 */
import { newSectionId, parseSection, SECTION_ID_RE, type Section } from './sections'
import { isSafeExternalHref, type SiteLink } from './primitives'

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '')

function legacyLink(href: unknown): SiteLink {
  const h = str(href).trim()
  if (h && isSafeExternalHref(h)) return { kind: 'external', href: h }
  if (/^#?(services|book)/i.test(h)) return { kind: 'route', route: 'services' }
  return { kind: 'booking' }
}

function legacyCta(label: unknown, href: unknown) {
  const l = str(label, 40).trim()
  return l ? { label: l, link: legacyLink(href) } : null
}

function convertSettings(type: string, s: Record<string, unknown>): Record<string, unknown> | null {
  switch (type) {
    case 'hero':
      return {
        eyebrow: str(s.eyebrow, 60),
        headline: str(s.headline, 120) || 'Welcome',
        subheadline: str(s.subheadline, 400),
        primaryCta: legacyCta(s.ctaLabel, s.ctaHref),
      }
    case 'service-grid':
    case 'provider-bios':
      return {
        heading: str(s.title, 160),
        intro: str(s.intro, 600),
        maxItems: typeof s.maxItems === 'number' ? Math.min(24, Math.max(1, s.maxItems)) : 6,
      }
    case 'testimonials': {
      const quotes = Array.isArray(s.quotes) ? s.quotes : []
      return {
        heading: str(s.title, 160),
        items: quotes.slice(0, 12).flatMap((q) => {
          const text = str(q, 600)
          if (!text.trim()) return []
          const m = /^\s*"?(.+?)"?\s*[—–-]\s*([^—–-]{1,80})$/.exec(text)
          return [
            m
              ? { quote: m[1]!.slice(0, 500), author: m[2]!.trim(), detail: '' }
              : { quote: text.slice(0, 500), author: '', detail: '' },
          ]
        }),
      }
    }
    case 'faq': {
      const items = Array.isArray(s.items) ? s.items : []
      return {
        heading: str(s.title, 160),
        items: items.slice(0, 30).flatMap((line) => {
          const [q, ...rest] = str(line).split('|')
          const question = (q ?? '').trim().slice(0, 200)
          return question ? [{ question, answer: rest.join('|').trim().slice(0, 2000) }] : []
        }),
      }
    }
    case 'booking-cta':
      return {
        heading: str(s.headline, 120) || 'Book a visit',
        text: str(s.subheadline, 400),
        cta: legacyCta(s.ctaLabel, s.ctaHref),
      }
    case 'rich-text':
      return { heading: str(s.title, 160), body: str(s.body, 10000) }
    default:
      return null
  }
}

/** Current-format section, or null when the stored value can't be used. */
export function upgradeSection(raw: unknown, index = 0): Section | null {
  try {
    return parseSection(raw, index)
  } catch {
    /* fall through to the legacy shape */
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = str(r.type, 60)
  const settings = convertSettings(type, (r.settings as Record<string, unknown>) ?? {})
  if (!settings) return null
  const id = typeof r.id === 'string' && SECTION_ID_RE.test(r.id) ? r.id : newSectionId()
  try {
    return parseSection({ id, type, settings }, index)
  } catch {
    return null
  }
}

/** Upgrades a stored page body; unusable sections are dropped. */
export function upgradeSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return []
  const out: Section[] = []
  const seen = new Set<string>()
  raw.slice(0, 40).forEach((s, i) => {
    const sec = upgradeSection(s, i)
    if (!sec) return
    if (seen.has(sec.id)) sec.id = newSectionId()
    seen.add(sec.id)
    out.push(sec)
  })
  return out
}
