'use client'

/**
 * One custom domain on the Domains screen (CTO-38): a Shopify / Wix style
 * guided connect.
 *
 *   - progress: DNS records → Verified → HTTPS certificate → Live
 *   - "We detected GoDaddy manages DNS for x.com" + its own steps and link
 *   - the records with copy buttons, each with what DNS answers right now
 *   - polls the server while connecting: every 10 s, every 30 s after
 *     10 minutes, then stops at 30 minutes with a "Check again" button
 *     (the server also re-checks every 5 minutes, so nothing is lost)
 *   - "Connect automatically" where the DNS provider supports Domain Connect
 */
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Star,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react'
import { siteApi, type DomainStage, type SiteDomain } from '@/lib/site/siteApi'
import { dnsGuide, dnsSettingsUrl, fillDomain } from '@/lib/site/dnsProviderGuides'
import { AppBadge, AppButton } from '@/components/ui-system'

export const POLL_FAST_MS = 10_000
export const POLL_SLOW_MS = 30_000
const SLOW_AFTER_MS = 10 * 60_000
const STOP_AFTER_MS = 30 * 60_000

export function CopyCell({ value }: { value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <code className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs">{value}</code>
      <button
        type="button"
        className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label={`Copy ${value}`}
        onClick={() =>
          void navigator.clipboard?.writeText(value).then(() => toast.success('Copied'))
        }
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}

const STEPS: Array<{ stage: Exclude<DomainStage, 'error'>; label: string }> = [
  { stage: 'dns', label: 'DNS records' },
  { stage: 'verified', label: 'Verified' },
  { stage: 'ssl', label: 'HTTPS certificate' },
  { stage: 'live', label: 'Live' },
]
const ORDER: Record<DomainStage, number> = { dns: 0, verified: 1, ssl: 2, live: 3, error: 2 }

const STAGE_TOAST: Partial<Record<DomainStage, string>> = {
  verified: 'DNS records found. Setting up HTTPS',
  ssl: 'HTTPS certificate issued. Almost live',
  live: 'Your domain is live',
  error: 'Something is blocking this domain. Our team has been told',
}

export function DomainStepper({ stage }: { stage: DomainStage }) {
  const at = ORDER[stage]
  return (
    <ol
      className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1"
      aria-label="Connection progress"
    >
      {STEPS.map((s, i) => {
        const done = i < at || stage === 'live'
        const current = i === at && stage !== 'live'
        const failed = stage === 'error' && i === at
        return (
          <li
            key={s.stage}
            className="flex items-center gap-1.5 text-xs"
            aria-current={current ? 'step' : undefined}
            data-testid={`step-${s.stage}`}
            data-state={failed ? 'error' : done ? 'done' : current ? 'current' : 'todo'}
          >
            {failed ? (
              <XCircle className="h-4 w-4 text-red-600" aria-hidden />
            ) : done ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            ) : current ? (
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" aria-hidden />
            ) : (
              <Circle className="h-4 w-4 text-slate-300" aria-hidden />
            )}
            <span
              className={
                failed
                  ? 'font-semibold text-red-700'
                  : done
                    ? 'text-emerald-800'
                    : current
                      ? 'font-semibold text-slate-900'
                      : 'text-slate-400'
              }
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-5 bg-slate-200" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

function StatusPill({ d }: { d: SiteDomain }) {
  if (d.stage === 'live')
    return (
      <AppBadge variant="success">
        <CheckCircle2 className="mr-1 inline h-3 w-3" />
        Live
      </AppBadge>
    )
  if (d.stage === 'error')
    return (
      <AppBadge variant="danger">
        <XCircle className="mr-1 inline h-3 w-3" />
        Needs attention
      </AppBadge>
    )
  if (d.stage === 'verified' || d.stage === 'ssl')
    return (
      <AppBadge variant="warning">
        <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
        Setting up HTTPS
      </AppBadge>
    )
  return (
    <AppBadge variant="warning">
      <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
      Waiting for DNS
    </AppBadge>
  )
}

export interface DomainConnectCardProps {
  domain: SiteDomain
  /** Called whenever a poll or check returns a newer copy of this domain. */
  onUpdate: (d: SiteDomain) => void
  onVerify: () => Promise<unknown>
  onPrimary: () => void
  onRemove: () => void
  busy: string | null
}

export function DomainConnectCard({
  domain,
  onUpdate,
  onVerify,
  onPrimary,
  onRemove,
  busy,
}: DomainConnectCardProps) {
  const startedAt = React.useRef(Date.now())
  const [stopped, setStopped] = React.useState(false)
  const connecting = domain.stage !== 'live' && domain.stage !== 'error'

  const poll = useQuery({
    queryKey: ['site', 'domain-status', domain.id],
    queryFn: () => siteApi.getDomainStatus(domain.id),
    enabled: connecting && !stopped,
    refetchIntervalInBackground: false,
    refetchInterval: () => {
      const elapsed = Date.now() - startedAt.current
      if (elapsed >= STOP_AFTER_MS) return false
      return elapsed >= SLOW_AFTER_MS ? POLL_SLOW_MS : POLL_FAST_MS
    },
  })

  // Hand newer copies to the page and tell the owner when the stage moves.
  const lastStage = React.useRef<DomainStage>(domain.stage)
  React.useEffect(() => {
    const d = poll.data
    if (!d) return
    if (d.stage !== lastStage.current) {
      const msg = STAGE_TOAST[d.stage]
      if (msg) {
        if (d.stage === 'error') toast.error(msg)
        else toast.success(`${d.hostname}: ${msg}`)
      }
      lastStage.current = d.stage
    }
    onUpdate(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onUpdate is a fresh closure each render
  }, [poll.data])

  React.useEffect(() => {
    if (!connecting || stopped) return
    const t = setTimeout(() => setStopped(true), STOP_AFTER_MS)
    return () => clearTimeout(t)
  }, [connecting, stopped])

  const connect = useQuery({
    queryKey: ['site', 'domain-connect', domain.id],
    queryFn: () => siteApi.getDomainConnect(domain.id),
    enabled: domain.stage === 'dns',
    staleTime: 10 * 60_000,
    retry: false,
  })

  const checkAgain = async () => {
    startedAt.current = Date.now()
    setStopped(false)
    await onVerify()
  }

  const zone = domain.zone ?? domain.hostname
  const guide = dnsGuide(domain.dnsProvider?.key)
  const link = dnsSettingsUrl(guide, domain.zone)
  const checkFor = (purpose: string, type: string) =>
    domain.checks?.find((c) => c.purpose === purpose && c.type === type)
  const caa = domain.checks?.find((c) => c.type === 'CAA' && !c.ok)
  const isRoot = domain.zone
    ? domain.zone === domain.hostname
    : domain.hostname.split('.').length === 2

  return (
    <li
      className="rounded-xl border border-slate-200 p-4"
      data-testid={`domain-${domain.hostname}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">{domain.hostname}</span>
        <StatusPill d={domain} />
        {domain.isPrimary && (
          <AppBadge variant="accent">
            <Star className="mr-1 inline h-3 w-3" />
            Primary
          </AppBadge>
        )}
        {(domain.sslStatus === 'active' || domain.stage === 'live') && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" /> HTTPS active
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1">
          <AppButton
            size="sm"
            variant="outline"
            disabled={busy === `v-${domain.id}`}
            onClick={() => void checkAgain()}
          >
            {busy === `v-${domain.id}` ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : domain.stage === 'live' ? (
              'Re-check'
            ) : (
              'Check now'
            )}
          </AppButton>
          {domain.stage === 'live' && !domain.isPrimary && (
            <AppButton size="sm" variant="outline" onClick={onPrimary}>
              Make primary
            </AppButton>
          )}
          <AppButton
            size="sm"
            variant="ghost"
            className="text-red-600"
            onClick={onRemove}
            aria-label={`Remove ${domain.hostname}`}
          >
            <Trash2 className="h-4 w-4" />
          </AppButton>
        </div>
      </div>

      <DomainStepper stage={domain.stage} />

      {domain.lastError && domain.stage !== 'live' && (
        <p className="mt-2 text-xs text-red-600" role="status" data-testid="domain-error">
          {domain.lastError}
        </p>
      )}
      {domain.stage === 'live' && domain.lastError && (
        <p className="mt-2 text-xs text-amber-700" role="status">
          {domain.lastError}
        </p>
      )}

      {connecting && (
        <p className="mt-2 text-xs text-slate-500" aria-live="polite">
          {stopped ? (
            <>
              We stopped checking automatically on this screen (we keep checking every few minutes
              in the background).{' '}
              <button
                type="button"
                className="font-semibold text-indigo-600 hover:underline"
                onClick={() => void checkAgain()}
              >
                Check again
              </button>
            </>
          ) : (
            'Checking automatically. You can leave this page; we keep checking in the background.'
          )}
        </p>
      )}

      {domain.stage === 'dns' && (
        <div className="mt-4 space-y-3">
          {connect.data?.available && (
            <div
              className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
              data-testid="domain-connect"
            >
              <Zap className="h-4 w-4" aria-hidden />
              <span>{connect.data.providerName} can add these records for you in one step.</span>
              <AppButton
                size="sm"
                className="ml-auto"
                onClick={() => {
                  if (connect.data?.available) window.location.assign(connect.data.url)
                }}
              >
                Connect automatically
              </AppButton>
            </div>
          )}

          <div
            className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700"
            data-testid="dns-guide"
          >
            <p>
              {domain.dnsProvider && domain.dnsProvider.key !== 'other' ? (
                <>
                  We detected <strong>{guide.name}</strong> manages DNS for <strong>{zone}</strong>.
                </>
              ) : (
                <>
                  Add these records where the DNS for <strong>{zone}</strong> is managed (usually
                  where you bought the domain).
                </>
              )}
              {link && (
                <>
                  {' '}
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline"
                  >
                    Open {guide.key === 'other' ? 'DNS settings' : `${guide.name} DNS settings`}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </>
              )}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
              {guide.steps.map((s) => (
                <li key={s}>{fillDomain(s, zone)}</li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {domain.stage !== 'live' && domain.records.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 pr-3 font-semibold">Type</th>
                <th className="py-1 pr-3 font-semibold">{guide.hostLabel}</th>
                <th className="py-1 pr-3 font-semibold">{guide.valueLabel}</th>
                <th className="py-1 font-semibold">Check</th>
              </tr>
            </thead>
            <tbody>
              {domain.records.map((r, i) => {
                const c = checkFor(r.purpose, r.type)
                return (
                  <tr
                    key={i}
                    className="border-t border-slate-100 align-top"
                    data-testid={`record-${r.type}`}
                  >
                    <td className="py-2 pr-3 font-mono text-xs">{r.type}</td>
                    <td className="py-2 pr-3">
                      <CopyCell value={guide.relativeHost && r.host ? r.host : r.name} />
                      {guide.relativeHost && r.host && r.host !== r.name && (
                        <span className="mt-0.5 block text-[11px] text-slate-400">{r.name}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <CopyCell value={r.value} />
                    </td>
                    <td className="py-2 text-xs">
                      {!c ? (
                        <span className="text-slate-400">
                          {r.purpose === 'routing'
                            ? 'Points the domain at your site'
                            : r.purpose === 'ownership'
                              ? 'Proves you own it'
                              : 'Issues the HTTPS certificate'}
                        </span>
                      ) : c.ok ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Found
                        </span>
                      ) : (
                        <span className="inline-flex items-start gap-1 text-red-600">
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span>{c.message ?? 'Not found yet'}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {caa && <p className="mt-2 text-xs text-red-600">{caa.message}</p>}
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
            {guide.notes.map((n) => (
              <li key={n}>{fillDomain(n, zone)}</li>
            ))}
            <li>DNS changes usually show up within minutes, and can take up to an hour.</li>
          </ul>
          {isRoot && (
            <p className="mt-2 text-xs text-amber-700">
              Root domains (without www) can’t use a CNAME at most providers. Use your provider’s
              ALIAS / ANAME / “CNAME flattening”, or connect <strong>www.{domain.hostname}</strong>{' '}
              and forward the root to it.
            </p>
          )}
        </div>
      )}

      {domain.stage === 'live' && domain.hostname.startsWith('www.') && (
        <p className="mt-3 text-xs text-slate-500" data-testid="forwarding-tip">
          Tip: send visitors who type {domain.hostname.slice(4)} to this address.{' '}
          {fillDomain(guide.forwarding, domain.zone ?? domain.hostname.slice(4))}
        </p>
      )}
    </li>
  )
}
