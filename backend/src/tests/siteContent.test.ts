/**
 * Component 8 content model: typed links, the section library, site
 * settings, the template catalog and the legacy-section upgrade.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { isSafeExternalHref, siteLinkSchema } from '../site/content/primitives'
import {
  parseSection,
  parseSections,
  SECTION_SETTINGS,
  SECTION_TYPES,
  SectionValidationError,
} from '../site/content/sections'
import { parseSiteSettings, readSiteSettings, defaultSiteSettings } from '../site/content/settings'
import { upgradeSections } from '../site/content/legacy'
import { SITE_TEMPLATES, getTemplate } from '../site/templates'

describe('typed links', () => {
  it.each(['https://example.test/path?q=1', 'mailto:hello@example.test', 'tel:+15550100'])(
    'accepts %s',
    (href) => expect(isSafeExternalHref(href)).toBe(true)
  )

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'java\tscript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'http://example.test',
    '/relative/path',
    '//evil.example',
    'https://',
  ])('rejects %s', (href) => expect(isSafeExternalHref(href)).toBe(false))

  it('rejects unknown link kinds and extra keys', () => {
    expect(siteLinkSchema.safeParse({ kind: 'url', href: 'https://x.test' }).success).toBe(false)
    expect(
      siteLinkSchema.safeParse({ kind: 'route', route: 'services', href: 'javascript:x' }).success
    ).toBe(false)
    expect(siteLinkSchema.safeParse({ kind: 'route', route: 'admin' }).success).toBe(false)
  })
})

describe('section library', () => {
  it('every type declares at least one variant and accepts its defaults', () => {
    const minimal: Partial<Record<string, Record<string, unknown>>> = {
      hero: { headline: 'Hello' },
      'booking-cta': { heading: 'Book' },
      video: { url: 'https://youtu.be/abcdefgh' },
    }
    for (const type of SECTION_TYPES) {
      expect(SECTION_SETTINGS[type].variants.length).toBeGreaterThan(0)
      const s = parseSection({ id: 's_abcd1234', type, settings: minimal[type] ?? {} })
      expect(s.variant).toBe(SECTION_SETTINGS[type].variants[0])
    }
  })

  it('refuses unknown types, variants, fields and unsafe links', () => {
    const bad = [
      { id: 's_abcd1234', type: 'iframe', settings: {} },
      { id: 's_abcd1234', type: 'hero', variant: 'fullscreen', settings: { headline: 'x' } },
      { id: 's_abcd1234', type: 'hero', settings: { headline: 'x', html: '<b>' } },
      {
        id: 's_abcd1234',
        type: 'hero',
        settings: {
          headline: 'x',
          primaryCta: { label: 'Go', link: { kind: 'external', href: 'javascript:alert(1)' } },
        },
      },
      { id: 's_abcd1234', type: 'video', settings: { url: 'https://evil.example/embed' } },
      {
        id: 's_abcd1234',
        type: 'gallery',
        settings: { images: [{ src: 'https://x.test/a.png' }] },
      },
      { id: 'bad id', type: 'spacer', settings: {} },
    ]
    for (const s of bad) expect(() => parseSection(s)).toThrow(SectionValidationError)
  })

  it('caps a page at 40 sections with unique ids', () => {
    const many = Array.from({ length: 41 }, (_, i) => ({
      id: `s_${String(i).padStart(6, '0')}`,
      type: 'spacer',
      settings: {},
    }))
    expect(() => parseSections(many)).toThrow(/at most 40/)
    const dup = [
      { id: 's_aaaa1111', type: 'spacer', settings: {} },
      { id: 's_aaaa1111', type: 'spacer', settings: {} },
    ]
    expect(() => parseSections(dup)).toThrow(/Duplicate/)
  })
})

describe('site settings', () => {
  it('defaults carry the brand colour and validate', () => {
    const s = defaultSiteSettings('#AB12CD')
    expect(s.theme.colors.primary).toBe('#ab12cd')
    expect(parseSiteSettings(s)).toEqual(s)
  })

  it('rejects bad colours and unknown fonts', () => {
    const s = defaultSiteSettings()
    expect(() =>
      parseSiteSettings({ ...s, theme: { ...s.theme, colors: { ...s.theme.colors, text: 'red' } } })
    ).toThrow()
    expect(() => parseSiteSettings({ ...s, theme: { ...s.theme, fontPair: 'comic' } })).toThrow()
  })

  it('reads damaged stored settings leniently', () => {
    const s = readSiteSettings({ theme: 'broken', header: defaultSiteSettings().header })
    expect(s.theme.fontPair).toBe('modern')
    expect(readSiteSettings(null).header.variant).toBe('classic')
  })
})

describe('template catalog', () => {
  it('ships at least five templates with unique keys', () => {
    expect(SITE_TEMPLATES.length).toBeGreaterThanOrEqual(5)
    expect(new Set(SITE_TEMPLATES.map((t) => t.key)).size).toBe(SITE_TEMPLATES.length)
    expect(getTemplate('clarity')?.name).toBe('Clarity')
    expect(getTemplate('nope')).toBeUndefined()
  })

  it.each(SITE_TEMPLATES.map((t) => [t.key, t] as const))(
    '%s validates against the strict schemas',
    (_key, t) => {
      expect(() => parseSiteSettings(t.settings)).not.toThrow()
      const kinds = t.pages.map((p) => p.kind)
      expect(kinds.filter((k) => k === 'HOME')).toHaveLength(1)
      expect(new Set(t.pages.map((p) => p.slug)).size).toBe(t.pages.length)
      for (const p of t.pages) {
        expect(() =>
          parseSections(
            p.sections.map((s, i) => ({ ...s, id: `s_tpl${String(i).padStart(4, '0')}` }))
          )
        ).not.toThrow()
      }
    }
  )

  it('template links to pages only point at pages the template ships', () => {
    for (const t of SITE_TEMPLATES) {
      const slugs = new Set(t.pages.map((p) => `tpl_${p.slug}`))
      const refs = JSON.stringify(t).match(/"pageId":"(tpl_[a-z0-9-]+)"/g) ?? []
      for (const r of refs) expect(slugs).toContain(r.slice(10, -1))
    }
  })

  it('every sample image a template uses exists in the frontend bundle', () => {
    const publicDir = path.resolve(__dirname, '../../../frontend/public')
    const srcs = new Set(
      SITE_TEMPLATES.flatMap(
        (t) => JSON.stringify(t).match(/\/site-samples\/[a-z0-9-]+\.svg/g) ?? []
      )
    )
    expect(srcs.size).toBeGreaterThan(5)
    for (const src of srcs) expect(fs.existsSync(path.join(publicDir, src)), src).toBe(true)
  })

  it('template copy carries no PHI-shaped placeholders', () => {
    const text = JSON.stringify(SITE_TEMPLATES)
    expect(text).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/) // SSN
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@(?!example\.test)[A-Za-z0-9.-]+\.[a-z]{2,}/)
    expect(text).not.toMatch(/\b(19|20)\d{2}-\d{2}-\d{2}\b/) // dates of birth
    expect(text).not.toMatch(/lorem ipsum/i)
  })
})

describe('legacy sections (first builder)', () => {
  it('upgrades the old shapes and drops what cannot be used', () => {
    const out = upgradeSections([
      {
        id: 's_old1',
        type: 'hero',
        settings: { headline: 'Hi', ctaLabel: 'Book', ctaHref: '#services', backgroundImage: '' },
        blocks: [],
      },
      { type: 'faq', settings: { title: 'FAQ', items: ['Q one?|A one.', 'bad', ''] } },
      { type: 'testimonials', settings: { title: 'T', quotes: ['"Great care." — Sam P.'] } },
      {
        type: 'booking-cta',
        settings: { headline: 'Go', ctaLabel: 'Now', ctaHref: 'javascript:x' },
      },
      { type: 'marquee', settings: {} },
      'garbage',
    ])
    expect(out.map((s) => s.type)).toEqual(['hero', 'faq', 'testimonials', 'booking-cta'])
    expect(out[0]!.settings.primaryCta).toEqual({
      label: 'Book',
      link: { kind: 'route', route: 'services' },
    })
    expect(out[1]!.settings.items).toEqual([
      { question: 'Q one?', answer: 'A one.' },
      { question: 'bad', answer: '' },
    ])
    expect(out[2]!.settings.items).toEqual([{ quote: 'Great care.', author: 'Sam P.', detail: '' }])
    expect(JSON.stringify(out[3])).not.toContain('javascript')
  })
})
