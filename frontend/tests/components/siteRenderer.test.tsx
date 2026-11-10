/**
 * Component 8 — the clinic-site renderer (live, preview and builder modes):
 * every section type has a component, links honour the site base, hidden
 * sections stay hidden, the builder canvas never navigates, and the
 * contact form posts a lead with its spam guards.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SiteRenderer } from '@/components/site/SiteRenderer'
import { SECTION_COMPONENTS } from '@/components/site/sections'
import { embedUrl } from '@/components/site/sections/content'
import { SECTION_DEFS } from '@/lib/site/sections'
import type { RenderPayload, Section } from '@/lib/site/types'

const sec = (
  id: string,
  type: Section['type'],
  settings: Record<string, unknown>,
  extra: Partial<Section> = {}
): Section => ({
  id,
  type,
  variant: SECTION_DEFS.find((d) => d.type === type)!.variants[0]!.value,
  hidden: false,
  settings,
  ...extra,
})

function payload(sections: Section[], over: Partial<RenderPayload['site']> = {}): RenderPayload {
  return {
    site: {
      clinicId: 'c1',
      name: 'Everwell Clinic',
      slug: 'everwell',
      canonicalBase: 'https://everwell.example',
      settings: {
        theme: {
          colors: {
            primary: '#1d4ed8',
            secondary: '#1e3a8a',
            accent: '#0ea5e9',
            background: '#ffffff',
            surface: '#f1f5f9',
            text: '#0f172a',
            muted: '#475569',
          },
          fontPair: 'modern',
          radius: 'md',
          buttonStyle: 'solid',
          density: 'comfortable',
        },
        brand: { displayName: '', logo: null, favicon: null },
        header: {
          variant: 'classic',
          links: [
            { label: 'Services', link: { kind: 'route', route: 'services', href: '/services' } },
            { label: 'Deleted page', link: { kind: 'page', pageId: 'gone', href: null } },
          ],
          cta: { label: 'Book now', link: { kind: 'booking', href: '/book' } },
          sticky: true,
        },
        footer: { variant: 'simple', columns: [], text: 'Footer words' },
        announcement: { enabled: true, text: 'Flu shots available', link: null },
        social: { instagram: 'https://instagram.example/everwell' },
        seo: { titleSuffix: '', description: '', ogImage: null },
      },
      showBadge: true,
      legacyLogoUrl: null,
      hasStore: false,
      ...over,
    },
    route: { key: 'home', path: '/', params: {} },
    page: {
      id: 'p1',
      kind: 'HOME',
      title: 'Home',
      seoTitle: null,
      seoDescription: null,
      noindex: false,
      sections,
    },
    entity: null,
    data: {
      services: [
        {
          id: 'svc1',
          slug: 'follow-up',
          name: 'Follow-up visit',
          durationMinutes: 20,
          price: '65.00',
          discipline: 'General',
        },
      ],
      providers: [],
      products: [],
      packages: [],
      memberships: [],
      locations: [],
    },
    preview: false,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('section registry', () => {
  it('has a renderer for every section type in the schema', () => {
    expect(Object.keys(SECTION_COMPONENTS).sort()).toEqual(SECTION_DEFS.map((d) => d.type).sort())
  })
  it('video embeds only allow-listed hosts, privacy-friendly', () => {
    expect(embedUrl('https://www.youtube.com/watch?v=abcdefgh123')).toBe(
      'https://www.youtube-nocookie.com/embed/abcdefgh123'
    )
    expect(embedUrl('https://vimeo.com/123456')).toBe('https://player.vimeo.com/video/123456?dnt=1')
    expect(embedUrl('https://evil.example/embed/x')).toBeNull()
  })
})

describe('live site', () => {
  const sections = [
    sec('s_hero0001', 'hero', {
      headline: 'Care that listens',
      subheadline: 'Same-week visits',
      primaryCta: { label: 'Book a visit', link: { kind: 'booking', href: '/book' } },
    }),
    sec('s_svc00001', 'service-grid', {
      heading: 'Services',
      intro: '',
      serviceIds: [],
      maxItems: 6,
      showPrices: true,
      showDuration: true,
    }),
    sec(
      's_secret01',
      'testimonials',
      { heading: 'Hidden reviews', items: [{ quote: 'Secret', author: '', detail: '' }] },
      { hidden: true }
    ),
    sec('s_faq00001', 'faq', {
      heading: 'FAQ',
      items: [{ question: 'Do you take new patients?', answer: 'Yes — see [contact](/contact).' }],
    }),
  ]

  it('renders the page with the theme, base-prefixed links and no hidden sections', () => {
    render(<SiteRenderer payload={payload(sections)} base="/s/everwell" mode="live" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Care that listens' })).toBeInTheDocument()
    expect(screen.getByText('Flu shots available')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Services', hidden: true })).toHaveAttribute(
      'href',
      '/s/everwell/services'
    )
    // A menu link that leads nowhere (a deleted page, or Products with no
    // products yet) is left out of the live menu — no broken link, no dead label.
    expect(screen.queryByRole('link', { name: 'Deleted page', hidden: true })).toBeNull()
    expect(screen.queryByText('Deleted page')).toBeNull()
    expect(screen.getByRole('link', { name: 'Book a visit' })).toHaveAttribute(
      'href',
      '/s/everwell/book'
    )
    // Service cards book straight into the app's booking flow.
    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute(
      'href',
      '/book/svc1?clinicId=c1'
    )
    expect(screen.getByRole('link', { name: 'Follow-up visit' })).toHaveAttribute(
      'href',
      '/s/everwell/services/follow-up'
    )
    expect(screen.queryByText('Hidden reviews')).toBeNull()
    expect(screen.getByRole('link', { name: 'contact' })).toHaveAttribute(
      'href',
      '/s/everwell/contact'
    )
    expect(screen.getByRole('link', { name: 'Powered by MedoFlow' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Instagram' })).toHaveAttribute('target', '_blank')
    const root = document.querySelector('.mf-site') as HTMLElement
    expect(root.style.getPropertyValue('--site-primary')).toBe('#1d4ed8')
  })

  it('hides the badge on plans that allow it and on a custom-domain base uses root paths', () => {
    render(<SiteRenderer payload={payload(sections, { showBadge: false })} base="" mode="live" />)
    expect(screen.queryByText('Powered by MedoFlow')).toBeNull()
    expect(screen.getByRole('link', { name: 'Services', hidden: true })).toHaveAttribute(
      'href',
      '/services'
    )
  })

  it('a branded 404 when there is no page', () => {
    const p = payload([])
    render(
      <SiteRenderer
        payload={{ ...p, page: null, route: { key: 'not-found', path: '/x', params: {} } }}
        base=""
        mode="live"
      />
    )
    expect(screen.getByRole('heading', { name: 'We couldn’t find that page' })).toBeInTheDocument()
  })
})

describe('builder canvas', () => {
  it('shows hidden sections dimmed, selects on click and never navigates', () => {
    const onSelect = vi.fn()
    const sections = [
      sec('s_hero0001', 'hero', {
        headline: 'Hello',
        primaryCta: { label: 'Go', link: { kind: 'booking', href: '/book' } },
      }),
      sec('s_secret01', 'rich-text', { heading: 'Draft-only', body: 'x' }, { hidden: true }),
    ]
    render(
      <SiteRenderer
        payload={payload(sections)}
        base=""
        mode="editor"
        selectedId="s_hero0001"
        onSelect={onSelect}
      />
    )
    const hidden = document.querySelector('[data-section-id="s_secret01"]') as HTMLElement
    expect(hidden).toHaveAttribute('data-hidden', 'true')
    expect(document.querySelector('[data-section-id="s_hero0001"]')).toHaveAttribute(
      'data-selected',
      'true'
    )
    fireEvent.click(within(hidden).getByText('Draft-only'))
    expect(onSelect).toHaveBeenCalledWith('s_secret01')
    const link = screen.getByRole('link', { name: 'Go' })
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })
})

describe('contact form', () => {
  const form = [
    sec('s_form0001', 'contact-form', {
      heading: 'Contact us',
      intro: '',
      submitLabel: 'Send',
      successMessage: 'Thanks!',
      askPhone: true,
      consentText: 'No medical details please.',
    }),
  ]

  it('posts the enquiry with the honeypot and fill-time guard, then thanks the visitor', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 201 }))
    render(<SiteRenderer payload={payload(form)} base="/s/everwell" mode="live" />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Quinn Marlowe' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'quinn@example.test' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Synthetic question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Thanks!')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toMatch(/\/api\/v1\/public\/sites\/leads$/)
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({
      clinic: 'everwell',
      name: 'Quinn Marlowe',
      email: 'quinn@example.test',
      website: '',
    })
    expect(typeof body.startedAt).toBe('number')
  })

  it('shows a recoverable error when sending fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Too many messages' }), { status: 429 })
    )
    render(<SiteRenderer payload={payload(form)} base="" mode="live" />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Q' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'q@example.test' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many messages')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('is inert in the builder', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(<SiteRenderer payload={payload(form)} base="" mode="editor" />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('commerce and booking actions', () => {
  it('pricing and product buttons call the site actions', async () => {
    const addToCart = vi.fn()
    const p = payload(
      [
        sec(
          's_price001',
          'pricing',
          { heading: 'Plans', intro: '', maxItems: 6 },
          { variant: 'both' }
        ),
        sec('s_prod0001', 'featured-products', {
          heading: 'Shop',
          intro: '',
          productIds: [],
          maxItems: 4,
        }),
      ],
      { hasStore: true }
    )
    p.data.memberships = [
      {
        id: 'm1',
        name: 'Essentials',
        description: null,
        monthlyPrice: '49.00',
        serviceDiscountPercent: '10',
        billingPeriod: 'MONTHLY',
      },
    ]
    p.data.products = [
      { id: 'pr1', slug: 'balm', name: 'Balm', description: null, price: '20.00', inStock: true },
      {
        id: 'pr2',
        slug: 'gone',
        name: 'Sold out',
        description: null,
        price: '5.00',
        inStock: false,
      },
    ]
    render(
      <SiteRenderer
        payload={p}
        base=""
        mode="live"
        actions={{
          addToCart,
          openCart: vi.fn(),
          openLogin: vi.fn(),
          cartCount: 2,
          signedIn: false,
        }}
      />
    )
    expect(screen.getByText('$49/mo')).toBeInTheDocument()
    expect(screen.getByText('10% off every visit')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to cart' })[0]!)
    expect(addToCart).toHaveBeenCalledWith(
      { id: 'm1', name: 'Essentials', price: 49 },
      'MEMBERSHIP'
    )
    expect(screen.getByRole('button', { name: 'Out of stock' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open cart — 2 items' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Visit the store →' })).toHaveAttribute(
        'href',
        '/store'
      )
    )
  })
})

describe('WS3 — Products, Medicine store and menus', () => {
  const product = (id: string, name: string, medicine: boolean) => ({
    id,
    slug: id,
    name,
    description: null,
    price: '10.00',
    inStock: true,
    medicine,
  })
  const products = [
    product('p1', 'Retinol serum', false),
    product('p2', 'Magnesium glycinate', true),
    product('p3', 'Arnica gel', true),
  ]
  const withProducts = (sections: Section[], over: Partial<RenderPayload['site']> = {}) => {
    const p = payload(sections, { hasStore: true, ...over })
    p.data.products = products
    return p
  }

  it('Products leaves medicines to the Medicine store, which shows only OTC / supplements', () => {
    const sections = [
      sec('s_prod0001', 'featured-products', {
        heading: 'Products',
        productIds: [],
        maxItems: 8,
        excludeMedicines: true,
      }),
      sec('s_meds0001', 'medicine-store', {
        heading: 'Medicine store',
        productIds: [],
        maxItems: 8,
      }),
    ]
    const { container } = render(
      <SiteRenderer payload={withProducts(sections)} base="/s/everwell" mode="live" />
    )
    const productsSection = container.querySelector('#s_prod0001') as HTMLElement
    const medicineSection = container.querySelector('#s_meds0001') as HTMLElement
    expect(within(productsSection).getByText('Retinol serum')).toBeInTheDocument()
    expect(within(productsSection).queryByText('Magnesium glycinate')).toBeNull()
    expect(within(medicineSection).getByText('Magnesium glycinate')).toBeInTheDocument()
    expect(within(medicineSection).getByText('Arnica gel')).toBeInTheDocument()
    expect(within(medicineSection).queryByText('Retinol serum')).toBeNull()
    expect(
      within(medicineSection).getByRole('link', { name: /visit the medicine store/i })
    ).toHaveAttribute('href', '/s/everwell/store?type=medicines')
  })

  it('product sections with nothing to show are left off the live site, hinted in the builder', () => {
    const sections = [
      sec('s_prod0002', 'featured-products', {
        heading: 'Our products',
        productIds: [],
        maxItems: 4,
      }),
      sec('s_meds0002', 'medicine-store', { heading: 'Our pharmacy', productIds: [], maxItems: 4 }),
    ]
    const { unmount } = render(
      <SiteRenderer payload={payload(sections)} base="/s/everwell" mode="live" />
    )
    expect(screen.queryByText('Our products')).toBeNull()
    expect(screen.queryByText('Our pharmacy')).toBeNull()
    unmount()
    render(<SiteRenderer payload={payload(sections)} base="" mode="editor" />)
    expect(screen.getByText('Our pharmacy')).toBeInTheDocument()
    expect(screen.getByText(/prescription medicines are never shown/i)).toBeInTheDocument()
  })

  it('the homepage menu shows settings.homeMenu, without links that lead nowhere', () => {
    const p = payload([sec('s_quick001', 'quick-links', { heading: 'Explore' })])
    p.site.settings.homeMenu = {
      items: [
        { label: 'Treatments', link: { kind: 'route', route: 'services', href: '/services' } },
        { label: 'Products', link: { kind: 'route', route: 'store', href: null } },
        { label: 'Book a visit', link: { kind: 'booking', href: '/book' } },
      ],
    }
    render(<SiteRenderer payload={p} base="/s/everwell" mode="live" />)
    const nav = screen.getByRole('navigation', { name: 'Explore' })
    expect(within(nav).getByRole('link', { name: 'Treatments' })).toHaveAttribute(
      'href',
      '/s/everwell/services'
    )
    expect(within(nav).getByRole('link', { name: 'Book a visit' })).toBeInTheDocument()
    expect(within(nav).queryByText('Products')).toBeNull()
  })

  it('header items with sub-items open a dropdown (click / Escape), keyboard-reachable', () => {
    const p = payload([])
    p.site.settings.header.links = [
      {
        label: 'Treatments',
        link: { kind: 'route', route: 'services', href: '/services' },
        children: [
          {
            label: 'Facials',
            link: { kind: 'service', serviceId: 's1', href: '/services/facials' },
          },
          { label: 'Gone', link: { kind: 'page', pageId: 'x', href: null } },
        ],
      },
    ]
    render(<SiteRenderer payload={p} base="/s/everwell" mode="live" />)
    const toggle = screen.getAllByRole('button', { name: /treatments/i, hidden: true })[0]!
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Facials', hidden: true })).toHaveAttribute(
      'href',
      '/s/everwell/services/facials'
    )
    // The parent stays reachable as the first dropdown entry; dead sub-items are dropped.
    expect(screen.getByRole('link', { name: 'Treatments', hidden: true })).toBeInTheDocument()
    expect(screen.queryByText('Gone')).toBeNull()
    fireEvent.keyDown(toggle, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('the store splits Medicines from other products, and ?type=medicines opens on Medicines', () => {
    window.history.replaceState(null, '', '/store?type=medicines')
    const p = withProducts([])
    p.route = { key: 'store', path: '/store', params: {} }
    p.page = null as unknown as RenderPayload['page']
    render(<SiteRenderer payload={p} base="" mode="live" />)
    const tab = screen.getByRole('tab', { name: 'Medicines' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('Retinol serum')).toBeNull()
    expect(screen.getByText('Arnica gel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Other products' }))
    expect(screen.getByText('Retinol serum')).toBeInTheDocument()
    expect(screen.queryByText('Arnica gel')).toBeNull()
    window.history.replaceState(null, '', '/')
  })
})
