/**
 * Component 8 — frontend content model: section schema parity with the
 * backend (shared/validation-cases/site-sections.json), markdown, theme,
 * links, client-side resolution, SEO, sitemap and the editor reducer.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { SECTION_DEFS, defaultSettings, newSection, validateSection } from '@/lib/site/sections'
import { markdownToText, parseInline, parseMarkdown } from '@/lib/site/markdown'
import {
  contrastIssues,
  contrastRatio,
  readableOn,
  themeStyle,
  FONT_PAIRS,
  buttonClass,
} from '@/lib/site/theme'
import { isSafeExternalHref, siteHref } from '@/lib/site/links'
import { brokenLinks, resolveClient, type ClientTargets } from '@/lib/site/resolveClient'
import { jsonLd, pageTitle, pageDescription, safeJsonLd, siteMetadata } from '@/lib/site/seo'
import { robotsTxt, sitemapXml } from '@/lib/site/sitemap'
import {
  canRedo,
  canUndo,
  editorReducer,
  initEditor,
  isDirty,
  HISTORY_LIMIT,
} from '@/lib/site/editorState'
import type { RenderPayload, SiteTheme } from '@/lib/site/types'

interface SectionCases {
  types: Record<string, string[]>
  valid: { name: string; section: unknown }[]
  invalid: { name: string; section: unknown }[]
}
const sectionCases = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../shared/validation-cases/site-sections.json'),
    'utf8'
  )
) as SectionCases

function expand(v: unknown): unknown {
  if (typeof v === 'string' && v.startsWith('@repeat:')) {
    const [, n, ...rest] = v.split(':')
    return Array.from({ length: Number(n) }, () => JSON.parse(rest.join(':')))
  }
  if (Array.isArray(v)) return v.map(expand)
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)]))
  return v
}

describe('section schemas — shared parity cases', () => {
  it('types and variants match the shared definition exactly', () => {
    expect(
      Object.fromEntries(SECTION_DEFS.map((d) => [d.type, d.variants.map((v) => v.value)]))
    ).toEqual(sectionCases.types)
  })
  it.each(sectionCases.valid.map((c) => [c.name, c.section] as const))('accepts %s', (_n, s) => {
    expect(validateSection(expand(s))).toMatchObject({ ok: true })
  })
  it.each(sectionCases.invalid.map((c) => [c.name, c.section] as const))('rejects %s', (_n, s) => {
    expect(validateSection(expand(s))).toMatchObject({ ok: false })
  })
  it('every new section is valid as created — except video, which needs a link first', () => {
    for (const d of SECTION_DEFS) {
      const r = validateSection(newSection(d.type))
      expect(r.ok, d.type).toBe(d.type !== 'video')
    }
    expect(
      validateSection({
        ...newSection('video'),
        settings: { ...defaultSettings('video'), url: 'https://vimeo.com/123456' },
      }).ok
    ).toBe(true)
  })
})

describe('markdown subset', () => {
  it('parses paragraphs, lists, bold, italic and safe links', () => {
    const blocks = parseMarkdown(
      'Hello **world** and *you*.\n\n- one\n- [two](/contact)\n\n[x](javascript:alert(1)) [y](https://e.test)'
    )
    expect(blocks[0]).toEqual({
      t: 'p',
      c: [
        { t: 'text', v: 'Hello ' },
        { t: 'strong', c: [{ t: 'text', v: 'world' }] },
        { t: 'text', v: ' and ' },
        { t: 'em', c: [{ t: 'text', v: 'you' }] },
        { t: 'text', v: '.' },
      ],
    })
    expect(blocks[1]).toMatchObject({
      t: 'ul',
      items: [[{ t: 'text', v: 'one' }], [{ t: 'link', href: '/contact', internal: true }]],
    })
    const last = blocks[2] as { t: 'p'; c: { t: string }[] }
    expect(last.c.map((x) => x.t)).toEqual(['text', 'text', 'link']) // unsafe link kept as words
    expect(markdownToText('**A** [b](/x)\n\n- c')).toBe('A b c')
    expect(parseInline('<script>x</script>')).toEqual([{ t: 'text', v: '<script>x</script>' }])
  })
})

describe('theme', () => {
  const theme: SiteTheme = {
    colors: {
      primary: '#1d4ed8',
      secondary: '#1e3a8a',
      accent: '#0ea5e9',
      background: '#ffffff',
      surface: '#f1f5f9',
      text: '#0f172a',
      muted: '#475569',
    },
    fontPair: 'editorial',
    radius: 'md',
    buttonStyle: 'pill',
    density: 'spacious',
  }
  it('computes WCAG contrast and readable text colours', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(readableOn('#1d4ed8')).toBe('#ffffff')
    expect(readableOn('#facc15')).toBe('#0f172a')
    expect(contrastIssues(theme)).toEqual([])
    expect(
      contrastIssues({ ...theme, colors: { ...theme.colors, text: '#dddddd' } }).map((i) => i.pair)
    ).toContain('Text on background')
  })
  it('emits every token as a CSS variable', () => {
    const style = themeStyle(theme) as Record<string, string>
    expect(style['--site-primary']).toBe('#1d4ed8')
    expect(style['--site-btn-radius']).toBe('999px')
    expect(style['--site-font-heading']).toContain('--font-site-playfair')
    expect(style['--site-section-y']).toBe('7rem')
    expect(FONT_PAIRS).toHaveLength(6)
    expect(buttonClass({ ...theme, buttonStyle: 'outline' })).toContain('mf-btn-outline')
  })
})

describe('links and resolution', () => {
  it('only https / mailto / tel are allowed externally', () => {
    expect(isSafeExternalHref('https://e.test')).toBe(true)
    expect(isSafeExternalHref('tel:+15550100')).toBe(true)
    for (const bad of [
      'javascript:alert(1)',
      'http://e.test',
      'data:text/html,x',
      ' https://e.test',
    ])
      expect(isSafeExternalHref(bad)).toBe(false)
  })
  it('siteHref prefixes the site base and drops dead links', () => {
    expect(siteHref('/s/everwell', { kind: 'route', route: 'team', href: '/team' })).toBe(
      '/s/everwell/team'
    )
    expect(siteHref('', { kind: 'route', route: 'home', href: '/' })).toBe('/')
    expect(siteHref('/s/everwell', { kind: 'page', pageId: 'p', href: null })).toBeNull()
    expect(siteHref('', { kind: 'anchor', sectionId: 's_1', href: '#s_1' })).toBe('#s_1')
    expect(siteHref('', { kind: 'external', href: 'javascript:alert(1)' })).toBeNull()
    expect(siteHref('', null)).toBeNull()
  })
  it('resolveClient mirrors the backend resolver; brokenLinks finds dead targets', () => {
    const t: ClientTargets = {
      pages: new Map([['p1', '/about']]),
      services: new Map([['s1', 'follow-up']]),
      providers: new Map(),
      products: new Map(),
      assets: new Map([['a1', { url: 'https://cdn.test/a1.png', width: 4, height: 3 }]]),
      hasStore: false,
    }
    const content = [
      { label: 'About', link: { kind: 'page', pageId: 'p1' } },
      { label: 'Book', link: { kind: 'booking', serviceId: 's1' } },
      { label: 'Gone', link: { kind: 'provider', providerId: 'x' } },
      { label: 'Shop', link: { kind: 'route', route: 'store' } },
      { image: { assetId: 'a1', alt: '' } },
    ]
    const out = resolveClient(content, t) as unknown as {
      link?: { href: string | null }
      image?: { url: string }
    }[]
    expect(out.map((x) => (x.link ? x.link.href : x.image?.url))).toEqual([
      '/about',
      '/book/follow-up',
      null,
      null,
      'https://cdn.test/a1.png',
    ])
    expect(brokenLinks(content, t)).toHaveLength(2)
  })
})

function payload(over: Partial<RenderPayload> = {}): RenderPayload {
  return {
    site: {
      clinicId: 'c1',
      name: 'Everwell',
      slug: 'everwell',
      canonicalBase: 'https://everwell.example',
      settings: {
        theme: {
          colors: {
            primary: '#000000',
            secondary: '#111111',
            accent: '#222222',
            background: '#ffffff',
            surface: '#eeeeee',
            text: '#000000',
            muted: '#333333',
          },
          fontPair: 'modern',
          radius: 'md',
          buttonStyle: 'solid',
          density: 'comfortable',
        },
        brand: { displayName: '', logo: null, favicon: null },
        header: { variant: 'classic', links: [], cta: null, sticky: true },
        footer: { variant: 'simple', columns: [], text: '' },
        announcement: { enabled: false, text: '', link: null },
        social: {},
        seo: { titleSuffix: '| Physio', description: 'Default description', ogImage: null },
      },
      showBadge: true,
      legacyLogoUrl: null,
      hasStore: false,
    },
    route: { key: 'page', path: '/about', params: {} },
    page: {
      id: 'p1',
      kind: 'STANDARD',
      title: 'About us',
      seoTitle: null,
      seoDescription: null,
      noindex: false,
      sections: [],
    },
    entity: null,
    data: {
      services: [],
      providers: [],
      products: [],
      packages: [],
      memberships: [],
      locations: [
        {
          id: 'l',
          name: 'Main',
          addressLines: ['1 Road'],
          phone: '555-0100',
          timezone: 'UTC',
          isVirtual: false,
        },
      ],
    },
    preview: false,
    ...over,
  }
}

describe('SEO', () => {
  it('titles, descriptions, canonical and robots follow the payload', () => {
    const p = payload()
    expect(pageTitle(p)).toBe('About us | Everwell | Physio')
    expect(pageDescription(p)).toBe('Default description')
    const meta = siteMetadata(p, { status: 200 })
    expect(meta.alternates).toEqual({ canonical: 'https://everwell.example/about' })
    expect(meta.robots).toEqual({ index: true, follow: true })
    expect(siteMetadata({ ...p, preview: true }, { status: 200 }).robots).toEqual({
      index: false,
      follow: false,
    })
    expect(siteMetadata(p, { status: 404 }).robots).toEqual({ index: false, follow: false })
    expect(
      pageTitle({
        ...p,
        page: { ...p.page!, kind: 'HOME', title: 'Home' },
        route: { key: 'home', path: '/', params: {} },
      })
    ).toBe('Everwell | Physio')
  })
  it('JSON-LD describes the clinic and the page entity, and cannot break out of <script>', () => {
    const p = payload({
      entity: {
        type: 'provider',
        provider: {
          id: 'x',
          slug: 'dr-a',
          name: 'Dr A</script><script>alert(1)',
          bio: null,
          headshotUrl: null,
          languages: [],
          disciplines: ['Physio'],
          serviceIds: [],
        },
      },
      page: null,
    })
    const ld = jsonLd(p)
    expect(ld.map((x) => x['@type'])).toEqual(['MedicalClinic', 'Physician'])
    expect(safeJsonLd(ld[1])).not.toContain('</script>')
  })
})

describe('sitemap & robots', () => {
  it('escapes XML and lists entries', () => {
    const xml = sitemapXml([{ loc: 'https://e.test/a?x=1&y=2', lastmod: '2026-01-01' }])
    expect(xml).toContain('<loc>https://e.test/a?x=1&amp;y=2</loc>')
    expect(xml).toContain('<lastmod>2026-01-01</lastmod>')
  })
  it('allows a live host and blocks everything else', () => {
    expect(robotsTxt('https://e.test/')).toContain('Sitemap: https://e.test/sitemap.xml')
    expect(robotsTxt('https://e.test')).toContain('Disallow: /preview/')
    expect(robotsTxt(null)).toBe('User-agent: *\nDisallow: /\n')
  })
})

describe('editor reducer', () => {
  const start = () =>
    initEditor({
      title: 'Home',
      seoTitle: '',
      seoDescription: '',
      sections: [newSection('hero'), newSection('faq')],
    })

  it('add / move / duplicate / hide / remove, with selection following', () => {
    let s = start()
    const [hero, faq] = s.doc.sections
    s = editorReducer(s, { type: 'add', sectionType: 'steps', index: 1 })
    expect(s.doc.sections.map((x) => x.type)).toEqual(['hero', 'steps', 'faq'])
    expect(s.selectedId).toBe(s.doc.sections[1]!.id)
    s = editorReducer(s, { type: 'move', id: faq!.id, to: 0 })
    expect(s.doc.sections[0]!.id).toBe(faq!.id)
    s = editorReducer(s, { type: 'duplicate', id: hero!.id })
    expect(s.doc.sections.filter((x) => x.type === 'hero')).toHaveLength(2)
    s = editorReducer(s, { type: 'toggleHidden', id: hero!.id })
    expect(s.doc.sections.find((x) => x.id === hero!.id)!.hidden).toBe(true)
    s = editorReducer(s, { type: 'select', id: hero!.id })
    s = editorReducer(s, { type: 'remove', id: hero!.id })
    expect(s.doc.sections.some((x) => x.id === hero!.id)).toBe(false)
    expect(s.selectedId).not.toBe(hero!.id)
    expect(editorReducer(s, { type: 'move', id: 'missing', to: 0 })).toBe(s)
  })

  it('undo / redo, coalesced typing, dirty tracking, bounded history', () => {
    let s = start()
    const id = s.doc.sections[0]!.id
    expect(isDirty(s)).toBe(false)
    s = editorReducer(s, { type: 'settings', id, key: 'headline', value: 'H', at: 1000 })
    s = editorReducer(s, { type: 'settings', id, key: 'headline', value: 'He', at: 1500 })
    s = editorReducer(s, { type: 'settings', id, key: 'headline', value: 'Hey', at: 2000 })
    expect(s.past).toHaveLength(1) // three keystrokes, one undo step
    expect(isDirty(s)).toBe(true)
    s = editorReducer(s, { type: 'settings', id, key: 'headline', value: 'Hey!', at: 9000 })
    expect(s.past).toHaveLength(2)
    s = editorReducer(s, { type: 'undo' })
    expect(s.doc.sections[0]!.settings.headline).toBe('Hey')
    expect(canRedo(s)).toBe(true)
    s = editorReducer(s, { type: 'redo' })
    expect(s.doc.sections[0]!.settings.headline).toBe('Hey!')
    s = editorReducer(s, { type: 'saved', doc: s.doc })
    expect(isDirty(s)).toBe(false)
    for (let i = 0; i < HISTORY_LIMIT + 10; i++)
      s = editorReducer(s, { type: 'meta', key: 'title', value: `T${i}`, at: i * 10_000 })
    expect(s.past.length).toBe(HISTORY_LIMIT)
    expect(canUndo(s)).toBe(true)
    expect(editorReducer(initEditor(s.doc), { type: 'undo' }).doc).toEqual(s.doc)
  })
})

describe('server render client (lib/site/renderApi)', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  it('maps site targets and bases', async () => {
    const { siteTarget, siteBaseFor } = await import('@/lib/site/renderApi')
    expect(siteTarget('everwell.example.com')).toEqual({ host: 'everwell.example.com' })
    expect(siteTarget('~everwell')).toEqual({ clinic: 'everwell' })
    expect(siteTarget(encodeURIComponent('~everwell'))).toEqual({ clinic: 'everwell' })
    expect(siteBaseFor('~everwell')).toBe('/s/everwell')
    expect(siteBaseFor('everwell.example.com')).toBe('')
  })
  it('returns page, branded 404, unknown site and redirects; never caches', async () => {
    const { fetchSitePage, fetchSitemap } = await import('@/lib/site/renderApi')
    const calls: [string, RequestInit | undefined][] = []
    const fake = (res: Response) =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push([String(url), init])
        return res
      }) as typeof fetch
    const page = await fetchSitePage(
      '~everwell',
      '/about',
      undefined,
      fake(json(200, { data: payload() }))
    )
    expect(page).toMatchObject({ kind: 'page', status: 200 })
    expect(calls[0]![0]).toContain('/api/v1/public/sites/render?clinic=everwell&path=%2Fabout')
    expect(calls[0]![1]).toMatchObject({ cache: 'no-store' })
    expect(
      await fetchSitePage(
        'x.example',
        '/nope',
        undefined,
        fake(json(404, { success: false, data: payload() }))
      )
    ).toMatchObject({ kind: 'page', status: 404 })
    expect(
      await fetchSitePage(
        'x.example',
        '/',
        undefined,
        fake(json(404, { success: false, code: 'site_unknown' }))
      )
    ).toEqual({ kind: 'unknown' })
    expect(
      await fetchSitePage(
        'x.example',
        '/old',
        undefined,
        fake(json(200, { data: { redirect: { type: 'redirect', to: '/new', code: 301 } } }))
      )
    ).toEqual({ kind: 'redirect', to: '/new', code: 301 })
    await fetchSitePage(
      'x.example',
      '/preview/abc',
      'tok',
      fake(json(200, { data: payload({ preview: true }) }))
    )
    expect(calls.at(-1)![0]).toContain('preview=tok')
    await expect(fetchSitePage('x.example', '/', undefined, fake(json(500, {})))).rejects.toThrow(
      /500/
    )
    expect(
      await fetchSitemap(
        'x.example',
        fake(json(200, { data: { canonicalBase: 'https://x.example', entries: [] } }))
      )
    ).toEqual({ canonicalBase: 'https://x.example', entries: [] })
    expect(await fetchSitemap('x.example', fake(json(404, {})))).toBeNull()
  })
})

describe('clinic favicon fallback', () => {
  it('is the clinic initial in its primary colour, never the MedoFlow icon', async () => {
    const { initialIcon, siteMetadata } = await import('@/lib/site/seo')
    const icon = decodeURIComponent(initialIcon(payload()))
    expect(icon).toContain("fill='#000000'")
    expect(icon).toContain('>E</text>')
    expect(siteMetadata(payload(), { status: 200 }).icons).toEqual({ icon: initialIcon(payload()) })
  })
})
