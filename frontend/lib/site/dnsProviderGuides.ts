/**
 * Step-by-step DNS instructions per DNS provider (CTO-38), in the words each
 * provider's own screens use. The backend detects the provider from the
 * domain's name servers (`SiteDomain.dnsProvider.key`); unknown providers get
 * the generic guide.
 *
 * Links open the provider's DNS settings for the domain where the provider
 * has a stable URL; otherwise its domain list. Providers change their
 * screens, so steps describe what to look for, not pixel positions.
 */

export type DnsGuideKey =
  | 'godaddy'
  | 'namecheap'
  | 'cloudflare'
  | 'squarespace'
  | 'route53'
  | 'ionos'
  | 'wix'
  | 'other'

export interface DnsProviderGuide {
  key: DnsGuideKey
  name: string
  /** DNS settings page; `{domain}` is replaced by the zone. */
  dnsUrl: string | null
  /** What the provider calls the record-name field. */
  hostLabel: string
  /** What the provider calls the value field (CNAME and TXT). */
  valueLabel: string
  /** The provider wants the zone-relative name (`www`), not the full one. */
  relativeHost: boolean
  /** Steps before the records table. */
  steps: string[]
  /** Extra warnings, shown under the records. */
  notes: string[]
  /** How to send the root domain to www (root domains can't use a CNAME here). */
  forwarding: string
}

const GUIDES: Record<DnsGuideKey, DnsProviderGuide> = {
  godaddy: {
    key: 'godaddy',
    name: 'GoDaddy',
    dnsUrl: 'https://dcc.godaddy.com/control/portfolio/{domain}/settings?tab=dns',
    hostLabel: 'Name',
    valueLabel: 'Value',
    relativeHost: true,
    steps: [
      'Sign in to GoDaddy and open My Products › Domains › {domain} › DNS.',
      'Under DNS Records, choose Add New Record for each record below.',
      'Leave TTL at the default (1 hour) and choose Save.',
    ],
    notes: [
      'GoDaddy adds .{domain} to the name for you: type only the part shown in the Name column.',
      'If a record called www already exists (often a CNAME to @ or a parked page), edit it instead of adding a second one.',
    ],
    forwarding:
      'In GoDaddy, open Domains › {domain} › Forwarding, choose Add Forwarding, enter https://www.{domain}, pick Permanent (301) and save.',
  },
  namecheap: {
    key: 'namecheap',
    name: 'Namecheap',
    dnsUrl: 'https://ap.www.namecheap.com/Domains/DomainControlPanel/{domain}/advancedns',
    hostLabel: 'Host',
    valueLabel: 'Value / Target',
    relativeHost: true,
    steps: [
      'Sign in to Namecheap, open Domain List and choose Manage next to {domain}.',
      'Open the Advanced DNS tab and choose Add New Record for each record below.',
      'Leave TTL on Automatic and press the green tick to save each row.',
    ],
    notes: [
      'Type the TXT value without quotation marks; Namecheap adds them.',
      'Delete any URL Redirect Record or parking-page CNAME on the same host first.',
      'Advanced DNS only appears while the domain uses Namecheap BasicDNS or PremiumDNS.',
    ],
    forwarding:
      'In Advanced DNS, add a URL Redirect Record with Host @ pointing to https://www.{domain}, type Permanent (301).',
  },
  cloudflare: {
    key: 'cloudflare',
    name: 'Cloudflare',
    dnsUrl: 'https://dash.cloudflare.com/?to=/:account/{domain}/dns/records',
    hostLabel: 'Name',
    valueLabel: 'Target / Content',
    relativeHost: true,
    steps: [
      'Sign in to Cloudflare, choose {domain} and open DNS › Records.',
      'Choose Add record for each record below.',
      'For the CNAME, switch Proxy status to DNS only (grey cloud) before saving.',
    ],
    notes: [
      'Keep the CNAME on DNS only (grey cloud). A proxied (orange) record hides the CNAME and the domain can’t be verified.',
    ],
    forwarding:
      'Create a Redirect Rule (Rules › Redirect Rules) that sends {domain}/* to https://www.{domain}/${1} with status 301, and add a proxied A record for @ to 192.0.2.1 so the rule has something to run on.',
  },
  squarespace: {
    key: 'squarespace',
    name: 'Squarespace (formerly Google Domains)',
    dnsUrl: 'https://account.squarespace.com/domains/managed/{domain}/dns/dns-settings',
    hostLabel: 'Host',
    valueLabel: 'Data',
    relativeHost: true,
    steps: [
      'Sign in to Squarespace Domains (domains.squarespace.com) and open {domain}.',
      'Open DNS › DNS Settings and scroll to Custom records.',
      'Choose Add record for each record below, then Save.',
    ],
    notes: [
      'Domains moved from Google Domains are managed here now, with the same records.',
      'If a www record already points to a Squarespace or Google site, delete it first.',
    ],
    forwarding:
      'Open Domain forwarding, add a rule from {domain} to https://www.{domain}, choose Permanent redirect (301) and save.',
  },
  route53: {
    key: 'route53',
    name: 'Amazon Route 53',
    dnsUrl: 'https://us-east-1.console.aws.amazon.com/route53/v2/hostedzones',
    hostLabel: 'Record name',
    valueLabel: 'Value',
    relativeHost: true,
    steps: [
      'Open the Route 53 console › Hosted zones › {domain}.',
      'Choose Create record for each record below (Simple routing).',
      'For the TXT record, wrap the value in double quotes.',
    ],
    notes: [
      'Route 53 shows the zone name after the Record name box: type only the part shown below.',
    ],
    forwarding:
      'Route 53 has no built-in forwarding: use an S3 website redirect bucket with CloudFront, or connect www only and tell visitors to use it.',
  },
  ionos: {
    key: 'ionos',
    name: 'IONOS',
    dnsUrl: 'https://my.ionos.com/domains',
    hostLabel: 'Host name',
    valueLabel: 'Points to / Value',
    relativeHost: true,
    steps: [
      'Sign in to IONOS, open Domains & SSL and choose the gear next to {domain} › DNS.',
      'Choose Add record for each record below and save.',
    ],
    notes: ['IONOS may offer to delete conflicting records when you add the CNAME: accept.'],
    forwarding:
      'Under Domains & SSL › {domain} › Destination, choose Forward to https://www.{domain} with HTTP 301.',
  },
  wix: {
    key: 'wix',
    name: 'Wix',
    dnsUrl: 'https://manage.wix.com/account/domains',
    hostLabel: 'Host Name',
    valueLabel: 'Value / Points to',
    relativeHost: true,
    steps: [
      'Sign in to Wix, open Domains and choose ⋯ › Manage DNS Records next to {domain}.',
      'Add each record below in its section (CNAME, TXT) and Save.',
    ],
    notes: [
      'If the domain is still connected to a Wix site, its www record points there: change it to the value below.',
    ],
    forwarding:
      'Wix keeps the root domain on its own servers: connect www here and set the Wix site to redirect the root to www, or move the domain’s DNS elsewhere.',
  },
  other: {
    key: 'other',
    name: 'your DNS provider',
    dnsUrl: null,
    hostLabel: 'Name / Host',
    valueLabel: 'Value / Target',
    relativeHost: true,
    steps: [
      'Sign in where you bought {domain} (or where its DNS is managed) and open its DNS settings.',
      'Add each record below. Most providers want the short name in the first column; if yours asks for the full name, use the full name shown under it.',
      'Leave TTL at the default and save.',
    ],
    notes: [
      'Delete any existing record with the same name and type first (a parking page, an old site).',
    ],
    forwarding:
      'Most providers have a “domain forwarding” or “redirect” setting: send {domain} to https://www.{domain} with a permanent (301) redirect.',
  },
}

const KEYS = new Set(Object.keys(GUIDES))

/** The guide for a detected provider key (unknown keys get the generic one). */
export function dnsGuide(key: string | null | undefined): DnsProviderGuide {
  return GUIDES[(key && KEYS.has(key) ? key : 'other') as DnsGuideKey]
}

/** `{domain}` → the zone, in steps, notes, forwarding and links. */
export function fillDomain(text: string, domain: string): string {
  return text.replaceAll('{domain}', domain)
}

export function dnsSettingsUrl(guide: DnsProviderGuide, zone: string | null | undefined) {
  if (!guide.dnsUrl) return null
  if (guide.dnsUrl.includes('{domain}') && !zone) return null
  return fillDomain(guide.dnsUrl, encodeURIComponent(zone ?? ''))
}
