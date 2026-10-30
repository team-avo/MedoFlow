'use client'

/**
 * F2.5 — "Record over time": the patient's prior approved visits in this
 * clinic, beside the draft being reviewed (FR-7). Straight from the record
 * (no AI); every read is audited server-side.
 */
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { getLongitudinal } from '@/lib/aiScribeApi'
import { AppCard, AppCardContent, AppCardHeader, AppCardTitle } from '@/components/ui-system'

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' })

export function LongitudinalPanel({ sessionId }: { sessionId: string }) {
  const {
    data: visits,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['ai-scribe', 'longitudinal', sessionId],
    queryFn: () => getLongitudinal(sessionId),
    staleTime: 60_000,
  })

  return (
    <AppCard
      className="overflow-hidden border border-[#E5E7EB] shadow-none"
      role="region"
      aria-label="Record over time"
    >
      <AppCardHeader className="border-b border-[#E5E7EB] bg-gradient-to-r from-white to-[#F0F9FF] py-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
            <History className="h-4 w-4" />
          </span>
          <AppCardTitle className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
            Record over time
          </AppCardTitle>
        </div>
      </AppCardHeader>
      <AppCardContent className="space-y-4 p-5">
        {isLoading ? (
          <p className="text-xs text-slate-400">Loading prior visits…</p>
        ) : isError ? (
          <p className="text-xs text-slate-500">Prior visits could not be loaded.</p>
        ) : !visits?.length ? (
          <p className="text-xs text-slate-500">
            First approved visit for this patient — there is no earlier note to build on.
          </p>
        ) : (
          <ol className="space-y-4">
            {visits.map((v) => (
              <li key={v.visitRecordId} className="border-l-2 border-sky-200 pl-3">
                <p className="text-xs font-bold text-slate-700">{formatDate(v.date)}</p>
                {v.assessment && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    <span className="font-semibold text-slate-700">Assessment: </span>
                    {v.assessment}
                  </p>
                )}
                {v.plan && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    <span className="font-semibold text-slate-700">Plan: </span>
                    {v.plan}
                  </p>
                )}
                {v.products.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">Sent: </span>
                    {v.products
                      .map((p) => `${p.name}${p.dose ? ` ${p.dose}` : ''} × ${p.quantity}`)
                      .join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </AppCardContent>
    </AppCard>
  )
}
