/**
 * Real NPI lookup (CTO-29): after the checksum passes, ask the public CMS
 * NPPES registry whether the number exists, who it belongs to and its type.
 *   type 2 (NPI-2) = an organisation: the practice's group NPI
 *   type 1 (NPI-1) = an individual: each practitioner's NPI
 *
 * Server-side only, no API key (NPIs are public data, not PHI), a 5 s
 * timeout, and cached for an hour. When NPPES can't be reached the result is
 * "UNAVAILABLE" and onboarding falls back to the checksum with a note.
 *
 * NPI_REGISTRY_MODE=live (default) | off. Tests run with it off unless a
 * test installs a fake registry (setNpiFetchForTests).
 */
import { isValidNpi, normalizeNpi } from '../utils/practiceIds'

export type NpiLookupStatus = 'FOUND' | 'NOT_FOUND' | 'DEACTIVATED' | 'UNAVAILABLE'

export interface NpiLookup {
  npi: string
  status: NpiLookupStatus
  /** 1 = individual, 2 = organisation. */
  type: 1 | 2 | null
  name: string | null
  taxonomy: string | null
  state: string | null
  checkedAt: string
}

/** What a lookup means for a field that expects a given type. */
export type NpiVerdict = 'OK' | 'WRONG_TYPE' | 'NOT_FOUND' | 'DEACTIVATED' | 'UNVERIFIED'

export const NPPES_URL = 'https://npiregistry.cms.hhs.gov/api/'
const TIMEOUT_MS = 5_000
const CACHE_MS = 60 * 60 * 1000

type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

let fetchOverride: FetchLike | null = null
/** Tests: a recorded-response fake registry (null restores the default). */
export function setNpiFetchForTests(fn: FetchLike | null) {
  fetchOverride = fn
  cache.clear()
}

const cache = new Map<string, { at: number; value: NpiLookup }>()

export const npiRegistryEnabled = (env: NodeJS.ProcessEnv = process.env) => {
  if (fetchOverride) return true
  const mode = env.NPI_REGISTRY_MODE?.trim().toLowerCase()
  if (mode === 'off') return false
  if (mode === 'live') return true
  return env.NODE_ENV !== 'test'
}

interface NppesResult {
  enumeration_type?: string
  basic?: {
    first_name?: string
    last_name?: string
    credential?: string
    organization_name?: string
    status?: string
    deactivation_date?: string
  }
  taxonomies?: Array<{ desc?: string; primary?: boolean; state?: string }>
  addresses?: Array<{ state?: string; address_purpose?: string }>
}

/** Pure: an NPPES API answer → our lookup. */
export function parseNppes(npi: string, body: unknown, now = new Date()): NpiLookup {
  const base = {
    npi,
    type: null,
    name: null,
    taxonomy: null,
    state: null,
    checkedAt: now.toISOString(),
  }
  const results = (body as { result_count?: number; results?: NppesResult[] })?.results
  const r = Array.isArray(results) ? results[0] : undefined
  if (!r) return { ...base, status: 'NOT_FOUND' }
  const type = r.enumeration_type === 'NPI-2' ? 2 : r.enumeration_type === 'NPI-1' ? 1 : null
  const b = r.basic ?? {}
  const name =
    type === 2
      ? (b.organization_name ?? null)
      : [b.first_name, b.last_name].filter(Boolean).join(' ') || null
  const tax = r.taxonomies?.find((t) => t.primary) ?? r.taxonomies?.[0]
  const location = r.addresses?.find((a) => a.address_purpose === 'LOCATION') ?? r.addresses?.[0]
  const deactivated = b.status === 'D' || (!!b.deactivation_date && b.status !== 'A')
  return {
    npi,
    status: deactivated ? 'DEACTIVATED' : 'FOUND',
    type,
    name,
    taxonomy: tax?.desc ?? null,
    state: tax?.state ?? location?.state ?? null,
    checkedAt: now.toISOString(),
  }
}

/** Looks an NPI up in NPPES. Null when lookups are off (checksum only). */
export async function lookupNpi(raw: string): Promise<NpiLookup | null> {
  if (!npiRegistryEnabled()) return null
  const npi = normalizeNpi(raw)
  if (!isValidNpi(npi)) return null
  const hit = cache.get(npi)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const fetchImpl = fetchOverride ?? (globalThis.fetch as unknown as FetchLike)
  let value: NpiLookup
  try {
    const res = await fetchImpl(`${NPPES_URL}?version=2.1&number=${npi}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`NPPES answered ${res.status}`)
    value = parseNppes(npi, await res.json())
  } catch (err) {
    // Timeout or outage: fall back to the checksum, never block onboarding.
    console.warn('[npi] registry unavailable:', (err as Error).message)
    return {
      npi,
      status: 'UNAVAILABLE',
      type: null,
      name: null,
      taxonomy: null,
      state: null,
      checkedAt: new Date().toISOString(),
    }
  }
  cache.set(npi, { at: Date.now(), value })
  return value
}

/** Is this lookup acceptable for a field expecting `expectType`? */
export function verdictFor(lookup: NpiLookup | null, expectType: 1 | 2): NpiVerdict {
  if (!lookup || lookup.status === 'UNAVAILABLE') return 'UNVERIFIED'
  if (lookup.status === 'NOT_FOUND') return 'NOT_FOUND'
  if (lookup.status === 'DEACTIVATED') return 'DEACTIVATED'
  return lookup.type === expectType ? 'OK' : 'WRONG_TYPE'
}

export const VERDICT_MESSAGE: Record<
  Exclude<NpiVerdict, 'OK' | 'UNVERIFIED'>,
  (t: 1 | 2) => string
> = {
  WRONG_TYPE: (t) =>
    t === 2
      ? 'This NPI is registered to an individual (type 1). The practice needs its group (type 2) NPI.'
      : 'This NPI is registered to an organisation (type 2). Each practitioner needs their own individual (type 1) NPI.',
  NOT_FOUND: () => 'This NPI is not in the NPPES registry.',
  DEACTIVATED: () => 'This NPI is deactivated in the NPPES registry.',
}
