'use client'

/**
 * The scribe states around the review screen (FR-1, FR-11): every state
 * says what is happening and what the provider can do next — there is no
 * dead end. Shared by the AI Scribe console and the consultation room.
 */
import React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Lock,
  PencilLine,
  RefreshCw,
  Share2,
  ShieldX,
} from 'lucide-react'
import { AppButton } from '@/components/ui-system'
import type { AIScribeSession, ConsentState } from '@/lib/aiScribeApi'

const box = 'rounded-3xl border p-6 sm:p-8'

/** FR-1: the visit may not be recorded yet (or at all). */
export function ScribeConsentPanel({
  consent,
  onAttest,
  attesting,
  onManual,
}: {
  consent: ConsentState
  onAttest?: () => void
  attesting?: boolean
  onManual?: () => void
}) {
  const [confirmed, setConfirmed] = React.useState(false)
  if (consent.status === 'GRANTED') return null

  if (consent.status === 'DECLINED') {
    return (
      <div role="status" className={`${box} border-rose-200 bg-rose-50/60`}>
        <div className="flex items-start gap-4">
          <ShieldX className="mt-0.5 h-6 w-6 shrink-0 text-rose-600" />
          <div className="space-y-3">
            <div>
              <h3 className="font-bold text-rose-900">The patient declined AI recording</h3>
              <p className="mt-1 text-sm text-rose-800/80">
                This visit cannot be recorded or sent to the AI. Document it manually instead.
              </p>
            </div>
            {onManual && (
              <AppButton variant="outline" className="rounded-full" onClick={onManual}>
                <PencilLine className="mr-2 h-4 w-4" />
                Write note manually
              </AppButton>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div role="status" className={`${box} border-amber-200 bg-amber-50/60`}>
      <div className="flex items-start gap-4">
        <Lock className="mt-0.5 h-6 w-6 shrink-0 text-amber-700" />
        <div className="flex-1 space-y-3">
          <div>
            <h3 className="font-bold text-amber-900">Patient consent is needed before recording</h3>
            <p className="mt-1 text-sm leading-relaxed text-amber-800/80">
              The patient did not opt in when booking. Ask them now: the recording is transcribed
              and drafted by AI, and only you approve what goes into their record.
            </p>
          </div>
          {onAttest && (
            <div className="space-y-3 rounded-2xl border border-amber-200 bg-white p-4">
              <label className="flex items-start gap-2 text-sm font-medium text-slate-800">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                The patient gave verbal consent to AI recording for this visit
              </label>
              <div className="flex flex-wrap gap-3">
                <AppButton
                  size="sm"
                  className="rounded-full"
                  disabled={!confirmed || attesting}
                  onClick={onAttest}
                >
                  {attesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Record consent
                </AppButton>
                {onManual && (
                  <AppButton size="sm" variant="ghost" className="rounded-full" onClick={onManual}>
                    Write note manually instead
                  </AppButton>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** The AI is working; after the polling cap, "Check again". */
export function ScribeProcessingPanel({
  timedOut,
  onCheckAgain,
  uploadProgress,
}: {
  timedOut: boolean
  onCheckAgain: () => void
  /** 0..1 while the audio is uploading. */
  uploadProgress?: number | null
}) {
  if (uploadProgress != null && uploadProgress < 1) {
    const pct = Math.round(uploadProgress * 100)
    return (
      <div role="status" className={`${box} border-blue-200 bg-blue-50/60`}>
        <p className="text-sm font-semibold text-blue-900">Uploading the recording… {pct}%</p>
        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-blue-100"
          role="progressbar"
          aria-label="Upload progress"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }
  if (timedOut) {
    return (
      <div role="status" className={`${box} border-amber-200 bg-amber-50/60`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-amber-900">
            This is taking longer than expected. The AI may still finish — check again, or write the
            note manually.
          </p>
          <AppButton variant="outline" className="rounded-full" onClick={onCheckAgain}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Check again
          </AppButton>
        </div>
      </div>
    )
  }
  return (
    <div role="status" className={`${box} border-indigo-100 bg-white`}>
      <div className="flex items-center gap-3 text-sm font-semibold text-primary-700">
        <Loader2 className="h-5 w-5 animate-spin" />
        Transcribing and drafting the note — usually under a minute.
      </div>
    </div>
  )
}

/** FR-11: a failed run says why (a safe, fixed text) and offers both ways forward. */
export function ScribeFailedPanel({
  message,
  onRetry,
  retrying,
  onManual,
}: {
  message?: string | null
  onRetry?: () => void
  retrying?: boolean
  onManual: () => void
}) {
  return (
    <div role="alert" className={`${box} border-rose-200 bg-rose-50/60`}>
      <div className="flex items-start gap-4">
        <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-rose-600" />
        <div className="flex-1 space-y-3">
          <div>
            <h3 className="font-bold text-rose-900">The AI could not draft this note</h3>
            <p className="mt-1 text-sm text-rose-800/80" data-testid="scribe-error">
              {message || 'Processing failed. Try again, or write the note manually.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {onRetry && (
              <AppButton className="rounded-full" onClick={onRetry} disabled={retrying}>
                {retrying ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Retry
              </AppButton>
            )}
            <AppButton variant="outline" className="rounded-full" onClick={onManual}>
              <PencilLine className="mr-2 h-4 w-4" />
              Write note manually
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The note is final. The summary is published, or can still be sent. */
export function ScribeApprovedPanel({
  session,
  onPublish,
  publishing,
}: {
  session: AIScribeSession
  onPublish?: () => void
  publishing?: boolean
}) {
  const published = Boolean(session.patientSummaryPublished)
  return (
    <div role="status" className={`${box} border-emerald-200 bg-emerald-50/70`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
          <div>
            <h3 className="font-bold text-emerald-900">
              {published ? 'Note approved and sent' : 'Note approved'}
            </h3>
            <p className="mt-0.5 text-sm text-emerald-800/80">
              {published
                ? 'The patient can read their summary in the portal. The note is in the record.'
                : 'The note is in the record. The patient summary has not been sent yet.'}
            </p>
          </div>
        </div>
        {!published && onPublish && (
          <AppButton className="rounded-full" onClick={onPublish} disabled={publishing}>
            {publishing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="mr-2 h-4 w-4" />
            )}
            Send summary to patient
          </AppButton>
        )}
      </div>
    </div>
  )
}
