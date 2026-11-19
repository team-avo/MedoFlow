/**
 * CTO-38: DNS diagnostics for clinic custom domains: zone detection, DNS
 * provider detection, and the plain-language message for each wrong record.
 * DNS is a stub; nothing leaves the machine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkRecords,
  detectDnsProvider,
  dnsProviderLabel,
  findZone,
  isCloudflareIp,
  relativeHost,
  routingRecord,
  ownershipRecord,
  type DnsResolver,
} from '../site/domainProvider/diagnose'
import { siteCnameTarget } from '../site/config'

const nodata = () => Promise.reject(new Error('ENODATA'))
const dns = (over: Partial<DnsResolver>): DnsResolver => ({
  resolveTxt: nodata,
  resolveCname: nodata,
  resolve4: nodata,
  resolveNs: nodata,
  resolveCaa: nodata,
  ...over,
})
const host = 'www.clinic.example'
const token = 'tok123'
const TARGET = 'medoflow.pages.dev'
const goodTxt = () => Promise.resolve([['medoflow-verify=tok123']])
const goodCname = (n: string) =>
  n === host ? Promise.resolve(['Medoflow.Pages.Dev.']) : Promise.reject(new Error('ENODATA'))

afterEach(() => vi.unstubAllEnvs())

describe('findZone', () => {
  it('walks up to the first name with NS records (no public suffix list needed)', async () => {
    const z = await findZone(
      'www.clinic.co.uk',
      dns({
        resolveNs: (n) =>
          n === 'clinic.co.uk'
            ? Promise.resolve(['NS2.Domaincontrol.com.', 'ns1.domaincontrol.com'])
            : n === 'co.uk'
              ? Promise.resolve(['dns1.nic.uk'])
              : nodata(),
      })
    )
    expect(z).toEqual({
      zone: 'clinic.co.uk',
      nameservers: ['ns1.domaincontrol.com', 'ns2.domaincontrol.com'],
    })
  })

  it('skips a host that is already a CNAME (its NS answer would be the target’s)', async () => {
    const z = await findZone(
      host,
      dns({
        resolveCname: goodCname,
        resolveNs: (n) =>
          n === host
            ? Promise.resolve(['ns.pages-target.example'])
            : n === 'clinic.example'
              ? Promise.resolve(['ada.ns.cloudflare.com'])
              : nodata(),
      })
    )
    expect(z?.zone).toBe('clinic.example')
  })

  it('returns null when nothing answers (never throws)', async () => {
    expect(await findZone(host, dns({}))).toBeNull()
  })
})

describe('detectDnsProvider', () => {
  it.each([
    [['ns51.domaincontrol.com'], 'godaddy'],
    [['dns1.registrar-servers.com'], 'namecheap'],
    [['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'], 'cloudflare'],
    [['ns-cloud-a1.googledomains.com'], 'squarespace'],
    [['ns1.squarespacedns.com'], 'squarespace'],
    [['ns-123.awsdns-45.com'], 'route53'],
    [['ns1083.ui-dns.de'], 'ionos'],
    [['ns2.wixdns.net'], 'wix'],
    [['ns1.example-host.net'], 'other'],
    [[], 'other'],
  ])('%j → %s', (ns, key) => {
    expect(detectDnsProvider(ns).key).toBe(key)
  })

  it('has a display name for every stored key', () => {
    expect(dnsProviderLabel('godaddy')).toBe('GoDaddy')
    expect(dnsProviderLabel('squarespace')).toMatch(/Google Domains/)
    expect(dnsProviderLabel('other')).toBe('your DNS provider')
    expect(dnsProviderLabel(null)).toBeNull()
  })
})

describe('records with zone-relative hosts', () => {
  it('names records the way DNS providers ask for them', () => {
    vi.stubEnv('SITE_CNAME_TARGET', TARGET)
    expect(relativeHost('www.clinic.example', 'clinic.example')).toBe('www')
    expect(relativeHost('clinic.example', 'clinic.example')).toBe('@')
    expect(relativeHost('other.test', 'clinic.example')).toBeUndefined()
    expect(routingRecord(host, 'clinic.example')).toMatchObject({
      type: 'CNAME',
      name: host,
      host: 'www',
      value: TARGET,
    })
    expect(ownershipRecord(host, token, 'clinic.example')).toMatchObject({
      type: 'TXT',
      host: '_medoflow-verify.www',
      value: 'medoflow-verify=tok123',
    })
  })

  it('the pages provider defaults the CNAME target to <project>.pages.dev', () => {
    vi.stubEnv('SITE_CNAME_TARGET', '')
    vi.stubEnv('DOMAIN_PROVIDER', 'pages')
    vi.stubEnv('CF_PAGES_PROJECT', 'medoflow')
    expect(siteCnameTarget()).toBe('medoflow.pages.dev')
    vi.stubEnv('DOMAIN_PROVIDER', 'manual')
    vi.stubEnv('SITE_ROOT_DOMAIN', 'site.test')
    expect(siteCnameTarget()).toBe('sites.site.test')
  })
})

describe('checkRecords', () => {
  const run = (over: Partial<DnsResolver>) =>
    checkRecords({ hostname: host, token, target: TARGET }, dns(over))

  it('both records right → ok, no message', async () => {
    const r = await run({ resolveTxt: goodTxt, resolveCname: goodCname })
    expect(r.ok).toBe(true)
    expect(r.error).toBeNull()
    expect(r.checks.map((c) => [c.type, c.ok])).toEqual([
      ['CNAME', true],
      ['TXT', true],
    ])
  })

  it('TXT missing is the first thing the owner hears about', async () => {
    const r = await run({ resolveCname: goodCname })
    expect(r.ok).toBe(false)
    expect(r.error).toBe(
      'TXT record _medoflow-verify.www.clinic.example not found yet (DNS changes can take up to an hour)'
    )
  })

  it('TXT with a different value says what was found and what is expected', async () => {
    const r = await run({
      resolveTxt: () => Promise.resolve([['medoflow-verify=old']]),
      resolveCname: goodCname,
    })
    expect(r.error).toBe(
      'TXT record _medoflow-verify.www.clinic.example has "medoflow-verify=old", expected "medoflow-verify=tok123"'
    )
  })

  it('CNAME pointing elsewhere: "points to X, expected Y"', async () => {
    const r = await run({
      resolveTxt: goodTxt,
      resolveCname: () => Promise.resolve(['parked.godaddy.com.']),
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe(
      'CNAME www.clinic.example points to parked.godaddy.com, expected medoflow.pages.dev'
    )
    expect(r.checks[0]).toMatchObject({ ok: false, found: ['parked.godaddy.com'] })
  })

  it('an A record instead of a CNAME is named, with the fix', async () => {
    const r = await run({
      resolveTxt: goodTxt,
      resolve4: (n) => Promise.resolve(n === TARGET ? ['172.66.44.1'] : ['50.63.202.1']),
    })
    expect(r.error).toMatch(/has an A record \(50\.63\.202\.1\) instead of a CNAME/)
  })

  it('a Cloudflare-proxied record ("orange cloud") is spotted', async () => {
    const r = await run({
      resolveTxt: goodTxt,
      resolve4: (n) => Promise.resolve(n === TARGET ? ['172.66.44.1'] : ['104.21.5.9']),
    })
    expect(r.error).toMatch(/proxied by Cloudflare \(orange cloud\).*DNS only/)
    expect(isCloudflareIp('104.21.5.9')).toBe(true)
    expect(isCloudflareIp('8.8.8.8')).toBe(false)
  })

  it('no record at all says so', async () => {
    const r = await run({ resolveTxt: goodTxt })
    expect(r.error).toBe(
      'No CNAME record for www.clinic.example yet. Add a CNAME pointing to medoflow.pages.dev'
    )
  })

  it('a flattened apex with the target’s addresses counts as right', async () => {
    const r = await checkRecords(
      { hostname: 'clinic.example', token, target: TARGET },
      dns({
        resolveTxt: goodTxt,
        resolve4: (n) => Promise.resolve(n === TARGET ? ['1.2.3.4', '5.6.7.8'] : ['1.2.3.4']),
      })
    )
    expect(r.ok).toBe(true)
  })

  it('CAA records that exclude the certificate authorities are reported (inherited from the zone)', async () => {
    const r = await run({
      resolveTxt: goodTxt,
      resolveCname: goodCname,
      resolveCaa: (n) =>
        n === 'clinic.example'
          ? Promise.resolve([{ critical: 0, issue: 'digicert-only.example' }])
          : nodata(),
    })
    expect(r.ok).toBe(true) // ownership and routing are fine…
    expect(r.error).toMatch(/CAA records on clinic\.example only allow digicert-only\.example/)
    const allowed = await run({
      resolveTxt: goodTxt,
      resolveCname: goodCname,
      resolveCaa: () => Promise.resolve([{ critical: 0, issue: 'letsencrypt.org' }]),
    })
    expect(allowed.error).toBeNull()
  })
})
