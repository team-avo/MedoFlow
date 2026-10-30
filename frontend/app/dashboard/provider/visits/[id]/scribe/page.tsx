'use client'

/**
 * The AI Scribe console for one visit (Component 2): consent → record or
 * upload → AI draft → review → "Approve & send". The review core is shared
 * with the consultation room (components/aiScribe/ScribeWorkspace).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, Mic, Sparkles, Square, Upload } from 'lucide-react'
import { attestVerbalConsent, simulateSession, startSession, uploadAudio } from '@/lib/aiScribeApi'
import { getVisitWithHistory } from '@/lib/patientApi'
import { apiErrorOf } from '@/lib/apiError'
import { AppBadge, AppButton, AppCard, AppCardContent } from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppToast } from '@/hooks/useAppToast'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { useScribeCapabilities, useScribeSession } from '@/hooks/useScribeSession'
import { ScribeWorkspace } from '@/components/aiScribe/ScribeWorkspace'
import { ScribeConsentPanel } from '@/components/aiScribe/ScribeStatusPanels'
import { ManualNoteModal } from '@/components/visit/ManualNoteModal'

const STATUS_BADGES: Record<
  string,
  { label: string; variant: 'destructive' | 'warning' | 'accent' | 'outline' | 'success' }
> = {
  RECORDING: { label: 'Ready to record', variant: 'outline' },
  TRANSCRIBING: { label: 'AI processing…', variant: 'warning' },
  DRAFT_GENERATED: { label: 'Draft ready', variant: 'accent' },
  EDITED: { label: 'Draft edited', variant: 'outline' },
  APPROVED: { label: 'Approved', variant: 'success' },
  FAILED: { label: 'AI error', variant: 'destructive' },
}

const formatDuration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

function ProviderAIScribePageContent() {
  const params = useParams()
  const router = useRouter()
  const visitRecordId = params.id as string
  const toast = useAppToast()

  const scribe = useScribeSession({ by: 'visit', visitRecordId })
  const { session, setSession } = scribe
  const { data: caps } = useScribeCapabilities()
  const recorder = useAudioRecorder()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadAfterStopRef = useRef(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [manualOpen, setManualOpen] = useState(false)

  const { data: visit, refetch: refetchVisit } = useQuery({
    queryKey: ['visit-history', visitRecordId],
    queryFn: () => getVisitWithHistory(visitRecordId),
    enabled: manualOpen,
  })

  const onError = (err: unknown) => toast.error(apiErrorOf(err).message)

  const start = useMutation({
    mutationFn: () => startSession(visitRecordId),
    onSuccess: (s) => setSession(s),
    onError,
  })

  const attest = useMutation({
    mutationFn: () => attestVerbalConsent(session!.id),
    onSuccess: (s) => {
      setSession({ ...session!, ...s })
      toast.success('Consent recorded')
    },
    onError,
  })

  const upload = useMutation({
    mutationFn: (file: File) => uploadAudio(session!.id, file, setUploadProgress),
    onMutate: () => setUploadProgress(0),
    onSuccess: (s) => {
      setSession({ ...session!, ...s })
      scribe.restartPolling()
      toast.success('Recording uploaded — the AI is drafting the note')
    },
    onError,
    onSettled: () => setUploadProgress(null),
  })

  const simulate = useMutation({
    mutationFn: () => simulateSession(session!.id),
    onSuccess: (s) => {
      setSession({ ...session!, ...s })
      toast.success('Demo conversation loaded (synthetic)')
    },
    onError,
  })

  // Upload the recording once MediaRecorder has handed over the final blob.
  useEffect(() => {
    if (!uploadAfterStopRef.current || !recorder.audioBlob || !session) return
    uploadAfterStopRef.current = false
    const type = recorder.audioBlob.type || 'audio/webm'
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'
    upload.mutate(new File([recorder.audioBlob], `recording.${ext}`, { type }))
    recorder.resetRecording()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.audioBlob])

  const handleStartRecording = useCallback(async () => {
    try {
      await recorder.startRecording()
    } catch {
      // recorder.error explains it (permission denied, no microphone, …)
    }
  }, [recorder])

  const handleStopRecording = useCallback(() => {
    uploadAfterStopRef.current = true
    recorder.stopRecording()
  }, [recorder])

  if (scribe.isLoading) {
    return (
      <div className="space-y-6 p-8">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    )
  }

  const consentGranted = session?.consent?.status === 'GRANTED'
  const recordingAllowed = Boolean(caps?.available) && consentGranted
  const uploading = upload.isPending

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sticks below the dashboard TopBar (h-14), not underneath it. */}
      <div className="sticky top-14 z-20 border-b bg-white px-4 py-5 sm:px-8 sm:py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <AppButton
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
              className="rounded-full"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </AppButton>
            <div>
              <h1 className="text-2xl font-black text-slate-900">AI Scribe Console</h1>
              <p className="text-sm font-medium text-slate-500">Documentation assistant</p>
            </div>
          </div>
          {session && (
            <AppBadge
              variant={STATUS_BADGES[session.status]?.variant ?? 'outline'}
              className="rounded-full px-4 py-1 text-xs font-black uppercase tracking-widest"
            >
              {STATUS_BADGES[session.status]?.label ?? session.status}
            </AppBadge>
          )}
        </div>
      </div>

      <PageContainer className="max-w-6xl space-y-8 py-8">
        {scribe.error ? (
          <AppCard className="border-rose-200 p-8 text-center">
            <p className="text-sm text-rose-800">{apiErrorOf(scribe.error).message}</p>
          </AppCard>
        ) : !session ? (
          <AppCard className="space-y-6 border-none p-12 text-center shadow-sm">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary-50 text-primary-600">
              <Sparkles className="h-10 w-10" />
            </div>
            <div className="mx-auto max-w-md space-y-2">
              <h2 className="text-2xl font-bold text-slate-900">Start documentation</h2>
              <p className="text-slate-500">
                Record the consultation (or upload a recording) and the AI drafts the note for your
                review.
              </p>
            </div>
            <AppButton
              size="lg"
              className="rounded-full px-10"
              onClick={() => start.mutate()}
              disabled={start.isPending}
            >
              Start documentation session
            </AppButton>
          </AppCard>
        ) : (
          <>
            {session.status === 'RECORDING' && session.consent && (
              <ScribeConsentPanel
                consent={session.consent}
                onAttest={() => attest.mutate()}
                attesting={attest.isPending}
                onManual={() => setManualOpen(true)}
              />
            )}

            {(session.status === 'RECORDING' || session.status === 'FAILED') && (
              <AppCard className="overflow-hidden border-none bg-white shadow-sm">
                <AppCardContent className="space-y-4 p-6">
                  {caps && !caps.available && (
                    <p
                      role="status"
                      className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      The AI scribe is not set up on this server, so recordings cannot be
                      transcribed. Write the note manually
                      {caps.demoEnabled ? ', or load the demo conversation' : ''}.
                    </p>
                  )}
                  {recorder.error && (
                    <p role="alert" className="text-sm text-rose-700">
                      {recorder.error}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    {!recorder.isRecording ? (
                      <AppButton
                        variant="destructive"
                        className="rounded-full px-6"
                        onClick={handleStartRecording}
                        disabled={!recordingAllowed || uploading}
                      >
                        <Mic className="mr-2 h-4 w-4" /> Start recording
                      </AppButton>
                    ) : (
                      <AppButton
                        variant="outline"
                        className="rounded-full border-rose-200 px-6 text-rose-600 hover:bg-rose-50"
                        onClick={handleStopRecording}
                      >
                        <Square className="mr-2 h-4 w-4 fill-current" /> Stop &amp; process ·{' '}
                        <span className="font-mono tabular-nums">
                          {formatDuration(recorder.duration)}
                        </span>
                      </AppButton>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*,.webm"
                      className="hidden"
                      aria-label="Upload a recording"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) upload.mutate(file)
                      }}
                    />
                    <AppButton
                      variant="ghost"
                      className="rounded-full text-slate-500"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!recordingAllowed || uploading || recorder.isRecording}
                    >
                      <Upload className="mr-2 h-4 w-4" /> Upload a recording
                    </AppButton>
                    {caps?.demoEnabled && session.status === 'RECORDING' && (
                      <AppButton
                        variant="outline"
                        className="rounded-full"
                        onClick={() => simulate.mutate()}
                        disabled={simulate.isPending || recorder.isRecording}
                      >
                        <Sparkles className="mr-2 h-4 w-4" /> Demo: simulate conversation
                      </AppButton>
                    )}
                    <AppButton
                      variant="ghost"
                      className="rounded-full text-slate-500"
                      onClick={() => setManualOpen(true)}
                    >
                      Write note manually
                    </AppButton>
                  </div>
                </AppCardContent>
              </AppCard>
            )}

            <ScribeWorkspace
              scribe={scribe}
              onManual={() => setManualOpen(true)}
              uploadProgress={uploadProgress}
            />
          </>
        )}
      </PageContainer>

      {session?.visitRecord && (
        <ManualNoteModal
          open={manualOpen}
          onOpenChange={setManualOpen}
          appointmentId={session.visitRecord.appointmentId}
          patientId={session.visitRecord.patientId ?? ''}
          existingVisit={visit ?? null}
          onSaved={() => {
            void refetchVisit()
            void scribe.refetch()
          }}
        />
      )}
    </div>
  )
}

export default function ProviderAIScribePage() {
  return (
    <React.Suspense fallback={null}>
      <ProviderAIScribePageContent />
    </React.Suspense>
  )
}
