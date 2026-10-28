'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, ShieldCheck, Mail, Loader2, Copy } from 'lucide-react'
import api from '@/lib/api'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

interface ClinicDetail {
  id: string
  name: string
  slug: string
  status: string
  plan: string
  trialEndsAt: string | null
  termsAcceptedAt: string | null
  termsVersion: string | null
  onboardingCompletedAt: string | null
  onboardingStep: number
  createdAt: string
  brand: {
    subdomain: string
    customDomain: string | null
    primaryColor: string
    logoUrl: string | null
  } | null
  clinics: {
    id: string
    name: string
    email: string
    isActive: boolean
    _count: { providers: number; locations: number; users: number }
  }[]
}

export default function ClinicDetailPage() {
  const params = useParams<{ tenantId: string }>()
  const tenantId = params?.tenantId
  const [data, setData] = React.useState<ClinicDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [resending, setResending] = React.useState(false)
  const [resendResult, setResendResult] = React.useState<{
    setupLink: string
    ownerEmail: string
  } | null>(null)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await api.get<{ success: boolean; data: ClinicDetail }>(
          `/platform/clinics/${tenantId}`
        )
        if (!cancelled) setData(res.data.data)
      } catch (e: unknown) {
        if (cancelled) return
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          'Could not load this clinic'
        setError(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tenantId])

  const onResendInvite = async () => {
    if (!tenantId || resending) return
    setResending(true)
    setResendResult(null)
    try {
      const res = await api.post<{
        success: boolean
        data: { setupLink: string; ownerEmail: string }
      }>(`/platform/clinics/${tenantId}/resend-invite`)
      setResendResult(res.data.data)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not resend invite'
      setError(msg)
    } finally {
      setResending(false)
    }
  }

  if (loading) {
    return <LoadingSkeleton variant="page" />
  }
  if (error || !data) {
    return (
      <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error ?? 'Not found'}
      </div>
    )
  }

  const clinic = data.clinics[0]

  return (
    <div className="space-y-6">
      <Link
        href="/platform/clinics"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to clinics
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold tracking-tight text-slate-900">
            {data.name}
          </h1>
          <p className="mt-1 break-all font-mono text-xs text-slate-500">
            {data.brand?.subdomain ?? data.slug}.medoflow.com
          </p>
        </div>
        <button
          type="button"
          onClick={onResendInvite}
          disabled={resending}
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          {resending ? 'Sending…' : 'Resend setup invite'}
        </button>
      </div>

      {resendResult && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 text-sm">
          <p className="font-semibold text-slate-900">Invite resent to {resendResult.ownerEmail}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-white px-2 py-1 font-mono text-xs text-slate-700">
              {resendResult.setupLink}
            </code>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(resendResult.setupLink)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                } catch {
                  /* noop */
                }
              }}
              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700"
            >
              <Copy className="h-3 w-3" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Status" value={data.status} />
        <Stat label="Plan" value={data.plan} />
        <Stat
          label="Trial ends"
          value={data.trialEndsAt ? new Date(data.trialEndsAt).toLocaleDateString() : '—'}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Activation</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-start justify-between gap-4">
              <span className="text-slate-600">Agreement on file</span>
              {data.termsAcceptedAt ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {new Date(data.termsAcceptedAt).toLocaleDateString()}
                  {data.termsVersion ? ` · ${data.termsVersion}` : ''}
                </span>
              ) : (
                <span className="text-amber-600">Pending</span>
              )}
            </li>
            <li className="flex items-start justify-between gap-4">
              <span className="text-slate-600">Onboarding wizard</span>
              <span className={data.onboardingCompletedAt ? 'text-emerald-700' : 'text-slate-500'}>
                {data.onboardingCompletedAt
                  ? `Completed ${new Date(data.onboardingCompletedAt).toLocaleDateString()}`
                  : `Step ${data.onboardingStep}/6`}
              </span>
            </li>
            <li className="flex items-start justify-between gap-4">
              <span className="text-slate-600">Created</span>
              <span className="text-slate-700">
                {new Date(data.createdAt).toLocaleDateString()}
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Brand</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-start justify-between gap-4">
              <span className="text-slate-600">Subdomain</span>
              <span className="min-w-0 break-all text-right font-mono text-xs text-slate-700">
                {data.brand?.subdomain ?? '—'}
              </span>
            </li>
            <li className="flex items-start justify-between gap-4">
              <span className="text-slate-600">Custom domain</span>
              <span className="min-w-0 break-all text-right text-slate-700">
                {data.brand?.customDomain ?? '—'}
              </span>
            </li>
            <li className="flex items-start justify-between gap-4">
              <span className="text-slate-600">Primary color</span>
              <span className="inline-flex items-center gap-2">
                <span
                  className="h-4 w-4 rounded-full ring-1 ring-slate-200"
                  style={{ backgroundColor: data.brand?.primaryColor ?? '#6366f1' }}
                />
                <code className="text-xs">{data.brand?.primaryColor ?? '—'}</code>
              </span>
            </li>
          </ul>
        </div>
      </div>

      {clinic && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Primary clinic</h2>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <Stat small label="Clinic" value={clinic.name} />
            <Stat small label="Providers" value={String(clinic._count.providers)} />
            <Stat small label="Locations" value={String(clinic._count.locations)} />
            <Stat small label="Users" value={String(clinic._count.users)} />
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-100 bg-slate-50/50 ${small ? 'p-3' : 'p-4'}`}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 break-words ${small ? 'text-sm' : 'text-base'} font-semibold text-slate-900`}
      >
        {value}
      </p>
    </div>
  )
}
