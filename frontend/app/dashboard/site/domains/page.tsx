'use client'

/**
 * Domains (F8.4 / B8.2): the free <name>.<root> subdomain and the clinic's
 * own domains: DNS records to create, verification, primary domain.
 */
import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Globe, Loader2, Lock } from 'lucide-react'
import { siteApi, siteErrorMessage, type SiteDomain } from '@/lib/site/siteApi'
import { AppBadge, AppButton } from '@/components/ui-system'
import { inputCls, Label } from '@/components/site/builder/fields'
import { useInvalidateSite, useSiteOverview } from '@/components/site/builder/BuilderData'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'
import { DomainConnectCard } from '@/components/site/domains/DomainConnectCard'

const DOMAINS_KEY = ['site', 'domains'] as const

type DomainList = { rootDomain: string; domains: SiteDomain[] }

/** The API's machine-readable error code, if any. */
const errorCode = (e: unknown) =>
  (e as { response?: { data?: { code?: string } } })?.response?.data?.code

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
  /** A root domain the provider can't take: offer www instead (CTO-38). */
  const [apexHint, setApexHint] = React.useState<string | null>(null)

  /** A poll or check returned a newer copy of one domain: patch the list. */
  const updateDomain = React.useCallback(
    (d: SiteDomain) =>
      qc.setQueryData<DomainList>(DOMAINS_KEY, (old) =>
        old
          ? { ...old, domains: old.domains.map((x) => (x.id === d.id ? { ...x, ...d } : x)) }
          : old
      ),
    [qc]
  )

  // Back from "Connect automatically" (Domain Connect): ?dc=<id>&state=…[&error=…]
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    const id = q.get('dc')
    if (!id) return
    const state = q.get('state') ?? ''
    const error = q.get('error') ?? undefined
    window.history.replaceState(null, '', window.location.pathname)
    siteApi
      .domainConnectReturn(id, { state, ...(error ? { error } : {}) })
      .then((d) => {
        updateDomain(d)
        if (error) toast.error('The DNS provider did not add the records. Add them by hand below')
        else toast.success('Records added. We are checking them now')
      })
      .catch((e: unknown) => toast.error(siteErrorMessage(e)))
  }, [updateDomain])

  const addDomain = async (value: string) => {
    setBusy('add')
    setApexHint(null)
    try {
      const d = await siteApi.addDomain(value)
      void qc.invalidateQueries({ queryKey: DOMAINS_KEY })
      invalidate()
      toast.success(`${d.hostname} added. Now create the DNS records`)
      setHostname('')
    } catch (e) {
      if (errorCode(e) === 'site_domain_apex') setApexHint(value.replace(/^https?:\/\//, ''))
      toast.error(siteErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try {
      const out = await fn()
      if (out && typeof out === 'object' && 'domains' in out) qc.setQueryData(DOMAINS_KEY, out)
      else if (out && typeof out === 'object' && 'stage' in out) updateDomain(out as SiteDomain)
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
              Included with every plan, with HTTPS. Change the name any time; the old one keeps
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
              Use a domain you own, like <code>www.yourclinic.com</code>. We detect who manages its
              DNS, show exactly what to add there, and check it for you. HTTPS is set up
              automatically, and you can watch each step go green.
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
              void addDomain(hostname)
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

        {apexHint && (
          <div
            className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            data-testid="apex-hint"
          >
            <span>
              Connect <strong>www.{apexHint}</strong> instead, then forward {apexHint} to it at your
              DNS provider.
            </span>
            <AppButton
              size="sm"
              variant="outline"
              onClick={() => void addDomain(`www.${apexHint}`)}
            >
              Add www.{apexHint} instead
            </AppButton>
          </div>
        )}

        <ul className="mt-6 space-y-4">
          {custom.map((d) => (
            <DomainConnectCard
              key={d.id}
              domain={d}
              busy={busy}
              onUpdate={updateDomain}
              onVerify={() => act(`v-${d.id}`, () => siteApi.verifyDomain(d.id))}
              onPrimary={() =>
                void act(
                  `p-${d.id}`,
                  () => siteApi.setPrimaryDomain(d.id),
                  'Primary domain set. Other addresses now redirect here'
                )
              }
              onRemove={() =>
                void act(`r-${d.id}`, () => siteApi.removeDomain(d.id), 'Domain removed')
              }
            />
          ))}
        </ul>
      </section>
    </div>
  )
}
