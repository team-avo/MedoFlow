'use client'

/**
 * F2.1 — the one review screen behind both scribe entry points (the AI
 * Scribe console and the consultation room).
 *
 *  - the provider edits the SOAP note AND the patient-facing summary: the
 *    AI only drafts, nothing it wrote is used unreviewed (B2.3, F2.3);
 *  - "Approve & send" saves exactly what is on screen, finalizes the note,
 *    publishes only the summary to the patient and sends the confirmed
 *    products — one action, one server transaction (B2.4, B5.3);
 *  - it stays disabled until the note and summary have content and any
 *    detected products are confirmed.
 */
import React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  History as HistoryIcon,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  UserRound,
} from 'lucide-react'
import {
  approveSession,
  EMPTY_SOAP,
  EMPTY_SUMMARY,
  provenanceLabel,
  regenerateDraft,
  updateDraft,
  type AIScribeSession,
  type PatientSummary,
  type SoapDraft,
} from '@/lib/aiScribeApi'
import { apiErrorOf } from '@/lib/apiError'
import { useAppToast } from '@/hooks/useAppToast'
import { AppButton } from '@/components/ui-system'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  DetectedProductsPanel,
  rxApproval,
  type RxSelection,
} from '@/components/rxCart/DetectedProductsPanel'

const SOAP_FIELDS: Array<{ key: keyof SoapDraft; label: string }> = [
  { key: 'subjective', label: 'Subjective' },
  { key: 'objective', label: 'Objective' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan' },
]

const SUMMARY_FIELDS: Array<{ key: keyof PatientSummary; label: string; placeholder: string }> = [
  { key: 'diagnosis', label: 'What we found', placeholder: 'In plain language, for the patient…' },
  {
    key: 'treatmentPlan',
    label: 'What we recommended',
    placeholder: 'Treatment, products, exercises…',
  },
  { key: 'nextSteps', label: 'What to do next', placeholder: 'Follow-up, when to come back…' },
]

const hasText = (o: object) => Object.values(o).some((v) => typeof v === 'string' && v.trim())

/** Why "Approve & send" cannot run yet, or null when it can. */
export function approveBlockedReason(
  soap: SoapDraft,
  summary: PatientSummary,
  rx: ReturnType<typeof rxApproval>
): string | null {
  if (!hasText(soap)) return 'Write the clinical note before approving'
  if (!hasText(summary)) return 'Write the patient summary before sending it'
  if (!rx.ok) return rx.reason
  return null
}

interface Props {
  session: AIScribeSession
  /** The server's copy after any mutation. */
  onSessionChange: (session: AIScribeSession) => void
  /** Regeneration was queued: the parent should resume polling. */
  onProcessingStarted?: () => void
  onShowHistory?: () => void
}

export function ScribeReviewPanel({
  session,
  onSessionChange,
  onProcessingStarted,
  onShowHistory,
}: Props) {
  const toast = useAppToast()
  const queryClient = useQueryClient()
  const [soap, setSoap] = React.useState<SoapDraft>(session.aiDraft ?? EMPTY_SOAP)
  const [summary, setSummary] = React.useState<PatientSummary>({
    ...EMPTY_SUMMARY,
    ...(session.patientSummary ?? {}),
  })
  const [rxSelection, setRxSelection] = React.useState<RxSelection | null>(null)

  // A new draft from the server (regenerated, simulated) replaces local edits,
  // and its detected products replace the old lines (new ids).
  const draftVersion = `${session.id}:${session.processingCompletedAt ?? ''}`
  React.useEffect(() => {
    setSoap(session.aiDraft ?? EMPTY_SOAP)
    setSummary({ ...EMPTY_SUMMARY, ...(session.patientSummary ?? {}) })
    void queryClient.invalidateQueries({ queryKey: ['rx-cart', 'proposal', session.id] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftVersion])

  const canEdit =
    (session.status === 'DRAFT_GENERATED' || session.status === 'EDITED') &&
    !session.visitRecord?.isFinalized
  const rx = rxApproval(rxSelection)
  const blocked = approveBlockedReason(soap, summary, rx)

  const save = useMutation({
    mutationFn: () => updateDraft(session.id, { ...soap, patientSummary: summary }),
    onSuccess: (s) => {
      onSessionChange(s)
      toast.success('Draft saved')
    },
    onError: (err) => toast.error(apiErrorOf(err).message),
  })

  const regenerate = useMutation({
    mutationFn: () => regenerateDraft(session.id),
    onSuccess: (s) => {
      onSessionChange(s)
      onProcessingStarted?.()
      toast.info('Regenerating the AI draft…')
    },
    onError: (err) => toast.error(apiErrorOf(err).message),
  })

  const approve = useMutation({
    mutationFn: () => {
      if (!rx.ok) throw new Error(rx.reason)
      return approveSession(session.id, {
        rxConfirmation: rx.rxConfirmation,
        sendToPatient: true,
        draft: soap,
        patientSummary: summary,
      })
    },
    onSuccess: (approved) => {
      onSessionChange({ ...session, ...approved })
      queryClient.invalidateQueries({ queryKey: ['rx-cart', 'proposal'] })
      queryClient.invalidateQueries({ queryKey: ['visit-history', session.visitRecordId] })
      const sent = approved.rxCart?.cartItemIds.length ?? 0
      toast.success(
        sent > 0
          ? `Note approved and sent · ${sent} product${sent > 1 ? 's' : ''} sent to the patient's cart`
          : 'Note approved · summary sent to the patient'
      )
    },
    onError: (err) => toast.error(apiErrorOf(err).message),
  })

  const busy = save.isPending || regenerate.isPending || approve.isPending
  const provenance = provenanceLabel(session)
  const continuity = session.timeline?.continuity

  return (
    <section aria-label="Review AI draft" className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary-600" />
          <h2 className="text-xl font-bold text-slate-900">Review the AI draft</h2>
          {provenance && (
            <span
              data-testid="scribe-provenance"
              className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600"
            >
              {provenance}
            </span>
          )}
        </div>
        {onShowHistory && (
          <AppButton
            variant="ghost"
            size="sm"
            onClick={onShowHistory}
            className="rounded-full text-slate-500 hover:text-slate-900"
          >
            <HistoryIcon className="mr-2 h-4 w-4" />
            Version history
          </AppButton>
        )}
      </div>

      <p className="text-sm text-slate-500">
        Drafted by AI from the conversation — check every section. Nothing is added to the record or
        sent to the patient until you approve.
      </p>

      {continuity && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-sm text-sky-900">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700">
            Since the last visit (AI, check before approving)
          </p>
          <p className="mt-1 leading-relaxed">{continuity}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {SOAP_FIELDS.map(({ key, label }) => (
          <div key={key} className="space-y-1.5">
            <label
              htmlFor={`soap-${key}`}
              className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600"
            >
              {label}
            </label>
            <Textarea
              id={`soap-${key}`}
              className={cn(
                'min-h-[160px] rounded-[12px] border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-900',
                'focus-visible:ring-accent/20 focus-visible:border-accent transition-colors'
              )}
              value={soap[key]}
              onChange={(e) => setSoap((prev) => ({ ...prev, [key]: e.target.value }))}
              placeholder={`Clinical ${key} notes…`}
              disabled={!canEdit || busy}
            />
          </div>
        ))}
      </div>

      <div
        aria-label="Patient summary"
        role="group"
        className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5"
      >
        <div className="flex items-start gap-2">
          <UserRound className="mt-0.5 h-4 w-4 text-emerald-700" />
          <div>
            <h3 className="text-sm font-bold text-emerald-900">Patient summary</h3>
            <p className="text-xs text-emerald-800/80">
              The only part the patient sees, in their portal. The clinical note and the transcript
              stay internal.
            </p>
          </div>
        </div>
        {SUMMARY_FIELDS.map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-1.5">
            <label
              htmlFor={`summary-${key}`}
              className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-900/80"
            >
              {label}
            </label>
            <Textarea
              id={`summary-${key}`}
              className="min-h-[72px] rounded-xl border-emerald-200 bg-white text-sm leading-relaxed"
              value={summary[key]}
              onChange={(e) => setSummary((prev) => ({ ...prev, [key]: e.target.value }))}
              placeholder={placeholder}
              disabled={!canEdit || busy}
            />
          </div>
        ))}
      </div>

      <DetectedProductsPanel
        sessionId={session.id}
        disabled={busy || !canEdit}
        onSelectionChange={setRxSelection}
      />

      {canEdit && (
        <div className="space-y-2 border-t border-slate-100 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-3">
              <AppButton
                variant="outline"
                className="rounded-full bg-white px-6"
                onClick={() => regenerate.mutate()}
                disabled={busy}
              >
                {regenerate.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Regenerate draft
              </AppButton>
              <AppButton
                variant="outline"
                className="rounded-full bg-white px-6"
                onClick={() => save.mutate()}
                disabled={busy}
              >
                {save.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save changes
              </AppButton>
            </div>
            <AppButton
              size="lg"
              className="rounded-full px-10 font-bold"
              onClick={() => approve.mutate()}
              disabled={busy || Boolean(blocked)}
              title={blocked ?? undefined}
            >
              {approve.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Approve &amp; send
            </AppButton>
          </div>
          {blocked ? (
            <p
              className="text-right text-xs font-medium text-amber-700"
              data-testid="approve-blocked"
            >
              {blocked}
            </p>
          ) : (
            <p className="text-right text-xs text-slate-500">
              Finalizes the note and sends only the patient summary to the patient&apos;s portal.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
