/**
 * CTO-38: guided custom-domain connect on the Domains screen. Detected DNS
 * provider guides, per-record checks, the progress stepper moving on its own
 * while the screen polls, "Connect automatically", and the root-domain
 * "Add www instead" path. The site API is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { SiteDomain } from '@/lib/site/siteApi'

const siteApiMock = vi.hoisted(() => ({
  getSite: vi.fn(),
  listDomains: vi.fn(),
  addDomain: vi.fn(),
  verifyDomain: vi.fn(),
  getDomainStatus: vi.fn(),
  getDomainConnect: vi.fn(),
  domainConnectReturn: vi.fn(),
  setPrimaryDomain: vi.fn(),
  removeDomain: vi.fn(),
  changeSubdomain: vi.fn(),
}))
vi.mock('@/lib/site/siteApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/site/siteApi')>()),
  siteApi: siteApiMock,
}))
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))

import SiteDomainsPage from '@/app/dashboard/site/domains/page'
import { DomainStepper, POLL_FAST_MS } from '@/components/site/domains/DomainConnectCard'
import { dnsGuide, dnsSettingsUrl, fillDomain } from '@/lib/site/dnsProviderGuides'

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  )

const sub: SiteDomain = {
  id: 'd1',
  kind: 'SUBDOMAIN',
  hostname: 'everwell.medoflow.pages.dev',
  status: 'VERIFIED',
  stage: 'live',
  isPrimary: true,
  sslStatus: null,
  lastError: null,
  lastCheckedAt: null,
  verifiedAt: null,
  url: 'https://everwell.medoflow.pages.dev',
  records: [],
}

function custom(over: Partial<SiteDomain> = {}): SiteDomain {
  return {
    id: 'd2',
    kind: 'CUSTOM',
    hostname: 'www.everwell.example',
    status: 'FAILED',
    stage: 'dns',
    isPrimary: false,
    sslStatus: null,
    lastError:
      'CNAME www.everwell.example points to parked.godaddy.com, expected medoflow.pages.dev',
    lastCheckedAt: null,
    verifiedAt: null,
    zone: 'everwell.example',
    dnsProvider: { key: 'godaddy', name: 'GoDaddy' },
    checks: [
      {
        type: 'CNAME',
        name: 'www.everwell.example',
        purpose: 'routing',
        ok: false,
        found: ['parked.godaddy.com'],
        message:
          'CNAME www.everwell.example points to parked.godaddy.com, expected medoflow.pages.dev',
      },
      {
        type: 'TXT',
        name: '_medoflow-verify.www.everwell.example',
        purpose: 'ownership',
        ok: true,
        found: ['medoflow-verify=abc'],
        message: null,
      },
    ],
    url: 'https://www.everwell.example',
    records: [
      {
        type: 'CNAME',
        name: 'www.everwell.example',
        host: 'www',
        value: 'medoflow.pages.dev',
        purpose: 'routing',
      },
      {
        type: 'TXT',
        name: '_medoflow-verify.www.everwell.example',
        host: '_medoflow-verify.www',
        value: 'medoflow-verify=abc',
        purpose: 'ownership',
      },
    ],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  siteApiMock.getSite.mockResolvedValue({ entitlements: { maxCustomDomains: 3 } })
  siteApiMock.getDomainConnect.mockResolvedValue({ available: false, reason: 'not_configured' })
})
afterEach(() => vi.useRealTimers())

describe('DNS provider guides', () => {
  it.each([
    ['godaddy', 'GoDaddy', 'Name', /dcc\.godaddy\.com\/control\/portfolio\/clinic\.example/],
    [
      'namecheap',
      'Namecheap',
      'Host',
      /namecheap\.com\/Domains\/DomainControlPanel\/clinic\.example/,
    ],
    ['cloudflare', 'Cloudflare', 'Name', /dash\.cloudflare\.com/],
    ['squarespace', 'Squarespace (formerly Google Domains)', 'Host', /squarespace\.com/],
  ])('%s has its own wording, steps and DNS link', (key, name, hostLabel, url) => {
    const g = dnsGuide(key)
    expect(g.name).toBe(name)
    expect(g.hostLabel).toBe(hostLabel)
    expect(g.steps.length).toBeGreaterThanOrEqual(2)
    expect(g.forwarding).toMatch(/www\.\{domain\}/)
    expect(dnsSettingsUrl(g, 'clinic.example')).toMatch(url)
  })

  it('Cloudflare warns about the orange cloud; Namecheap about quotes', () => {
    expect(dnsGuide('cloudflare').notes.join(' ')).toMatch(/DNS only \(grey cloud\)/)
    expect(dnsGuide('namecheap').notes.join(' ')).toMatch(/without quotation marks/)
  })

  it('unknown providers get the generic guide (no link)', () => {
    const g = dnsGuide('somebody-else')
    expect(g.key).toBe('other')
    expect(dnsSettingsUrl(g, 'clinic.example')).toBeNull()
    expect(fillDomain(g.steps[0]!, 'clinic.example')).toContain('clinic.example')
  })
})

describe('progress stepper', () => {
  it.each([
    ['dns', ['current', 'todo', 'todo', 'todo']],
    ['verified', ['done', 'current', 'todo', 'todo']],
    ['ssl', ['done', 'done', 'current', 'todo']],
    ['live', ['done', 'done', 'done', 'done']],
    ['error', ['done', 'done', 'error', 'todo']],
  ] as const)('%s', (stage, states) => {
    render(<DomainStepper stage={stage} />)
    expect(
      ['dns', 'verified', 'ssl', 'live'].map((s) => screen.getByTestId(`step-${s}`).dataset.state)
    ).toEqual(states)
  })
})

describe('guided connect card', () => {
  it('names the detected provider, links to its DNS settings and shows zone-relative hosts', async () => {
    siteApiMock.listDomains.mockResolvedValue({
      rootDomain: 'medoflow.pages.dev',
      domains: [sub, custom()],
    })
    siteApiMock.getDomainStatus.mockResolvedValue(custom())
    wrap(<SiteDomainsPage />)
    const guide = await screen.findByTestId('dns-guide')
    expect(guide).toHaveTextContent('We detected GoDaddy manages DNS for everwell.example')
    expect(screen.getByRole('link', { name: /Open GoDaddy DNS settings/ })).toHaveAttribute(
      'href',
      'https://dcc.godaddy.com/control/portfolio/everwell.example/settings?tab=dns'
    )
    // GoDaddy wants "www", not the full name; the full name is shown under it.
    expect(screen.getByRole('button', { name: 'Copy www' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy _medoflow-verify.www' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy medoflow.pages.dev' })).toBeInTheDocument()
    // Per-record checks: the CNAME is wrong (with why), the TXT is found.
    const cname = screen.getByTestId('record-CNAME')
    expect(cname).toHaveTextContent('points to parked.godaddy.com, expected medoflow.pages.dev')
    expect(screen.getByTestId('record-TXT')).toHaveTextContent('Found')
  })

  it('polls on its own and moves dns → verified → ssl → live without a click', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    siteApiMock.listDomains.mockResolvedValue({
      rootDomain: 'medoflow.pages.dev',
      domains: [sub, custom()],
    })
    siteApiMock.getDomainStatus
      .mockResolvedValueOnce(custom())
      .mockResolvedValueOnce(custom({ status: 'VERIFIED', stage: 'verified', lastError: null }))
      .mockResolvedValueOnce(
        custom({ status: 'VERIFIED', stage: 'ssl', sslStatus: 'active', lastError: null })
      )
      .mockResolvedValue(
        custom({ status: 'VERIFIED', stage: 'live', sslStatus: 'active', lastError: null })
      )
    wrap(<SiteDomainsPage />)
    await screen.findByTestId('domain-www.everwell.example')
    expect(screen.getByTestId('step-dns').dataset.state).toBe('current')

    for (const expected of ['verified', 'ssl', 'live'] as const) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_FAST_MS + 50)
      })
      await waitFor(() =>
        expect(screen.getByTestId(`step-${expected}`).dataset.state).toBe(
          expected === 'live' ? 'done' : 'current'
        )
      )
    }
    expect(screen.getByTestId('domain-www.everwell.example')).toHaveTextContent('HTTPS active')
    expect(screen.getByRole('button', { name: 'Make primary' })).toBeInTheDocument()
    expect(toastMock.success).toHaveBeenCalledWith('www.everwell.example: Your domain is live')
    expect(siteApiMock.verifyDomain).not.toHaveBeenCalled()

    // Live: polling stops.
    const calls = siteApiMock.getDomainStatus.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_FAST_MS * 3)
    })
    expect(siteApiMock.getDomainStatus.mock.calls.length).toBe(calls)
  })

  it('offers "Connect automatically" only where Domain Connect is available', async () => {
    siteApiMock.listDomains.mockResolvedValue({
      rootDomain: 'medoflow.pages.dev',
      domains: [sub, custom()],
    })
    siteApiMock.getDomainStatus.mockResolvedValue(custom())
    siteApiMock.getDomainConnect.mockResolvedValue({
      available: true,
      providerName: 'GoDaddy',
      url: 'https://dcc.godaddy.example/v2/domainTemplates/providers/medoflow.example/services/clinic-site/apply?domain=everwell.example',
    })
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign, search: '', pathname: '/dashboard/site/domains' },
    })
    wrap(<SiteDomainsPage />)
    const box = await screen.findByTestId('domain-connect')
    expect(box).toHaveTextContent('GoDaddy can add these records for you in one step')
    fireEvent.click(screen.getByRole('button', { name: 'Connect automatically' }))
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('/apply?domain=everwell.example'))
    Object.defineProperty(window, 'location', { configurable: true, value: original })
  })

  it('hides the button when the provider has not onboarded the template', async () => {
    siteApiMock.listDomains.mockResolvedValue({
      rootDomain: 'medoflow.pages.dev',
      domains: [sub, custom()],
    })
    siteApiMock.getDomainStatus.mockResolvedValue(custom())
    siteApiMock.getDomainConnect.mockResolvedValue({ available: false, reason: 'template_missing' })
    wrap(<SiteDomainsPage />)
    await screen.findByTestId('dns-guide')
    await waitFor(() => expect(siteApiMock.getDomainConnect).toHaveBeenCalledWith('d2'))
    expect(screen.queryByTestId('domain-connect')).toBeNull()
  })

  it('a root domain is turned into a one-click "Add www instead"', async () => {
    siteApiMock.listDomains.mockResolvedValue({ rootDomain: 'medoflow.pages.dev', domains: [sub] })
    siteApiMock.addDomain
      .mockRejectedValueOnce({
        response: {
          data: {
            code: 'site_domain_apex',
            message: "Root domains can't be connected directly. Connect www.everwell.example",
          },
        },
      })
      .mockResolvedValueOnce(custom())
    wrap(<SiteDomainsPage />)
    fireEvent.change(await screen.findByLabelText('Domain'), {
      target: { value: 'everwell.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add domain' }))
    const hint = await screen.findByTestId('apex-hint')
    expect(hint).toHaveTextContent('Connect www.everwell.example instead')
    fireEvent.click(screen.getByRole('button', { name: 'Add www.everwell.example instead' }))
    await waitFor(() =>
      expect(siteApiMock.addDomain).toHaveBeenLastCalledWith('www.everwell.example')
    )
  })

  it('back from the DNS provider (?dc=…): checks the signed return and cleans the URL', async () => {
    window.history.replaceState(null, '', '/dashboard/site/domains?dc=d2&state=s123')
    siteApiMock.listDomains.mockResolvedValue({
      rootDomain: 'medoflow.pages.dev',
      domains: [sub, custom()],
    })
    siteApiMock.getDomainStatus.mockResolvedValue(custom())
    siteApiMock.domainConnectReturn.mockResolvedValue({
      ...custom({ status: 'VERIFIED', stage: 'verified' }),
      connectError: null,
    })
    wrap(<SiteDomainsPage />)
    await waitFor(() =>
      expect(siteApiMock.domainConnectReturn).toHaveBeenCalledWith('d2', { state: 's123' })
    )
    expect(window.location.search).toBe('')
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith('Records added. We are checking them now')
    )
  })
})
