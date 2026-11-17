'use client'

import * as React from 'react'
import { Activity, Building2, Download, Layers, Mic } from 'lucide-react'
import {
  AppBadge,
  AppButton,
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppEmptyState,
  AppErrorState,
  AppPageHeader,
  KPIStatCard,
  LoadingSkeleton,
} from '@/components/ui-system'
import { cn } from '@/lib/utils'
import {
  USAGE_RANGES,
  downloadFeatureUsageCsv,
  getFeatureUsage,
  type FeatureUsageRow,
  type UsageRange,
  type UsageSummaryResponse,
} from '@/lib/platformUsageApi'

const RANGE_LABELS: Record<UsageRange, string> = {
  7: '7 days',
  30: '30 days',
  90: '90 days',
  180: '6 months',
  365: '12 months',
}

const LEAST_USED_COUNT = 8

const errorMessage = (e: unknown, fallback: string): string =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback

const formatDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Never'

const percent = (n: number, of: number): number => (of > 0 ? Math.round((n / of) * 100) : 0)

/** A tiny weekly trend line. Decorative; the numbers are in the table. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) {
    return <span className="text-xs text-slate-400">No trend</span>
  }
  const w = 80
  const h = 24
  const max = Math.max(...values, 1)
  const step = w / (values.length - 1)
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`)
    .join(' ')
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`${label}: weekly trend`}
      className="text-indigo-500"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ReachBar({ clinics, total }: { clinics: number; total: number }) {
  const pct = percent(clinics, total)
  return (
    <div className="flex min-w-[8rem] items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-600">
        {clinics} ({pct}%)
      </span>
    </div>
  )
}

function NotConfigured() {
  return (
    <AppEmptyState
      title="Usage analytics is not connected yet"
      description="Set POSTHOG_PROJECT_ID and POSTHOG_PERSONAL_API_KEY (Query: Read) on the backend to read usage here. Events are sent when POSTHOG_API_KEY and USAGE_ANALYTICS_SALT are set. See the CTO-39 walkthrough for the full setup."
      icon={<Activity className="h-8 w-8 text-slate-400" />}
    />
  )
}

export default function PlatformUsagePage() {
  const [days, setDays] = React.useState<UsageRange>(30)
  const [area, setArea] = React.useState<string>('all')
  const [data, setData] = React.useState<UsageSummaryResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [exporting, setExporting] = React.useState(false)
  const [exportError, setExportError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getFeatureUsage(days))
    } catch (e) {
      setError(errorMessage(e, 'Could not load feature usage'))
    } finally {
      setLoading(false)
    }
  }, [days])

  React.useEffect(() => {
    void load()
  }, [load])

  const onExport = async () => {
    setExporting(true)
    setExportError(null)
    try {
      await downloadFeatureUsageCsv(days)
    } catch (e) {
      setExportError(errorMessage(e, 'Could not export usage'))
    } finally {
      setExporting(false)
    }
  }

  const summary = data && data.configured ? data : null
  const rows: FeatureUsageRow[] = React.useMemo(
    () => (summary ? summary.features.filter((f) => area === 'all' || f.area === area) : []),
    [summary, area]
  )
  const leastUsed = React.useMemo(
    () =>
      [...rows]
        .sort(
          (a, b) => a.clinics - b.clinics || a.events - b.events || a.label.localeCompare(b.label)
        )
        .slice(0, LEAST_USED_COUNT),
    [rows]
  )

  return (
    <div className="space-y-6">
      <AppPageHeader
        title="Feature usage"
        description="Which features clinics use, across the platform. Counts come from server-side usage events with no patient data."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Time range"
              className="flex rounded-lg border border-slate-200 bg-white p-0.5"
            >
              {USAGE_RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={days === r}
                  onClick={() => setDays(r)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium',
                    days === r ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {RANGE_LABELS[r]}
                </button>
              ))}
            </div>
            <AppButton
              variant="outline"
              size="sm"
              onClick={() => void onExport()}
              disabled={!summary || exporting}
            >
              <Download className="mr-1.5 h-4 w-4" />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </AppButton>
          </div>
        }
      />

      {exportError && (
        <p role="alert" className="text-sm text-rose-600">
          {exportError}
        </p>
      )}

      {loading && !data ? (
        <LoadingSkeleton variant="card" count={3} />
      ) : error ? (
        <AppErrorState
          title="Feature usage is unavailable"
          description={error}
          onRetry={() => void load()}
        />
      ) : data && !data.configured ? (
        <NotConfigured />
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KPIStatCard
              label="Active clinics"
              value={`${summary.totals.activeClinics} / ${summary.totals.totalClinics}`}
              description="Clinics with any usage in this period"
              icon={Building2}
            />
            <KPIStatCard
              label="Usage events"
              value={summary.totals.events.toLocaleString()}
              description={`Last ${RANGE_LABELS[summary.days]}`}
              icon={Activity}
            />
            <KPIStatCard
              label="Features in use"
              value={`${summary.totals.featuresUsed} / ${summary.totals.featuresTotal}`}
              description="Used at least once"
              icon={Layers}
            />
            <KPIStatCard
              label="Scribe adoption"
              value={
                summary.totals.scribeAdoption === null
                  ? 'n/a'
                  : `${Math.round(summary.totals.scribeAdoption * 100)}%`
              }
              description="Scribe approvals per completed appointment"
              icon={Mic}
            />
          </div>

          <div role="group" aria-label="Filter by area" className="flex flex-wrap gap-2">
            {[{ key: 'all', label: 'All areas' }, ...summary.areas].map((a) => (
              <button
                key={a.key}
                type="button"
                aria-pressed={area === a.key}
                onClick={() => setArea(a.key)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium',
                  area === a.key
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                )}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <AppCard className="xl:col-span-2">
              <AppCardHeader>
                <AppCardTitle>Features by reach</AppCardTitle>
              </AppCardHeader>
              <AppCardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-semibold">
                        Feature
                      </th>
                      <th scope="col" className="px-4 py-2 font-semibold">
                        Clinics using
                      </th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">
                        Events
                      </th>
                      <th scope="col" className="px-4 py-2 font-semibold">
                        Weekly
                      </th>
                      <th scope="col" className="px-4 py-2 font-semibold">
                        Last used
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((f) => (
                      <tr key={f.key}>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900">{f.label}</div>
                          <div className="text-xs text-slate-500">{f.areaLabel}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <ReachBar clinics={f.clinics} total={summary.totals.totalClinics} />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                          {f.events.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <Sparkline values={f.weekly.map((w) => w.events)} label={f.label} />
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">
                          {formatDate(f.lastUsed)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AppCardContent>
            </AppCard>

            <AppCard>
              <AppCardHeader>
                <AppCardTitle>Least used</AppCardTitle>
              </AppCardHeader>
              <AppCardContent>
                <ul className="space-y-3" aria-label="Least used features">
                  {leastUsed.map((f) => (
                    <li key={f.key} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{f.label}</p>
                        <p className="text-xs text-slate-500">{f.areaLabel}</p>
                      </div>
                      {f.events === 0 ? (
                        <AppBadge variant="warning">Not used</AppBadge>
                      ) : (
                        <span className="shrink-0 text-xs tabular-nums text-slate-600">
                          {f.clinics} {f.clinics === 1 ? 'clinic' : 'clinics'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-slate-500">
                  Updated {new Date(summary.generatedAt).toLocaleTimeString()} · data tag “
                  {summary.env}”. Funnels and retention are in PostHog.
                </p>
              </AppCardContent>
            </AppCard>
          </div>
        </>
      ) : null}
    </div>
  )
}
