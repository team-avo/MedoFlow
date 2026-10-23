/**
 * Component 8 — builder controls: generated field editors, the typed link
 * picker, upload pre-checks and the Domains screen (DNS records, plan lock).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const siteApiMock = vi.hoisted(() => ({
  getSite: vi.fn(),
  listDomains: vi.fn(),
  addDomain: vi.fn(),
  verifyDomain: vi.fn(),
  setPrimaryDomain: vi.fn(),
  removeDomain: vi.fn(),
  changeSubdomain: vi.fn(),
  listAssets: vi.fn(),
}))
vi.mock('@/lib/site/siteApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/site/siteApi')>()),
  siteApi: siteApiMock,
}))
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(async () => ({
      data: {
        data: {
          data: {
            services: [
              {
                id: 'svc1',
                slug: 'a',
                name: 'Follow-up',
                durationMinutes: 20,
                price: '1',
                discipline: null,
              },
            ],
            providers: [],
            products: [],
            packages: [],
            memberships: [],
            locations: [],
          },
          pages: [
            {
              id: 'p1',
              kind: 'STANDARD',
              slug: 'about',
              title: 'About',
              status: 'DRAFT',
              path: '/about',
            },
          ],
          assets: [],
          clinic: null,
          hasStore: false,
          showBadge: true,
        },
      },
    })),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { FieldEditor, LinkPicker } from '@/components/site/builder/fields'
import { imageUploadProblem } from '@/components/site/builder/MediaLibrary'
import { SECTION_BY_TYPE } from '@/lib/site/sections'
import SiteDomainsPage from '@/app/dashboard/site/domains/page'

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  )

beforeEach(() => vi.clearAllMocks())

describe('generated field editors', () => {
  it('a list field adds, edits and removes items', () => {
    const faq = SECTION_BY_TYPE.get('faq')!.fields.find((f) => f.key === 'items')!
    const onChange = vi.fn()
    const { rerender } = wrap(<FieldEditor field={faq} value={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /add question/i }))
    expect(onChange).toHaveBeenLastCalledWith([{ question: '', answer: '' }])
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <FieldEditor field={faq} value={[{ question: 'Q1', answer: '' }]} onChange={onChange} />
      </QueryClientProvider>
    )
    fireEvent.change(screen.getByDisplayValue('Q1'), { target: { value: 'Q1?' } })
    expect(onChange).toHaveBeenLastCalledWith([{ question: 'Q1?', answer: '' }])
    fireEvent.click(screen.getByRole('button', { name: 'Remove Question' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('numbers are clamped to the schema range', () => {
    const max = SECTION_BY_TYPE.get('service-grid')!.fields.find((f) => f.key === 'maxItems')!
    const onChange = vi.fn()
    wrap(<FieldEditor field={max} value={6} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '99' } })
    expect(onChange).toHaveBeenLastCalledWith(24)
  })

  it('the video field explains what it needs', () => {
    const f = SECTION_BY_TYPE.get('video')!.fields.find((x) => x.key === 'url')!
    wrap(<FieldEditor field={f} value="https://evil.example/x" onChange={vi.fn()} />)
    expect(screen.getByText(/YouTube or Vimeo link to save/)).toBeInTheDocument()
  })
})

describe('link picker', () => {
  it('only accepts safe external links', () => {
    const onChange = vi.fn()
    wrap(
      <LinkPicker value={{ kind: 'external', href: 'https://ok.example' }} onChange={onChange} />
    )
    const input = screen.getByLabelText('Link address')
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('Use https://, mailto: or tel:')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'tel:+15550100' } })
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'external', href: 'tel:+15550100' })
  })

  it('switches link kinds using the clinic’s real pages and services', async () => {
    const onChange = vi.fn()
    wrap(<LinkPicker value={{ kind: 'booking' }} onChange={onChange} />)
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Follow-up' })).toBeInTheDocument()
    )
    fireEvent.change(screen.getByLabelText('Service to book'), { target: { value: 'svc1' } })
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'booking', serviceId: 'svc1' })
    fireEvent.change(screen.getByLabelText('Link goes to'), { target: { value: 'page' } })
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'page', pageId: 'p1' })
  })
})

describe('upload pre-checks', () => {
  it('refuses non-images, SVG, empty and oversized files before any request', () => {
    expect(imageUploadProblem({ type: 'image/png', size: 1000 })).toBeNull()
    expect(imageUploadProblem({ type: 'image/svg+xml', size: 1000 })).toMatch(/JPEG, PNG/)
    expect(imageUploadProblem({ type: 'application/pdf', size: 1000 })).toMatch(/JPEG, PNG/)
    expect(imageUploadProblem({ type: 'image/jpeg', size: 6 * 1024 * 1024 })).toMatch(/5 MB/)
    expect(imageUploadProblem({ type: 'image/webp', size: 0 })).toMatch(/empty/)
  })
})

describe('Domains screen', () => {
  const domains = {
    rootDomain: 'medoflow.test',
    domains: [
      {
        id: 'd1',
        kind: 'SUBDOMAIN',
        hostname: 'everwell.medoflow.test',
        status: 'VERIFIED',
        isPrimary: true,
        sslStatus: null,
        lastError: null,
        lastCheckedAt: null,
        verifiedAt: null,
        url: 'https://everwell.medoflow.test',
        records: [],
      },
      {
        id: 'd2',
        kind: 'CUSTOM',
        hostname: 'www.everwell.example',
        status: 'FAILED',
        isPrimary: false,
        sslStatus: null,
        lastError: 'TXT record not found yet',
        lastCheckedAt: null,
        verifiedAt: null,
        url: 'https://www.everwell.example',
        records: [
          {
            type: 'CNAME',
            name: 'www.everwell.example',
            value: 'sites.medoflow.test',
            purpose: 'routing',
          },
          {
            type: 'TXT',
            name: '_medoflow-verify.www.everwell.example',
            value: 'medoflow-verify=abc',
            purpose: 'ownership',
          },
        ],
      },
    ],
  }

  it('shows the subdomain and the DNS records to create; Verify calls the API', async () => {
    siteApiMock.getSite.mockResolvedValue({ entitlements: { maxCustomDomains: 1 } })
    siteApiMock.listDomains.mockResolvedValue(domains)
    siteApiMock.verifyDomain.mockResolvedValue({ ...domains.domains[1], status: 'VERIFIED' })
    wrap(<SiteDomainsPage />)
    expect(await screen.findByTestId('subdomain-url')).toHaveTextContent('everwell.medoflow.test')
    expect(screen.getByText('TXT record not found yet')).toBeInTheDocument()
    expect(screen.getByText('_medoflow-verify.www.everwell.example')).toBeInTheDocument()
    expect(screen.getByText('sites.medoflow.test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(siteApiMock.verifyDomain).toHaveBeenCalledWith('d2'))
  })

  it('locks custom domains on plans without them', async () => {
    siteApiMock.getSite.mockResolvedValue({ entitlements: { maxCustomDomains: 0 } })
    siteApiMock.listDomains.mockResolvedValue({ ...domains, domains: [domains.domains[0]] })
    wrap(<SiteDomainsPage />)
    expect(await screen.findByTestId('domain-plan-lock')).toHaveTextContent(
      'Custom domains are on paid plans'
    )
    expect(screen.queryByLabelText('Domain')).toBeNull()
  })
})
