'use client'

import * as React from 'react'
import { CheckCircle2, Clock, FileSignature, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { PageContainer } from '@/components/layout'
import { AppErrorState, AppPageHeader, LoadingSkeleton } from '@/components/ui-system'
import { PracticeDetailsForm } from '@/components/onboarding/PracticeDetailsForm'
import { PractitionersForm } from '@/components/onboarding/PractitionersForm'
import { useApplication } from '@/components/onboarding/useApplication'
import { useAppToast } from '@/hooks/useAppToast'
import { apiErrorOf } from '@/lib/apiError'
import { onboardingApi, type Application, type VerificationStatus } from '@/lib/onboardingApi'
import { cn } from '@/lib/utils'

const STATUS_COPY: Record<
  VerificationStatus,
  { label: string; body: string; tone: string; icon: React.ElementType }
> = {
  PENDING_REVIEW: {
    label: 'Under review',
    body: 'Our team is verifying your NPI and licensing. Your website and online booking switch on once approved.',
    tone: 'border-indigo-100 bg-indigo-50 text-indigo-900',
    icon: Clock,
  },
  CHANGES_REQUESTED: {
    label: 'Changes requested',
    body: 'Update the details below, then resubmit the application for review.',
    tone: 'border-amber-200 bg-amber-50 text-amber-900',
    icon: RefreshCw,
  },
  APPROVED: {
    label: 'Approved',
    body: 'Your clinic is live: the public website and online booking are on.',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    icon: CheckCircle2,
  },
  REJECTED: {
    label: 'Not approved',
    body: 'The application was not approved, so the website and online booking stay off. Contact support with any questions.',
    tone: 'border-rose-200 bg-rose-50 text-rose-900',
    icon: XCircle,
  },
}

const TABS = [
  { key: 'practice', label: 'Practice details' },
  { key: 'practitioners', label: 'Practitioners' },
] as const

/**
 * Clinic profile (owner only): the practice application after onboarding —
 * review status, the signed agreement, and edits to practice details and
 * practitioners. When changes were requested, the owner resubmits from here.
 */
export default function ClinicProfilePage() {
  const { user, refetchUser } = useAuth()
  const toast = useAppToast()
  const { data, isLoading, isError, refetch, setApplication } = useApplication()
  const [tab, setTab] = React.useState<(typeof TABS)[number]['key']>('practice')
  const [resubmitting, setResubmitting] = React.useState(false)

  if (user && user.role !== 'SUPER_ADMIN') return null

  const saved = async (app: Application) => {
    setApplication(app)
    await refetchUser()
    toast.success('Saved')
  }

  const resubmit = async () => {
    setResubmitting(true)
    try {
      await onboardingApi.resubmit()
      await Promise.all([refetch(), refetchUser()])
      toast.success('Application resubmitted for review')
    } catch (err) {
      toast.error(apiErrorOf(err).message)
    } finally {
      setResubmitting(false)
    }
  }

  return (
    <PageContainer className="space-y-6">
      <AppPageHeader
        title="Clinic profile"
        description="Your practice application, licensing and practitioners."
      />

      {isLoading ? (
        <LoadingSkeleton variant="card" count={2} />
      ) : isError || !data?.verification || !data.progress ? (
        <AppErrorState title="Couldn't load your clinic profile" onRetry={() => void refetch()} />
      ) : (
        <>
          <StatusCard app={data} onResubmit={resubmit} resubmitting={resubmitting} />

          {data.verification.status === 'REJECTED' ? null : (
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm md:p-8">
              <div role="tablist" className="mb-6 flex gap-2 border-b border-slate-100">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    type="button"
                    aria-selected={tab === t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                      tab === t.key
                        ? 'border-indigo-600 text-indigo-700'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {tab === 'practice' ? (
                <PracticeDetailsForm
                  key={`practice-${data.profile?.id ?? 'new'}`}
                  application={data}
                  owner={{ name: user?.name, email: user?.email }}
                  submitLabel="Save changes"
                  onSaved={saved}
                />
              ) : (
                <PractitionersForm
                  application={data}
                  owner={{ name: user?.name, email: user?.email }}
                  submitLabel="Save changes"
                  onSaved={saved}
                />
              )}
            </div>
          )}
        </>
      )}
    </PageContainer>
  )
}

function StatusCard({
  app,
  onResubmit,
  resubmitting,
}: {
  app: Application
  onResubmit: () => void
  resubmitting: boolean
}) {
  const copy = STATUS_COPY[app.verification.status]
  const Icon = copy.icon
  const complete = app.progress.practice && app.progress.practitioners && app.progress.agreement
  return (
    <section
      aria-label="Review status"
      data-testid="clinic-review-status"
      className={cn('rounded-2xl border p-5', copy.tone)}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">
              {complete || app.verification.status !== 'PENDING_REVIEW'
                ? copy.label
                : 'Application not submitted yet'}
            </p>
            <p className="mt-0.5 text-sm">{copy.body}</p>
            {app.verification.notes && app.verification.status !== 'APPROVED' && (
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/70 px-3 py-2 text-sm">
                <span className="font-medium">Reviewer&apos;s note:</span> {app.verification.notes}
              </p>
            )}
            {app.agreement && (
              <p className="mt-2 flex items-center gap-1.5 text-xs opacity-80">
                <FileSignature className="h-3.5 w-3.5" />
                Agreement {app.agreement.version} signed by {app.agreement.signerName} (
                {app.agreement.signerTitle}) on{' '}
                {new Date(app.agreement.acceptedAt).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
        {app.verification.status === 'CHANGES_REQUESTED' && (
          <button
            type="button"
            onClick={onResubmit}
            disabled={resubmitting}
            className="inline-flex items-center gap-2 rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {resubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Resubmit for review
          </button>
        )}
      </div>
    </section>
  )
}
