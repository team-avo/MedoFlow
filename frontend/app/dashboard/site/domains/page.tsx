'use client'

/**
 * Domains (F8.4 / B8.2): the free <name>.<root> subdomain and the clinic's
 * own domains — DNS records to create, verification, primary domain.
 */
import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Clock,
  Copy,
  Globe,
  Loader2,
  Lock,
  ShieldCheck,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react'
import { siteApi, siteErrorMessage, type SiteDomain } from '@/lib/site/siteApi'
import { AppBadge, AppButton } from '@/components/ui-system'
import { inputCls, Label } from '@/components/site/builder/fields'
import { useInvalidateSite, useSiteOverview } from '@/components/site/builder/BuilderData'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

const DOMAINS_KEY = ['site', 'domains'] as const

function CopyCell({ value }: { value: string }) {
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

function StatusPill({ d }: { d: SiteDomain }) {
  if (d.status === 'VERIFIED')
    return (
      <AppBadge variant="success">
        <CheckCircle2 className="mr-1 inline h-3 w-3" />
        Connected
      </AppBadge>
    )
  if (d.status === 'FAILED')
    return (
      <AppBadge variant="danger">
        <XCircle className="mr-1 inline h-3 w-3" />
        Not verified yet
      </AppBadge>
    )
  return (
    <AppBadge variant="warning">
      <Clock className="mr-1 inline h-3 w-3" />
      Waiting for DNS
    </AppBadge>
  )
}

export default function SiteDomainsPage() {
  const qc = useQueryClient()
  const invalidate = useInvalidateSite()
  const { data: site } = useSiteOverview()
  const { data, isLoading, error } = useQuery({
    queryKey: DOMAINS_KEY,
    queryFn: siteApi.listDomains,
  })
  const [hostname, setHostname] = React.useState('')
  const [label, setLabel] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try {
      const out = await fn()
      if (out && typeof out === 'object' && 'domains' in out) qc.setQueryData(DOMAINS_KEY, out)
      else void qc.invalidateQueries({ queryKey: DOMAINS_KEY })
      invalidate()
      if (ok) toast.success(ok)
      return out
    } catch (e) {
      toast.error(siteErrorMessage(e))
      return null
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) return <LoadingSkeleton variant="card" />
  if (error || !data)
    return (
      <p className="text-sm text-red-600">{siteErrorMessage(error, 'Could not load domains')}</p>
    )

  const sub =
    data.domains.find((d) => d.kind === 'SUBDOMAIN' && d.isPrimary) ??
    data.domains.find((d) => d.kind === 'SUBDOMAIN')
  const custom = data.domains.filter((d) => d.kind === 'CUSTOM')
  const maxCustom = site?.entitlements.maxCustomDomains ?? 0
  const locked = maxCustom === 0
  const rootSuffix = `.${data.rootDomain}`

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-3">
          <Globe className="mt-0.5 h-5 w-5 text-indigo-600" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-slate-900">Your free address</h1>
            <p className="mt-1 text-sm text-slate-600">
              Included with every plan, with HTTPS. Change the name any time — the old one keeps
              redirecting.
            </p>
            {sub && (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <a
                  href={sub.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-indigo-600 hover:underline"
                  data-testid="subdomain-url"
                >
                  {sub.hostname}
                </a>
                {sub.isPrimary && <AppBadge variant="accent">Primary</AppBadge>}
              </p>
            )}
            <form
              className="mt-4 flex max-w-lg flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void act('sub', () => siteApi.changeSubdomain(label), 'Address updated').then(
                  (ok) => ok && setLabel('')
                )
              }}
            >
              <div className="flex min-w-[12rem] flex-1 items-center rounded-lg border border-slate-200 pr-3 focus-within:border-indigo-400">
                <input
                  aria-label="New subdomain"
                  className="min-w-0 flex-1 rounded-lg border-0 px-3 py-2 text-sm focus:outline-none"
                  value={label}
                  placeholder="your-clinic"
                  maxLength={63}
                  onChange={(e) =>
                    setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                  }
                />
                <span className="shrink-0 text-sm text-slate-400">{rootSuffix}</span>
              </div>
              <AppButton
                type="submit"
                variant="outline"
                disabled={label.length < 3 || busy === 'sub'}
              >
                Rename
              </AppButton>
            </form>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Your own domain</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Use a domain you own, like <code>www.yourclinic.com</code>. We show the DNS records to
              add at your domain provider, then check them. HTTPS is set up automatically once
              verified.
            </p>
          </div>
          <span className="text-xs text-slate-500">
            {custom.length} of {maxCustom} on your plan
          </span>
        </div>

        {locked ? (
          <div
            className="mt-4 flex items-start gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900"
            data-testid="domain-plan-lock"
          >
            <Lock className="mt-0.5 h-4 w-4" />
            <div>
              <p className="font-semibold">Custom domains are on paid plans</p>
              <p className="text-indigo-800">
                Upgrade to connect your own domain. Your free address keeps working on every plan.
              </p>
            </div>
          </div>
        ) : (
          <form
            className="mt-4 flex max-w-lg flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void act(
                'add',
                () => siteApi.addDomain(hostname),
                'Domain added — now create the DNS records'
              ).then((ok) => ok && setHostname(''))
            }}
          >
            <div className="min-w-[12rem] flex-1">
              <Label htmlFor="dom-host">Domain</Label>
              <input
                id="dom-host"
                className={inputCls}
                value={hostname}
                placeholder="www.yourclinic.com"
                onChange={(e) => setHostname(e.target.value.trim())}
              />
            </div>
            <AppButton
              type="submit"
              className="self-end"
              disabled={!hostname.includes('.') || busy === 'add' || custom.length >= maxCustom}
            >
              {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add domain'}
            </AppButton>
          </form>
        )}

        <ul className="mt-6 space-y-4">
          {custom.map((d) => (
            <li
              key={d.id}
              className="rounded-xl border border-slate-200 p-4"
              data-testid={`domain-${d.hostname}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{d.hostname}</span>
                <StatusPill d={d} />
                {d.isPrimary && (
                  <AppBadge variant="accent">
                    <Star className="mr-1 inline h-3 w-3" />
                    Primary
                  </AppBadge>
                )}
                {d.sslStatus === 'active' && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                    <ShieldCheck className="h-3.5 w-3.5" /> HTTPS active
                  </span>
                )}
                <div className="ml-auto flex flex-wrap gap-1">
                  <AppButton
                    size="sm"
                    variant="outline"
                    disabled={busy === `v-${d.id}`}
                    onClick={() => void act(`v-${d.id}`, () => siteApi.verifyDomain(d.id))}
                  >
                    {busy === `v-${d.id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : d.status === 'VERIFIED' ? (
                      'Re-check'
                    ) : (
                      'Verify'
                    )}
                  </AppButton>
                  {d.status === 'VERIFIED' && !d.isPrimary && (
                    <AppButton
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void act(
                          `p-${d.id}`,
                          () => siteApi.setPrimaryDomain(d.id),
                          'Primary domain set — other addresses now redirect here'
                        )
                      }
                    >
                      Make primary
                    </AppButton>
                  )}
                  <AppButton
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    onClick={() =>
                      void act(`r-${d.id}`, () => siteApi.removeDomain(d.id), 'Domain removed')
                    }
                    aria-label={`Remove ${d.hostname}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </AppButton>
                </div>
              </div>
              {d.lastError && d.status !== 'VERIFIED' && (
                <p className="mt-2 text-xs text-red-600">{d.lastError}</p>
              )}
              {d.status !== 'VERIFIED' && (
                <div className="mt-3 overflow-x-auto">
                  <p className="mb-2 text-xs text-slate-600">
                    Add these records at your DNS provider (GoDaddy, Namecheap, Cloudflare…), then
                    press Verify. Changes can take up to an hour.
                  </p>
                  <table className="w-full min-w-[32rem] text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="py-1 pr-3 font-semibold">Type</th>
                        <th className="py-1 pr-3 font-semibold">Name / host</th>
                        <th className="py-1 pr-3 font-semibold">Value / target</th>
                        <th className="py-1 font-semibold">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.records.map((r, i) => (
                        <tr key={i} className="border-t border-slate-100 align-top">
                          <td className="py-2 pr-3 font-mono text-xs">{r.type}</td>
                          <td className="py-2 pr-3">
                            <CopyCell value={r.name} />
                          </td>
                          <td className="py-2 pr-3">
                            <CopyCell value={r.value} />
                          </td>
                          <td className="py-2 text-xs text-slate-500">
                            {r.purpose === 'routing'
                              ? 'Points the domain at your site'
                              : r.purpose === 'ownership'
                                ? 'Proves you own it'
                                : 'Issues the HTTPS certificate'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!d.hostname.startsWith('www.') && d.hostname.split('.').length === 2 && (
                    <p className="mt-2 text-xs text-amber-700">
                      Root domains (without www) can’t use CNAME at most providers. Use your
                      provider’s ALIAS / ANAME / “CNAME flattening”, or connect{' '}
                      <strong>www.{d.hostname}</strong> and forward the root to it.
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
