/**
 * Demo feedback WS1: session handoff to a clinic's own domain: when the
 * booking page bounces through the app host, and how the code comes back.
 */
import { describe, expect, it } from 'vitest'
import {
  configuredAppOrigin,
  handoffBounceUrl,
  readHandoffParam,
  withoutHandoffParam,
} from '@/lib/authHandoff'

const env = { SITE_ROOT_DOMAIN: 'medoflow.test', APP_HOSTS: 'app.medoflow.test,localhost' }
const APP = 'https://app.medoflow.test'
const BOOK = '/book/svc_1?clinicId=c1'

describe('handoffBounceUrl', () => {
  it('bounces a clinic subdomain or custom domain through the app host, carrying the page', () => {
    for (const origin of ['https://everwell.medoflow.test', 'https://www.everwellclinic.com']) {
      const got = handoffBounceUrl(`${origin}${BOOK}`, APP, env)
      expect(got).not.toBeNull()
      const url = new URL(got!)
      expect(url.origin).toBe(APP)
      expect(url.pathname).toBe('/auth/handoff')
      expect(url.searchParams.get('return')).toBe(`${origin}${BOOK}`)
    }
  })

  it('never bounces on the app host, after a bounce, or without an app origin', () => {
    expect(handoffBounceUrl(`${APP}${BOOK}`, APP, env)).toBeNull()
    expect(handoffBounceUrl(`https://localhost${BOOK}`, APP, env)).toBeNull()
    expect(
      handoffBounceUrl(`https://everwell.medoflow.test${BOOK}&handoff=none`, APP, env)
    ).toBeNull()
    expect(handoffBounceUrl(`https://everwell.medoflow.test${BOOK}`, null, env)).toBeNull()
    expect(handoffBounceUrl('not a url', APP, env)).toBeNull()
  })

  it('works for local clinic subdomains (<label>.localhost)', () => {
    const local = { SITE_ROOT_DOMAIN: 'localhost' }
    const got = handoffBounceUrl(
      `http://everwell.localhost:3000${BOOK}`,
      'http://localhost:3000',
      local
    )
    expect(new URL(got!).origin).toBe('http://localhost:3000')
  })
})

describe('the code on the way back', () => {
  it('reads the handoff param and strips it, keeping the rest of the URL', () => {
    const back = `https://everwell.medoflow.test${BOOK}&handoff=abc123#top`
    expect(readHandoffParam(back)).toBe('abc123')
    expect(withoutHandoffParam(back)).toBe(`${BOOK}#top`)
    expect(readHandoffParam(`https://everwell.medoflow.test${BOOK}`)).toBeNull()
    expect(withoutHandoffParam('https://x.medoflow.test/book/s?handoff=none')).toBe('/book/s')
  })

  it('configuredAppOrigin normalises the env value and ignores junk', () => {
    expect(configuredAppOrigin('https://app.medoflow.test/some/path')).toBe(APP)
    expect(configuredAppOrigin('')).toBeNull()
    expect(configuredAppOrigin(undefined)).toBeNull()
    expect(configuredAppOrigin('::nope')).toBeNull()
  })
})
