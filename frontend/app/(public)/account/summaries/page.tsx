'use client'

/**
 * F2.6 — the patient's care summaries: the plain-language summary of each
 * visit, once the provider approved and sent it. Never the clinical note or
 * the transcript (B2.4).
 */
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck, FileText } from 'lucide-react'
import { getMySummaries } from '@/lib/patientApi'
import { AppCard, AppCardContent, AppEmptyState, AppPageHeader } from '@/components/ui-system'
import { Skeleton } from '@/components/ui/skeleton'

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long' })

export default function AccountSummariesPage() {
  const {
    data: summaries,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['account', 'summaries'],
    queryFn: getMySummaries,
  })

  return (
    <div className="space-y-6">
      <AppPageHeader
        title="Visit Summaries"
        description="What your provider found, recommended and asked you to do after each visit."
      />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : isError ? (
        <AppCard className="border-rose-200">
          <AppCardContent className="p-6 text-sm text-rose-800">
            Your summaries could not be loaded. Please try again.
          </AppCardContent>
        </AppCard>
      ) : !summaries?.length ? (
        <AppEmptyState
          icon={<FileText className="h-6 w-6" />}
          title="No visit summaries yet"
          description="After a visit, your provider reviews their notes and sends you a summary. It will appear here."
          actionLabel="View appointments"
          onAction={() => {
            window.location.href = '/account/appointments'
          }}
        />
      ) : (
        <ol className="space-y-5" aria-label="Visit summaries">
          {summaries.map((s) => (
            <li key={s.sessionId}>
              <AppCard className="overflow-hidden border-none bg-white shadow-sm">
                <AppCardContent className="space-y-5 p-6 sm:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
                        <ClipboardCheck className="h-5 w-5" />
                      </span>
                      <div>
                        <h2 className="font-bold text-slate-900">{formatDate(s.visitDate)}</h2>
                        {s.providerName && (
                          <p className="text-xs text-slate-500">With {s.providerName}</p>
                        )}
                      </div>
                    </div>
                    <Link
                      href={`/account/appointments/${s.appointmentId}`}
                      className="text-xs font-semibold text-primary-600 hover:underline"
                    >
                      View appointment
                    </Link>
                  </div>
                  {s.summary.diagnosis && (
                    <section>
                      <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                        What we found
                      </h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-800">
                        {s.summary.diagnosis}
                      </p>
                    </section>
                  )}
                  {s.summary.treatmentPlan && (
                    <section>
                      <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                        What we recommended
                      </h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-800">
                        {s.summary.treatmentPlan}
                      </p>
                    </section>
                  )}
                  {s.summary.nextSteps && (
                    <section className="rounded-2xl bg-primary-50/60 p-4">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-primary-700">
                        Next steps
                      </h3>
                      <p className="mt-1 text-sm font-medium text-slate-800">
                        {s.summary.nextSteps}
                      </p>
                    </section>
                  )}
                </AppCardContent>
              </AppCard>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
