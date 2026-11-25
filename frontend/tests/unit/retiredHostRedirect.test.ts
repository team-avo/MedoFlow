/**
 * Retired-host redirects (medoflow.pages.dev -> medoflow.com migration). The
 * Worker runs retiredHostRedirect() first; it 308s old free addresses to the new
 * root and leaves everything else alone. It must be a no-op until the operator
 * sets LEGACY_ROOT_DOMAINS, so merging the code is harmless before cut-over.
 */
import { describe, expect, it } from 'vitest'
import { retiredHostRedirect, type RetiredHostEnv } from '@/lib/site/retiredHostRedirect'

const ENV: RetiredHostEnv = {
  LEGACY_ROOT_DOMAINS: 'medoflow.pages.dev,medoflow-web.advertout-medoflow.workers.dev',
  SITE_ROOT_DOMAIN: 'medoflow.com',
}

/** Status + Location for a redirect, or null when the request is served as-is. */
function moved(url: string, env: RetiredHostEnv = ENV) {
  const res = retiredHostRedirect(url, env)
  if (!res) return null
  return { status: res.status, location: res.headers.get('location') }
}

describe('retiredHostRedirect', () => {
  it('308s the old app root to medoflow.com, keeping path and query', () => {
    expect(moved('https://medoflow.pages.dev/login?next=%2Fdashboard')).toEqual({
      status: 308,
      location: 'https://medoflow.com/login?next=%2Fdashboard',
    })
  })

  it('308s the workers.dev address to medoflow.com', () => {
    expect(moved('https://medoflow-web.advertout-medoflow.workers.dev/x')).toEqual({
      status: 308,
      location: 'https://medoflow.com/x',
    })
  })

  it('308s a clinic subdomain to the same label under medoflow.com', () => {
    expect(moved('https://test-clinic.medoflow.pages.dev/book/123')).toEqual({
      status: 308,
      location: 'https://test-clinic.medoflow.com/book/123',
    })
  })

  it('keeps the method and body (308, not 301/302)', () => {
    // A POST replayed to the new host must not be downgraded to GET: 308 preserves it.
    expect(moved('https://test-clinic.medoflow.pages.dev/api/v1/bookings')?.status).toBe(308)
  })

  it('preserves an empty path as /', () => {
    expect(moved('https://medoflow.pages.dev/')).toEqual({
      status: 308,
      location: 'https://medoflow.com/',
    })
  })

  it('normalizes a mixed-case host and ignores the port', () => {
    expect(moved('https://Test-Clinic.MedoFlow.Pages.Dev:443/x')).toEqual({
      status: 308,
      location: 'https://test-clinic.medoflow.com/x',
    })
  })

  it('sends a reserved label to the app root host, never a made-up clinic address', () => {
    // The path is kept (deep links survive); only the fabricated clinic host is dropped.
    expect(moved('https://app.medoflow.pages.dev/x')).toEqual({
      status: 308,
      location: 'https://medoflow.com/x',
    })
    expect(moved('https://www.medoflow.pages.dev/')?.location).toBe('https://medoflow.com/')
  })

  it('sends a Pages preview-hash host to the app root host', () => {
    expect(moved('https://a1b2c3d4.medoflow.pages.dev/x')?.location).toBe('https://medoflow.com/x')
  })

  it('sends a multi-label host under the old root to the app root host', () => {
    expect(moved('https://a.b.medoflow.pages.dev/x')?.location).toBe('https://medoflow.com/x')
  })

  it('leaves the new root and its subdomains alone', () => {
    expect(moved('https://medoflow.com/login')).toBeNull()
    expect(moved('https://test-clinic.medoflow.com/x')).toBeNull()
  })

  it('leaves a clinic custom domain alone', () => {
    expect(moved('https://www.drsmith.com/book')).toBeNull()
  })

  it('is a no-op when LEGACY_ROOT_DOMAINS is empty (pre-cut-over)', () => {
    const off: RetiredHostEnv = { LEGACY_ROOT_DOMAINS: '', SITE_ROOT_DOMAIN: 'medoflow.com' }
    expect(retiredHostRedirect('https://medoflow.pages.dev/login', off)).toBeNull()
    expect(retiredHostRedirect('https://test-clinic.medoflow.pages.dev/', {})).toBeNull()
  })

  it('is a no-op when SITE_ROOT_DOMAIN is missing', () => {
    expect(
      retiredHostRedirect('https://medoflow.pages.dev/x', {
        LEGACY_ROOT_DOMAINS: 'medoflow.pages.dev',
      })
    ).toBeNull()
  })

  it('returns null for a malformed request url', () => {
    expect(retiredHostRedirect('not a url', ENV)).toBeNull()
  })
})
