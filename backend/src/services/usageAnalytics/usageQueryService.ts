/**
 * CTO-39: the read side of usage analytics, for the platform Usage page.
 *
 * Reads PostHog server-side through its Query API (HogQL) with a personal
 * API key scoped to Query: Read. Only two values are ever put into a query:
 * a day count from a fixed list and the environment tag (validated), so no
 * caller input reaches HogQL. Results are merged with the local feature
 * catalog so features nobody used still show, with zero.
 */

import prisma from '../../config/prisma'
import { withTenantBypass } from '../../config/tenantContext'
import {
  USAGE_AREAS,
  USAGE_AREA_LABELS,
  USAGE_FEATURES,
  getUsageFeature,
  type UsageFeature,
} from '../../config/usageFeatures'
import type { ApiError } from '../../types/errors'
import { USAGE_EVENT } from './usageAnalytics'
import { usageQueryConfig, type UsageQueryConfig } from './config'

export const USAGE_RANGES = [7, 30, 90, 180, 365] as const
export type UsageRange = (typeof USAGE_RANGES)[number]

export const parseUsageRange = (raw: unknown): UsageRange => {
  const n = Number(raw)
  return (USAGE_RANGES as readonly number[]).includes(n) ? (n as UsageRange) : 30
}

export interface FeatureUsageRow {
  key: string
  label: string
  area: string
  areaLabel: string
  events: number
  clinics: number
  lastUsed: string | null
  weekly: { week: string; events: number; clinics: number }[]
}

export interface UsageSummary {
  configured: true
  env: string
  days: UsageRange
  generatedAt: string
  totals: {
    events: number
    activeClinics: number
    totalClinics: number
    featuresUsed: number
    featuresTotal: number
    /** scribe.approved ÷ appointment.completed, or null with no completions. */
    scribeAdoption: number | null
  }
  weeks: string[]
  areas: { key: string; label: string }[]
  features: FeatureUsageRow[]
}

export type UsageSummaryResponse = UsageSummary | { configured: false }

interface MatrixRow {
  clinicId: string
  feature: string
  events: number
  lastUsed: string | null
}

interface SeriesRow {
  feature: string
  week: string
  events: number
  clinics: number
}

const QUERY_TIMEOUT_MS = 10_000
const CACHE_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; value: unknown }>()

/** Test hook. */
export const __clearUsageQueryCache = (): void => cache.clear()

const unavailable = (): ApiError => {
  const err = new Error(
    'Usage data could not be loaded from PostHog. Try again shortly.'
  ) as ApiError
  err.statusCode = 502
  err.code = 'usage_unavailable'
  return err
}

const runHogQL = async (cfg: UsageQueryConfig, query: string): Promise<unknown[][]> => {
  let res: Response
  try {
    res = await fetch(`${cfg.appHost}/api/projects/${cfg.projectId}/query/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.personalApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    })
  } catch {
    throw unavailable()
  }
  if (!res.ok) {
    console.warn(`[usage-analytics] PostHog query failed with HTTP ${res.status}`)
    throw unavailable()
  }
  const body = (await res.json().catch(() => null)) as { results?: unknown } | null
  if (!body || !Array.isArray(body.results)) throw unavailable()
  return body.results as unknown[][]
}

/** The shared WHERE clause. `days` and `env` are validated, never caller text. */
const whereClause = (days: UsageRange, env: string): string => {
  if (!/^[a-z0-9-]{1,20}$/.test(env)) throw unavailable()
  return (
    `event = '${USAGE_EVENT}' AND properties.env = '${env}' ` +
    `AND timestamp >= now() - INTERVAL ${days} DAY`
  )
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string' && !(v instanceof Date)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''

const weekKey = (v: unknown): string => (isoOrNull(v) ?? str(v)).slice(0, 10)

const cached = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T
  const value = await load()
  cache.set(key, { at: Date.now(), value })
  return value
}

const loadMatrix = (cfg: UsageQueryConfig, days: UsageRange): Promise<MatrixRow[]> =>
  cached(`matrix:${cfg.env}:${days}`, async () => {
    const rows = await runHogQL(
      cfg,
      `SELECT coalesce(properties.clinic_id, '') AS clinic_id, properties.feature AS feature, ` +
        `count() AS events, max(timestamp) AS last_used FROM events ` +
        `WHERE ${whereClause(days, cfg.env)} GROUP BY clinic_id, feature LIMIT 100000`
    )
    return rows.map((r) => ({
      clinicId: str(r[0]),
      feature: str(r[1]),
      events: num(r[2]),
      lastUsed: isoOrNull(r[3]),
    }))
  })

const loadSeries = (cfg: UsageQueryConfig, days: UsageRange): Promise<SeriesRow[]> =>
  cached(`series:${cfg.env}:${days}`, async () => {
    const rows = await runHogQL(
      cfg,
      `SELECT properties.feature AS feature, toStartOfWeek(timestamp) AS week, count() AS events, ` +
        `count(DISTINCT properties.clinic_id) AS clinics FROM events ` +
        `WHERE ${whereClause(days, cfg.env)} GROUP BY feature, week ORDER BY week LIMIT 100000`
    )
    return rows.map((r) => ({
      feature: str(r[0]),
      week: weekKey(r[1]),
      events: num(r[2]),
      clinics: num(r[3]),
    }))
  })

const countClinics = (): Promise<number> =>
  withTenantBypass('platform:usage-clinic-count', () =>
    prisma.clinic.count({ where: { isActive: true } })
  )

/** Platform Usage page data: every catalog feature, used or not. */
export const getUsageSummary = async (days: UsageRange): Promise<UsageSummaryResponse> => {
  const cfg = usageQueryConfig()
  if (!cfg) return { configured: false }

  const [matrix, series, totalClinics] = await Promise.all([
    loadMatrix(cfg, days),
    loadSeries(cfg, days),
    countClinics(),
  ])

  const byFeature = new Map<string, { events: number; clinics: Set<string>; last: string | null }>()
  const activeClinics = new Set<string>()
  let events = 0
  for (const row of matrix) {
    if (!getUsageFeature(row.feature)) continue
    events += row.events
    if (row.clinicId) activeClinics.add(row.clinicId)
    const agg = byFeature.get(row.feature) ?? { events: 0, clinics: new Set(), last: null }
    agg.events += row.events
    if (row.clinicId) agg.clinics.add(row.clinicId)
    if (row.lastUsed && (!agg.last || row.lastUsed > agg.last)) agg.last = row.lastUsed
    byFeature.set(row.feature, agg)
  }

  const weeks = [...new Set(series.map((s) => s.week))].sort()
  const weeklyByFeature = new Map<string, Map<string, SeriesRow>>()
  for (const s of series) {
    const m = weeklyByFeature.get(s.feature) ?? new Map<string, SeriesRow>()
    m.set(s.week, s)
    weeklyByFeature.set(s.feature, m)
  }

  const features: FeatureUsageRow[] = (USAGE_FEATURES as readonly UsageFeature[]).map((f) => {
    const agg = byFeature.get(f.key)
    const weekly = weeklyByFeature.get(f.key)
    return {
      key: f.key,
      label: f.label,
      area: f.area,
      areaLabel: USAGE_AREA_LABELS[f.area],
      events: agg?.events ?? 0,
      clinics: agg?.clinics.size ?? 0,
      lastUsed: agg?.last ?? null,
      weekly: weeks.map((w) => ({
        week: w,
        events: weekly?.get(w)?.events ?? 0,
        clinics: weekly?.get(w)?.clinics ?? 0,
      })),
    }
  })
  features.sort(
    (a, b) => b.clinics - a.clinics || b.events - a.events || a.key.localeCompare(b.key)
  )

  const approved = byFeature.get('scribe.approved')?.events ?? 0
  const completed = byFeature.get('appointment.completed')?.events ?? 0

  return {
    configured: true,
    env: cfg.env,
    days,
    generatedAt: new Date().toISOString(),
    totals: {
      events,
      activeClinics: activeClinics.size,
      totalClinics,
      featuresUsed: features.filter((f) => f.events > 0).length,
      featuresTotal: features.length,
      scribeAdoption: completed > 0 ? Math.round((approved / completed) * 1000) / 1000 : null,
    },
    weeks,
    areas: USAGE_AREAS.map((a) => ({ key: a, label: USAGE_AREA_LABELS[a] })),
    features,
  }
}

const CSV_COLUMNS = [
  'clinic_id',
  'clinic_name',
  'plan',
  'feature',
  'feature_label',
  'area',
  'events',
  'last_used',
] as const

/** RFC 4180 quoting, plus a leading ' on cells a spreadsheet would run as a formula. */
export const csvCell = (v: unknown): string => {
  let s =
    typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Clinic × feature usage as CSV, for tier planning (B12.3). Only clinic-level
 * business data: no patients, no staff. Returns null when not configured.
 */
export const exportUsageCsv = async (days: UsageRange): Promise<string | null> => {
  const cfg = usageQueryConfig()
  if (!cfg) return null
  const matrix = (await loadMatrix(cfg, days)).filter(
    (r) => r.clinicId && getUsageFeature(r.feature)
  )
  const ids = [...new Set(matrix.map((r) => r.clinicId))]
  const clinics = ids.length
    ? await withTenantBypass('platform:usage-export', () =>
        prisma.clinic.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, tenant: { select: { plan: true } } },
        })
      )
    : []
  const byId = new Map(clinics.map((c) => [c.id, c]))

  const rows = matrix
    .map((r) => {
      const f = getUsageFeature(r.feature)!
      const c = byId.get(r.clinicId)
      return [
        r.clinicId,
        c?.name ?? '',
        c?.tenant.plan ?? '',
        f.key,
        f.label,
        f.area,
        r.events,
        r.lastUsed ?? '',
      ]
    })
    .sort(
      (a, b) =>
        String(a[1]).localeCompare(String(b[1])) ||
        String(a[0]).localeCompare(String(b[0])) ||
        String(a[3]).localeCompare(String(b[3]))
    )

  return [CSV_COLUMNS.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n'
}
