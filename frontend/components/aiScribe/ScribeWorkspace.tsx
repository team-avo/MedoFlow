'use client'

/**
 * F2.1 — everything after the recording, identical on both scribe screens:
 * processing → (failed | review) → approved, with the transcript, the
 * clinical timeline and the patient's record over time alongside.
 */
import React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { processSession, publishPatientSummary } from '@/lib/aiScribeApi'
import { getVisitWithHistory } from '@/lib/patientApi'
import { apiErrorOf } from '@/lib/apiError'
import { useAppToast } from '@/hooks/useAppToast'
import type { useScribeSession } from '@/hooks/useScribeSession'
import { AppCard, AppCardContent } from '@/components/ui-system'
import { NoteHistoryModal } from '@/components/visit/NoteHistoryModal'
import { ClinicalTimelineCard } from './ClinicalTimelineCard'
import { LongitudinalPanel } from './LongitudinalPanel'
import { ScribeReviewPanel } from './ScribeReviewPanel'
import { TranscriptCard } from './TranscriptCard'
import { ScribeApprovedPanel, ScribeFailedPanel, ScribeProcessingPanel } from './ScribeStatusPanels'

interface Props {
  scribe: ReturnType<typeof useScribeSession>
  /** Opens the manual SOAP note (the fallback when the AI cannot help). */
  onManual: () => void
  /** 0..1 while a recording uploads. */
  uploadProgress?: number | null
}

export function ScribeWorkspace({ scribe, onManual, uploadProgress }: Props) {
  const toast = useAppToast()
  const { session } = scribe
  const [showHistory, setShowHistory] = React.useState(false)

  const { data: visitWithHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['visit-history', session?.visitRecordId],
    queryFn: () => getVisitWithHistory(session!.visitRecordId),
    enabled: Boolean(session?.visitRecordId) && showHistory,
  })

  const retry = useMutation({
    mutationFn: () => processSession(session!.id),
    onSuccess: (s) => {
      scribe.setSession(s)
      scribe.restartPolling()
    },
    onError: (err) => toast.error(apiErrorOf(err).message),
  })

  const publish = useMutation({
    mutationFn: () => publishPatientSummary(session!.id),
    onSuccess: (s) => {
      scribe.setSession({ ...session!, ...s })
      toast.success('Summary sent to the patient')
    },
    onError: (err) => toast.error(apiErrorOf(err).message),
  })

  if (!session) return null
  const status = session.status
  const reviewing = status === 'DRAFT_GENERATED' || status === 'EDITED' || status === 'APPROVED'

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {(status === 'TRANSCRIBING' || (uploadProgress != null && uploadProgress < 1)) && (
          <ScribeProcessingPanel
            timedOut={scribe.timedOut}
            onCheckAgain={scribe.restartPolling}
            uploadProgress={uploadProgress}
          />
        )}
        {status === 'FAILED' && (
          <ScribeFailedPanel
            message={session.errorMessage}
            onRetry={session.audioUrl || session.transcript ? () => retry.mutate() : undefined}
            retrying={retry.isPending}
            onManual={onManual}
          />
        )}
        {status === 'APPROVED' && (
          <ScribeApprovedPanel
            session={session}
            onPublish={() => publish.mutate()}
            publishing={publish.isPending}
          />
        )}
        {reviewing && (
          <AppCard className="overflow-hidden rounded-[2rem] border-none bg-white shadow-xl">
            <AppCardContent className="p-6 sm:p-10">
              <ScribeReviewPanel
                session={session}
                onSessionChange={scribe.setSession}
                onProcessingStarted={scribe.restartPolling}
                onShowHistory={() => setShowHistory(true)}
              />
            </AppCardContent>
          </AppCard>
        )}
      </div>

      <div className="space-y-6">
        {session.transcript && (
          <TranscriptCard transcript={session.transcript} sttModel={session.sttModel} />
        )}
        {session.timeline && <ClinicalTimelineCard timeline={session.timeline} />}
        {reviewing && <LongitudinalPanel sessionId={session.id} />}
      </div>

      <NoteHistoryModal
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        versions={visitWithHistory?.versions || []}
        isLoading={showHistory && historyLoading}
        currentVersionId={
          (visitWithHistory as { currentVersionId?: string } | undefined)?.currentVersionId
        }
      />
    </div>
  )
}
