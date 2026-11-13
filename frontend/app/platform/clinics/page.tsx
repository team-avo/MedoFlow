'use client'

import * as React from 'react'
import Link from 'next/link'
import { Plus, Search, ShieldCheck, AlertCircle } from 'lucide-react'
import api from '@/lib/api'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

type Status = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED'
type Plan = 'FREE' | 'STARTER' | 'GROWTH' | 'ENTERPRISE'
type Verification = 'PENDING_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED'

const VERIFICATION_LABELS: Record<Verification, string> = {
  PENDING_REVIEW: 'In review',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
}

const VERIFICATION_STYLES: Record<Verification, string> = {
  PENDING_REVIEW: 'bg-indigo-50 text-indigo-700',
  CHANGES_REQUESTED: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-rose-50 text-rose-700',
}

interface ClinicRow {
  id: string
  name: string
  slug: string
  status: Status
  plan: Plan
  trialEndsAt: string | null
  termsAcceptedAt: string | null
  onboardingCompletedAt: string | null
  verificationStatus: Verification
  submittedForReviewAt: string | null
  createdAt: string
  clinics: { id: string; name: string; email: string }[]
}

const STATUS_STYLES: Record<Status, string> = {
  TRIAL: 'bg-amber-50 text-amber-700',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  PAST_DUE: 'bg-rose-50 text-rose-700',
  SUSPENDED: 'bg-slate-200 text-slate-600',
  CANCELED: 'bg-slate-100 text-slate-500',
}

export default function PlatformClinicsListPage() {
  const [q, setQ] = React.useState('')
  const [status, setStatus] = React.useState<Status | ''>('')
  const [verification, setVerification] = React.useState<Verification | ''>('')
  const [pendingReview, setPendingReview] = React.useState(0)
  const [items, setItems] = React.useState<ClinicRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (status) params.set('status', status)
      if (verification) params.set('verification', verification)
      const { data } = await api.get<{
        success: boolean
        data: { items: ClinicRow[]; total: number; pendingReview: number }
      }>(`/platform/clinics?${params.toString()}`)
      setItems(data.data.items)
      setTotal(data.data.total)
      setPendingReview(data.data.pendingReview ?? 0)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not load clinics'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [q, status, verification])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Platform admin
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Clinics</h1>
          <p className="mt-1 text-sm text-slate-600">
            {total} {total === 1 ? 'clinic' : 'clinics'} provisioned · invite admins, monitor
            agreement status, and review activation.
          </p>
        </div>
        <Link
          href="/platform/clinics/new"
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New clinic
        </Link>
      </div>

      {pendingReview > 0 && (
        <button
          type="button"
          onClick={() => setVerification('PENDING_REVIEW')}
          data-testid="review-queue"
          className="flex w-full items-center justify-between rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-left text-sm text-indigo-900 hover:bg-indigo-100"
        >
          <span>
            <strong>{pendingReview}</strong>{' '}
            {pendingReview === 1 ? 'clinic application is' : 'clinic applications are'} waiting for
            review
          </span>
          <span className="font-semibold">Show queue →</span>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by clinic name or subdomain"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | '')}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        >
          <option value="">All statuses</option>
          <option value="TRIAL">Trial</option>
          <option value="ACTIVE">Active</option>
          <option value="PAST_DUE">Past due</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="CANCELED">Canceled</option>
        </select>
        <select
          aria-label="Review status"
          value={verification}
          onChange={(e) => setVerification(e.target.value as Verification | '')}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        >
          <option value="">Any review status</option>
          {(Object.keys(VERIFICATION_LABELS) as Verification[]).map((v) => (
            <option key={v} value={v}>
              {VERIFICATION_LABELS[v]}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-max text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Clinic</th>
              <th className="px-4 py-3">Subdomain</th>
              <th className="px-4 py-3">Review</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Agreement</th>
              <th className="px-4 py-3">Onboarded</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-6">
                  <LoadingSkeleton variant="text" count={4} />
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-rose-600">
                  <AlertCircle className="mr-1 inline h-4 w-4" />
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                  No clinics yet. Use <strong>New clinic</strong> to provision the first one.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              items.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <Link
                      href={`/platform/clinics/${row.id}`}
                      className="font-medium text-slate-900 hover:text-indigo-700"
                    >
                      {row.name}
                    </Link>
                    <p className="text-xs text-slate-500">{row.clinics[0]?.email ?? 'Not set'}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.slug}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${VERIFICATION_STYLES[row.verificationStatus]}`}
                    >
                      {row.verificationStatus === 'PENDING_REVIEW' && !row.submittedForReviewAt
                        ? 'Not submitted'
                        : VERIFICATION_LABELS[row.verificationStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.plan}</td>
                  <td className="px-4 py-3 text-xs">
                    {row.termsAcceptedAt ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <ShieldCheck className="h-3.5 w-3.5" /> Accepted
                      </span>
                    ) : (
                      <span className="text-amber-600">Pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {row.onboardingCompletedAt ? (
                      <span className="text-emerald-700">Done</span>
                    ) : (
                      <span className="text-slate-400">Not set</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(row.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
