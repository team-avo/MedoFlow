'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import * as consultationApi from '@/lib/consultationApi'
import * as aiScribeApi from '@/lib/aiScribeApi'
import { startConsultationRecordingFlow } from '@/lib/consultationRecordingFlow'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { useAppToast } from '@/hooks/useAppToast'
import { JitsiVideoCall } from '@/components/consultation/JitsiVideoCall'

// UI System Components
import { PageContainer } from '@/components/layout/PageContainer'
import {
  AppCard,
  AppCardHeader,
  AppCardTitle,
  AppCardContent,
} from '@/components/ui-system/AppCard'
import { AppModal } from '@/components/ui-system/AppModal'
import { AppFormField } from '@/components/ui-system/AppFormField'
import { AppButton } from '@/components/ui-system/AppButton'
import { Textarea } from '@/components/ui/textarea'
import { ManualNoteModal } from '@/components/visit/ManualNoteModal'
import {
  ArrowLeft,
  Video,
  Mic,
  Square,
  Sparkles,
  Upload,
  Copy,
  FileText,
  RefreshCw,
  Lock,
  Activity,
  CheckCircle2,
  AlertTriangle,
  PencilLine,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    NOT_STARTED: 'Not Started',
    READY: 'Ready',
    LIVE: 'Live',
    RECORDING: 'Recording',
    ENDED: 'Ended',
    PROCESSING: 'Processing',
    TRANSCRIPT_READY: 'Transcript Ready',
    FAILED: 'Failed',
    STOPPED: 'Stopped',
    UPLOADING: 'Uploading…',
    STORED: 'Stored',
    PENDING: 'Pending',
    GRANTED: 'Granted',
    DECLINED: 'Declined',
    TRANSCRIBING: 'Transcribing…',
    DRAFT_GENERATED: 'Draft Ready',
    EDITED: 'Edited',
    APPROVED: 'Approved',
  }
  return map[status] || status
}

function statusColor(status: string): string {
  const colors: Record<string, string> = {
    READY: 'bg-blue-100 text-blue-800',
    LIVE: 'bg-emerald-100 text-emerald-800',
    RECORDING: 'bg-red-100 text-red-800',
    ENDED: 'bg-slate-100 text-slate-800',
    PROCESSING: 'bg-amber-100 text-amber-800',
    TRANSCRIPT_READY: 'bg-emerald-100 text-emerald-800',
    FAILED: 'bg-red-100 text-red-800',
    GRANTED: 'bg-emerald-100 text-emerald-800',
    PENDING: 'bg-amber-100 text-amber-800',
    STORED: 'bg-emerald-100 text-emerald-800',
    DRAFT_GENERATED: 'bg-blue-100 text-blue-800',
    APPROVED: 'bg-emerald-100 text-emerald-800',
  }
  return colors[status] || 'bg-slate-100 text-slate-800'
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ConsultationRoomPage() {
  const params = useParams()
  const router = useRouter()
  const appointmentId = params.id as string

  const [session, setSession] = useState<consultationApi.ConsultationSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [transcript, setTranscript] = useState<consultationApi.TranscriptResult | null>(null)
  const [aiScribeSession, setAiScribeSession] = useState<aiScribeApi.AIScribeSession | null>(null)
  const [showDraftModal, setShowDraftModal] = useState(false)
  const [draftForm, setDraftForm] = useState({
    subjective: '',
    objective: '',
    assessment: '',
    plan: '',
  })
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null)
  const [manualNoteOpen, setManualNoteOpen] = useState(false)
  // When the provider leaves the Jitsi call while recording, we stop the
  // MediaRecorder and flag that we're waiting for the final blob to arrive.
  // A watching effect then auto-uploads + transcribes it. Without this
  // indirection we'd try to read `recorder.audioBlob` before React has set
  // it from the MediaRecorder `onstop` callback.
  const [autoUploadPending, setAutoUploadPending] = useState(false)
  const initialized = useRef(false)

  // ----- Video call state -----
  const [videoRoom, setVideoRoom] = useState<consultationApi.VideoRoomResult | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoActive, setVideoActive] = useState(false)
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)

  const recorder = useAudioRecorder()
  const toast = useAppToast()

  const handleSimulateClinicalConversation = async () => {
    if (!aiScribeSession || !session) return
    try {
      setTranscribing(true)
      const updated = await aiScribeApi.simulateSession(aiScribeSession.id)
      setAiScribeSession(updated)
      setTranscript({
        sessionId: session.id,
        transcript: updated.transcript || '',
        transcriptStatus: 'COMPLETED',
        aiScribeStatus: 'DRAFT_GENERATED',
        aiDraft: updated.aiDraft,
        timeline: updated.timeline,
        errorMessage: null,
      })
      toast.success('Clinical conversation simulated!')
    } catch (err) {
      toast.error('Failed to simulate conversation')
    } finally {
      setTranscribing(false)
    }
  }

  // ----- Load or create session -----
  const initSession = useCallback(async () => {
    if (initialized.current) return
    try {
      initialized.current = true
      setLoading(true)
      setError(null)
      const s = await consultationApi.startConsultation(appointmentId)
      setSession(s)
    } catch (err: unknown) {
      initialized.current = false
      const msg = err instanceof Error ? err.message : 'Failed to start consultation'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [appointmentId])

  useEffect(() => {
    initSession()
  }, [initSession])

  // ----- Refresh session -----
  const sessionId = session?.id
  const consentStatus = session?.consentStatus
  const refreshSession = useCallback(async () => {
    if (!sessionId) return
    try {
      const s = await consultationApi.getSession(sessionId)
      setSession(s)
    } catch {
      // ignore
    }
  }, [sessionId])

  // ----- Poll for session status (like consent) -----
  useEffect(() => {
    if (!sessionId || consentStatus === 'GRANTED') return

    const poll = setInterval(() => {
      refreshSession()
    }, 3000)

    return () => clearInterval(poll)
  }, [sessionId, consentStatus, refreshSession])

  // ----- Auto-upload the captured blob when the call ends -----
  // `autoUploadPending` is flipped on by `handleCallEnded`; we wait here
  // for MediaRecorder's async onstop to populate `recorder.audioBlob` and
  // then kick the upload → transcription chain without any user click.
  useEffect(() => {
    if (!autoUploadPending || !recorder.audioBlob || !session) return

    const blob = recorder.audioBlob
    setAutoUploadPending(false)

    void (async () => {
      try {
        setError(null)
        // Let the backend know recording is done (best-effort).
        await consultationApi.stopRecording(session.id).catch(() => null)

        setUploading(true)
        const uploaded = await consultationApi.uploadRecording(session.id, blob)
        setSession(uploaded)
        setUploading(false)

        setTranscribing(true)
        toast.success('Transcribing the call — hold tight')
        const result = await consultationApi.startTranscription(session.id)
        setSession(result.session)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to transcribe call'
        setError(msg)
      } finally {
        setUploading(false)
        setTranscribing(false)
      }
    })()
  }, [autoUploadPending, recorder.audioBlob, session, toast])

  // ----- Poll AI scribe status while processing -----
  useEffect(() => {
    if (!session?.aiScribeSessionId) return
    const aiSessionId = session.aiScribeSessionId

    const poll = setInterval(async () => {
      try {
        const status = await aiScribeApi.getSessionStatus(aiSessionId)
        if (status.status === 'DRAFT_GENERATED' || status.status === 'FAILED') {
          clearInterval(poll)
          const transcriptData = await consultationApi.getTranscript(session.id)
          setTranscript(transcriptData)
          // Pre-populate draft form so inline editor is ready immediately
          const aiSession = await aiScribeApi.getSession(aiSessionId)
          setAiScribeSession(aiSession)
          const draft = aiSession.aiDraft as Record<string, string> | null
          if (draft) {
            setDraftForm({
              subjective: draft.subjective || '',
              objective: draft.objective || '',
              assessment: draft.assessment || '',
              plan: draft.plan || '',
            })
          }
          await refreshSession()
          setTranscribing(false)
          if (status.status === 'DRAFT_GENERATED') {
            toast.success('AI draft ready — review and approve below')
          }
        }
      } catch {
        // ignore
      }
    }, 3000)

    setPollInterval(poll)
    return () => clearInterval(poll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.aiScribeSessionId])

  // ----- Video Call Controls -----
  const handleStartVideoCall = async () => {
    if (!session) return
    try {
      setVideoLoading(true)
      setError(null)
      const room = await consultationApi.createVideoRoom(session.id)
      setVideoRoom(room)
      setVideoActive(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create video room'
      setError(msg)
    } finally {
      setVideoLoading(false)
    }
  }

  // ----- Auto-Scribe wiring -----
  // When the provider enters the Jitsi conference, we start capturing mic
  // audio right away — assuming consent was granted (which is now the
  // default on any appointment booked with the consent checkbox on).
  const handleMeetingStarted = async () => {
    if (!session) return
    if (session.consentStatus !== 'GRANTED') {
      // Silently skip; "Waiting for patient consent" banner tells the
      // provider to share the join link.
      return
    }
    if (recorder.isRecording || session.recordingStatus === 'RECORDING') return
    try {
      const updated = await startConsultationRecordingFlow({
        startBrowserCapture: () => recorder.startRecording(),
        markRecordingStarted: () => consultationApi.startRecording(session.id),
        rollbackBrowserCapture: async () => {
          recorder.cancelRecording()
        },
      })
      setSession(updated)
      toast.success('AI Scribe started recording')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start recording'
      setError(msg)
    }
  }

  // Provider leaves the Jitsi call. If a recording was running, flag
  // `autoUploadPending` so the watcher effect below uploads the final
  // blob once MediaRecorder's onstop handler has populated
  // `recorder.audioBlob` in state.
  const handleCallEnded = () => {
    setVideoActive(false)
    if (recorder.isRecording) {
      setAutoUploadPending(true)
      recorder.stopRecording() // async via MediaRecorder.onstop
      toast.success('Call ended — AI Scribe finishing up')
    } else if (recorder.audioBlob) {
      // Already have a blob buffered (e.g. manual recorder was used);
      // kick the same path.
      setAutoUploadPending(true)
    } else {
      toast.success('Video call ended')
    }
  }

  const handleRecordingData = (blob: Blob) => {
    setRecordingBlob(blob)
    toast.success('Audio captured from video call')
  }

  // ----- Upload recording from Daily.co -----
  const handleUploadDailyRecording = async () => {
    if (!session || !recordingBlob) return
    try {
      setError(null)
      setUploading(true)
      const updated = await consultationApi.uploadRecording(session.id, recordingBlob)
      setSession(updated)
      setUploading(false)

      setTranscribing(true)
      const result = await consultationApi.startTranscription(session.id)
      setSession(result.session)
      setRecordingBlob(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to upload/transcribe'
      setError(msg)
      setUploading(false)
      setTranscribing(false)
    }
  }

  // ----- Recording controls (fallback manual recording) -----
  const handleStartRecording = async () => {
    if (!session) return
    try {
      setError(null)
      const updated = await startConsultationRecordingFlow({
        startBrowserCapture: () => recorder.startRecording(),
        markRecordingStarted: () => consultationApi.startRecording(session.id),
        rollbackBrowserCapture: async () => {
          recorder.cancelRecording()
        },
      })
      setSession(updated)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start recording'
      setError(msg)
    }
  }

  const handleStopRecording = async () => {
    if (!session) return
    try {
      setError(null)
      recorder.stopRecording()
      await consultationApi.stopRecording(session.id)
      setSession((prev) => (prev ? { ...prev, status: 'ENDED', recordingStatus: 'STOPPED' } : prev))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to stop recording'
      setError(msg)
    }
  }

  // ----- Upload + Transcribe (manual recording) -----
  const handleUploadAndTranscribe = async () => {
    if (!session || !recorder.audioBlob) return
    try {
      setError(null)
      setUploading(true)
      const updated = await consultationApi.uploadRecording(session.id, recorder.audioBlob)
      setSession(updated)
      setUploading(false)

      setTranscribing(true)
      const result = await consultationApi.startTranscription(session.id)
      setSession(result.session)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to upload/transcribe'
      setError(msg)
      setUploading(false)
      setTranscribing(false)
    }
  }

  // ----- Convert to template -----
  const handleConvertToTemplate = async () => {
    if (!session) return
    try {
      setError(null)
      const result = await consultationApi.convertToTemplate(session.id)
      if (result.aiScribeSessionId) {
        const aiSession = await aiScribeApi.getSession(result.aiScribeSessionId)
        setAiScribeSession(aiSession)

        const draft = aiSession.aiDraft as Record<string, string> | null
        setDraftForm({
          subjective: draft?.subjective || '',
          objective: draft?.objective || '',
          assessment: draft?.assessment || '',
          plan: draft?.plan || '',
        })

        setShowDraftModal(true)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to convert to template'
      setError(msg)
    }
  }

  // ----- Load transcript -----
  const handleLoadTranscript = async () => {
    if (!session) return
    try {
      const data = await consultationApi.getTranscript(session.id)
      setTranscript(data)
    } catch {
      // ignore
    }
  }

  // ----- Draft editing -----
  const [approvingDraft, setApprovingDraft] = useState(false)
  const handleApproveDraft = async () => {
    if (!aiScribeSession) return
    try {
      setApprovingDraft(true)
      setError(null)
      await aiScribeApi.updateDraft(aiScribeSession.id, draftForm)
      const approved = await aiScribeApi.approveSession(aiScribeSession.id)
      // Auto-publish patient summary so patient sees it immediately
      await aiScribeApi.publishPatientSummary(aiScribeSession.id).catch(() => null)
      setAiScribeSession(approved)
      setShowDraftModal(false)
      await refreshSession()
      toast.success('Note approved and shared with patient')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to approve draft'
      setError(msg)
    } finally {
      setApprovingDraft(false)
    }
  }

  // ----- Render -----

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error && !session) {
    return (
      <PageContainer>
        <AppCard className="max-w-2xl mx-auto border-red-200">
          <AppCardContent className="p-8 text-center bg-red-50/50">
            <h2 className="text-lg font-semibold text-red-800 mb-2">Error</h2>
            <p className="text-red-700 mb-6">{error}</p>
            <AppButton variant="danger" onClick={() => router.back()}>
              Go Back
            </AppButton>
          </AppCardContent>
        </AppCard>
      </PageContainer>
    )
  }

  if (!session) return null

  const hasVideoRoom = videoActive && videoRoom

  const overallStatusLabel = videoActive
    ? 'Live call'
    : recorder.isRecording
      ? 'Recording'
      : session.consentStatus === 'PENDING'
        ? 'Awaiting consent'
        : session.recordingStatus === 'STORED'
          ? 'Awaiting transcription'
          : transcript?.aiScribeStatus === 'DRAFT_GENERATED'
            ? 'Draft ready'
            : 'Ready to start'

  return (
    <PageContainer className="space-y-8">
      {/* Hero header — gradient band with back + live status + start video */}
      <div className="relative overflow-clip rounded-3xl border border-[#E5E7EB] bg-gradient-to-br from-[#1E3A5F] via-[#23436B] to-[#0F766E] text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-10 -bottom-12 h-48 w-48 rounded-full bg-[#14B8A6]/25 blur-3xl"
        />
        <div className="relative flex flex-col gap-6 p-8 lg:p-10">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/70 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            {!videoActive && (
              <AppButton
                onClick={handleStartVideoCall}
                disabled={videoLoading}
                size="sm"
                className="rounded-full bg-white text-[#1E3A5F] shadow-sm hover:bg-white/90"
              >
                {videoLoading ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-[#1E3A5F]/30 border-t-[#1E3A5F]" />
                    Starting…
                  </>
                ) : (
                  <>
                    <Video className="mr-2 h-4 w-4" />
                    Start Video Call
                  </>
                )}
              </AppButton>
            )}
          </div>

          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80 backdrop-blur-sm">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    videoActive || recorder.isRecording
                      ? 'animate-pulse bg-[#14B8A6]'
                      : 'bg-[#14B8A6]'
                  )}
                />
                {overallStatusLabel}
              </div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Consultation Room</h1>
              <p className="max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
                {session.patient?.name ?? 'Patient'}
                {session.appointment?.startTime
                  ? ` · ${new Date(session.appointment.startTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
                  : ''}
              </p>
            </div>

            {/* Status strip */}
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
              {[
                { label: 'Consent', value: session.consentStatus },
                { label: 'Recording', value: session.recordingStatus },
                ...(transcript?.aiScribeStatus
                  ? [{ label: 'Scribe', value: transcript.aiScribeStatus }]
                  : []),
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/85"
                >
                  <span className="uppercase tracking-[0.14em] text-white/55">{s.label}</span>
                  <span className="text-white">{statusLabel(s.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3 mb-6">
          <span className="text-red-500 text-lg">⚠</span>
          <div>
            <p className="text-sm text-red-800">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-xs text-red-500 hover:text-red-700 underline mt-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Recorder error */}
      {recorder.error && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-amber-800">{recorder.error}</p>
        </div>
      )}

      {/* Main Layout — Video + Scribe side-by-side when video is active */}
      <div
        className={`grid gap-8 ${hasVideoRoom ? 'grid-cols-1 xl:grid-cols-5' : 'grid-cols-1 lg:grid-cols-3'}`}
      >
        {/* Left Column — Video + Recording Controls */}
        <div className={hasVideoRoom ? 'xl:col-span-3 space-y-6' : 'lg:col-span-2 space-y-6'}>
          {/* Jitsi Video Call — active while call is live */}
          {hasVideoRoom && (
            <JitsiVideoCall
              roomName={videoRoom.roomName}
              domain={videoRoom.domain}
              jwt={videoRoom.jwt}
              userName="Provider"
              onMeetingStarted={handleMeetingStarted}
              onCallEnded={handleCallEnded}
              className="w-full"
            />
          )}

          {/* Post-call processing state — replaces video area while transcribing */}
          {!videoActive && videoRoom && (uploading || transcribing) && (
            <AppCard className="overflow-hidden border border-amber-200 bg-gradient-to-br from-amber-50 to-white shadow-none">
              <AppCardContent className="flex flex-col items-center gap-4 py-12 text-center">
                <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
                  <div className="absolute inset-0 animate-ping rounded-full bg-amber-200 opacity-50" />
                  <Sparkles className="h-7 w-7 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-amber-900">
                    {uploading ? 'Uploading recording…' : 'AI Scribe is processing'}
                  </h3>
                  <p className="mt-1 text-sm text-amber-700/80">
                    {uploading
                      ? 'Sending audio to the server'
                      : 'Transcribing and generating your SOAP note draft — usually under a minute'}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-amber-600">
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                  <span>{uploading ? 'Uploading…' : 'Transcribing…'}</span>
                </div>
              </AppCardContent>
            </AppCard>
          )}

          {/* Inline SOAP draft — appears when draft is ready, replaces modal */}
          {!videoActive &&
            aiScribeSession &&
            (aiScribeSession.status === 'DRAFT_GENERATED' ||
              aiScribeSession.status === 'EDITED') && (
              <AppCard className="overflow-hidden border border-indigo-200 shadow-none">
                <AppCardHeader className="flex flex-row items-center justify-between border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-white py-5">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-sm">
                      <FileText className="h-4 w-4" />
                    </span>
                    <div>
                      <AppCardTitle className="text-base font-bold">SOAP Note Draft</AppCardTitle>
                      <p className="text-xs font-medium text-indigo-500">
                        AI-generated · Review and approve to share with patient
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-indigo-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                    Awaiting Approval
                  </span>
                </AppCardHeader>
                <AppCardContent className="space-y-4 p-6">
                  {(['subjective', 'objective', 'assessment', 'plan'] as const).map((field) => (
                    <div key={field} className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                        {field.charAt(0).toUpperCase() + field.slice(1)}
                      </label>
                      <Textarea
                        value={draftForm[field] || ''}
                        onChange={(e) =>
                          setDraftForm((prev) => ({ ...prev, [field]: e.target.value }))
                        }
                        className="min-h-[90px] resize-y rounded-xl border-slate-200 font-serif text-sm leading-relaxed focus:border-indigo-300 focus:ring-indigo-100"
                        placeholder={`Enter ${field} notes…`}
                      />
                    </div>
                  ))}

                  <div className="flex items-center gap-3 pt-2">
                    <AppButton
                      onClick={handleApproveDraft}
                      disabled={approvingDraft}
                      size="lg"
                      className="flex-1 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/20 hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-60"
                    >
                      {approvingDraft ? (
                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      {approvingDraft ? 'Approving…' : 'Approve & Share with Patient'}
                    </AppButton>
                  </div>
                  <p className="text-center text-xs text-slate-400">
                    Approving will immediately make a patient-friendly summary visible on the
                    patient&apos;s portal.
                  </p>
                </AppCardContent>
              </AppCard>
            )}

          {/* Approved confirmation */}
          {aiScribeSession?.status === 'APPROVED' && (
            <AppCard className="overflow-hidden border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white shadow-none">
              <AppCardContent className="flex items-center gap-4 p-6">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
                  <CheckCircle2 className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="font-bold text-emerald-900">Note approved and shared</h3>
                  <p className="mt-0.5 text-sm text-emerald-700/80">
                    The patient can now view their consultation summary on their portal.
                  </p>
                </div>
              </AppCardContent>
            </AppCard>
          )}

          {/* Consent Notice — only shown when patient hasn't opted in at booking */}
          {session.consentStatus === 'PENDING' && (
            <AppCard className="overflow-hidden border border-amber-200 bg-gradient-to-br from-amber-50 to-white shadow-none">
              <AppCardContent className="p-6 sm:p-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                    <Lock className="h-5 w-5" />
                  </span>
                  <div className="flex-1 space-y-2">
                    <h3 className="text-base font-bold text-amber-900">
                      Waiting for patient consent
                    </h3>
                    <p className="text-sm leading-relaxed text-amber-800/80">
                      Recording cannot start until the patient grants consent. Share the join link
                      below — once they open it and accept, you&apos;re clear to record.
                    </p>
                    {session.joinToken && (
                      <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-white p-3 sm:flex-row sm:items-center">
                        <code className="flex-1 truncate text-xs text-slate-700">
                          {typeof window !== 'undefined'
                            ? `${window.location.origin}/consultation/${session.joinToken}`
                            : ''}
                        </code>
                        <AppButton
                          size="sm"
                          variant="outline"
                          className="shrink-0 rounded-full border-amber-300 text-amber-800 hover:bg-amber-50"
                          onClick={() => {
                            const link = `${window.location.origin}/consultation/${session.joinToken}`
                            navigator.clipboard.writeText(link)
                            toast.success('Join link copied')
                          }}
                        >
                          <Copy className="mr-1.5 h-3.5 w-3.5" />
                          Copy
                        </AppButton>
                      </div>
                    )}
                  </div>
                </div>
              </AppCardContent>
            </AppCard>
          )}

          {/* AI Scribe — mission control */}
          <AppCard className="overflow-hidden border border-[#E5E7EB] shadow-none">
            <AppCardHeader className="flex flex-row items-center justify-between border-b border-[#E5E7EB] bg-gradient-to-r from-white via-[#F8FAFC] to-[#F0FDFA] py-5">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0D9488] to-[#14B8A6] text-white shadow-sm">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <AppCardTitle className="text-base font-bold">AI Scribe</AppCardTitle>
                  <p className="text-xs font-medium text-slate-500">
                    {recorder.isRecording
                      ? 'Recording in progress'
                      : uploading
                        ? 'Uploading audio…'
                        : transcribing
                          ? 'Transcribing…'
                          : recordingBlob || recorder.audioBlob
                            ? 'Ready to transcribe'
                            : session.consentStatus === 'GRANTED'
                              ? 'Ready to record'
                              : 'Consent required'}
                  </p>
                </div>
              </div>
              {recorder.isRecording && (
                <div className="inline-flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1.5 text-red-700 ring-1 ring-red-500/20">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                  </span>
                  <span className="font-mono text-sm font-bold tabular-nums">
                    {formatDuration(recorder.duration)}
                  </span>
                </div>
              )}
            </AppCardHeader>
            <AppCardContent className="space-y-4 p-6">
              {/* Primary action — always exactly one, sized big */}
              {recorder.isRecording ? (
                <AppButton
                  onClick={handleStopRecording}
                  size="lg"
                  className="w-full rounded-2xl bg-slate-900 text-white shadow-md hover:bg-slate-800"
                >
                  <Square className="mr-2 h-4 w-4 fill-current" />
                  Stop recording
                </AppButton>
              ) : recordingBlob && !uploading && !transcribing ? (
                <AppButton
                  onClick={handleUploadDailyRecording}
                  size="lg"
                  className="w-full rounded-2xl bg-gradient-to-r from-[#0D9488] to-[#14B8A6] text-white shadow-md shadow-[#14B8A6]/30 hover:from-[#0F766E] hover:to-[#0D9488]"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload &amp; transcribe call audio
                </AppButton>
              ) : recorder.audioBlob &&
                !uploading &&
                !transcribing &&
                session.recordingStatus !== 'STORED' ? (
                <AppButton
                  onClick={handleUploadAndTranscribe}
                  size="lg"
                  className="w-full rounded-2xl bg-gradient-to-r from-[#0D9488] to-[#14B8A6] text-white shadow-md shadow-[#14B8A6]/30 hover:from-[#0F766E] hover:to-[#0D9488]"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload &amp; transcribe
                </AppButton>
              ) : uploading ? (
                <div className="flex w-full items-center justify-center gap-3 rounded-2xl bg-blue-50 p-4 text-blue-700 ring-1 ring-blue-100">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                  <span className="text-sm font-semibold">Uploading audio…</span>
                </div>
              ) : transcribing ? (
                <div className="flex w-full items-center justify-center gap-3 rounded-2xl bg-amber-50 p-4 text-amber-700 ring-1 ring-amber-100">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                  <span className="text-sm font-semibold">Transcribing &amp; analysing…</span>
                </div>
              ) : !hasVideoRoom &&
                session.recordingStatus !== 'STOPPED' &&
                session.recordingStatus !== 'STORED' ? (
                <AppButton
                  onClick={handleStartRecording}
                  disabled={session.consentStatus !== 'GRANTED'}
                  size="lg"
                  className={cn(
                    'w-full rounded-2xl shadow-md',
                    session.consentStatus === 'GRANTED'
                      ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-red-500/30 hover:from-red-600 hover:to-red-700'
                      : 'bg-slate-200 text-slate-500'
                  )}
                >
                  <Mic className="mr-2 h-4 w-4" />
                  Start manual recording
                </AppButton>
              ) : null}

              {/* Hints — only when idle / pre-recording */}
              {hasVideoRoom &&
                !recordingBlob &&
                !recorder.isRecording &&
                !uploading &&
                !transcribing && (
                  <div className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 text-xs leading-relaxed text-emerald-900">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span>
                      AI Scribe starts recording the moment you enter the call and automatically
                      transcribes it when you leave. No button to press.
                    </span>
                  </div>
                )}
              {!hasVideoRoom &&
                !recorder.isRecording &&
                !recordingBlob &&
                session.recordingStatus !== 'STOPPED' &&
                session.recordingStatus !== 'STORED' &&
                !uploading &&
                !transcribing && (
                  <p className="text-xs leading-relaxed text-slate-500">
                    Start the video call above and AI Scribe kicks in automatically, or record
                    locally from your browser&apos;s mic as a fallback.
                  </p>
                )}

              {/* Secondary row — demo simulator + recording metadata */}
              <div className="flex flex-wrap items-center gap-3">
                {!recorder.isRecording &&
                  !uploading &&
                  !transcribing &&
                  aiScribeSession?.status === 'RECORDING' && (
                    <AppButton
                      onClick={handleSimulateClinicalConversation}
                      variant="outline"
                      size="sm"
                      className="rounded-full border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    >
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      Demo: simulate conversation
                    </AppButton>
                  )}
                {recorder.audioBlob && !recorder.isRecording && (
                  <p className="text-xs text-slate-500">
                    Recording complete ·{' '}
                    <span className="font-semibold text-slate-700">
                      {formatDuration(recorder.duration)}
                    </span>{' '}
                    · {(recorder.audioBlob.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                )}
                {recordingBlob && (
                  <p className="text-xs font-medium text-emerald-700">
                    Call audio captured · {(recordingBlob.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                )}
              </div>
            </AppCardContent>
          </AppCard>

          {/* Transcript */}
          {(transcript || session.aiScribeSessionId) && (
            <AppCard className="overflow-hidden border border-[#E5E7EB] shadow-none">
              <AppCardHeader className="flex flex-row items-center justify-between border-b border-[#E5E7EB] bg-gradient-to-r from-white via-[#F8FAFC] to-[#EEF2FF] py-5">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366F1] to-[#4C7DCC] text-white shadow-sm">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div>
                    <AppCardTitle className="text-base font-bold">
                      Consultation transcript
                    </AppCardTitle>
                    <p className="text-xs font-medium text-slate-500">
                      {transcript?.transcriptStatus === 'PROCESSING'
                        ? 'Transcribing…'
                        : transcript?.transcript
                          ? 'Complete'
                          : 'Waiting for audio'}
                    </p>
                  </div>
                </div>
                <AppButton
                  variant="ghost"
                  size="sm"
                  onClick={handleLoadTranscript}
                  className="rounded-full text-slate-600 hover:bg-slate-100"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Refresh
                </AppButton>
              </AppCardHeader>
              <AppCardContent className="space-y-4 p-6">
                {transcript?.transcript ? (
                  <div className="max-h-96 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50 p-5">
                    <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-slate-800">
                      {transcript.transcript}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
                    {transcript?.transcriptStatus === 'PROCESSING' ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#6366F1]/30 border-t-[#6366F1]" />
                        <span>Transcription in progress — this usually takes under a minute.</span>
                      </>
                    ) : (
                      <>
                        <FileText className="h-4 w-4 text-slate-400" />
                        <span>
                          No transcript yet. Record the consultation to populate this view.
                        </span>
                      </>
                    )}
                  </div>
                )}

                {/* Generate SOAP draft */}
                {transcript?.aiScribeStatus === 'DRAFT_GENERATED' && (
                  <AppButton
                    onClick={handleConvertToTemplate}
                    className="w-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30 hover:from-emerald-600 hover:to-emerald-700 sm:w-auto"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate SOAP note draft
                  </AppButton>
                )}

                {transcript?.errorMessage && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs text-red-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{transcript.errorMessage}</span>
                  </div>
                )}
              </AppCardContent>
            </AppCard>
          )}

          {/* Manual documentation fallback — opens the new modal rather than routing to a dead list page */}
          {session.status === 'FAILED' && (
            <AppCard className="overflow-hidden border border-amber-200 bg-gradient-to-br from-amber-50 to-white shadow-none">
              <AppCardContent className="p-6 sm:p-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                    <AlertTriangle className="h-5 w-5" />
                  </span>
                  <div className="flex-1 space-y-3">
                    <div>
                      <h3 className="text-base font-bold text-amber-900">
                        Transcription didn&apos;t finish
                      </h3>
                      <p className="mt-1 text-sm leading-relaxed text-amber-800/80">
                        No problem — you can still document the visit by typing the SOAP fields
                        directly. It&apos;s the same record, just no transcript attached.
                      </p>
                    </div>
                    <AppButton
                      onClick={() => setManualNoteOpen(true)}
                      className="rounded-full bg-gradient-to-r from-amber-600 to-amber-500 text-white shadow-md shadow-amber-500/30 hover:from-amber-700 hover:to-amber-600"
                    >
                      <PencilLine className="mr-2 h-4 w-4" />
                      Document manually
                    </AppButton>
                  </div>
                </div>
              </AppCardContent>
            </AppCard>
          )}
        </div>

        {/* Right Rail */}
        <div className={hasVideoRoom ? 'xl:col-span-2 space-y-6' : 'space-y-6'}>
          {/* Patient context */}
          <AppCard className="overflow-hidden border border-[#E5E7EB] shadow-none">
            <AppCardHeader className="border-b border-[#E5E7EB] bg-gradient-to-r from-white to-[#F8FAFC] py-4">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#F0FDFA] text-[#0D9488]">
                  <Activity className="h-4 w-4" />
                </span>
                <AppCardTitle className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
                  Patient Context
                </AppCardTitle>
              </div>
            </AppCardHeader>
            <AppCardContent className="space-y-3 p-5">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  Patient
                </label>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">
                  {session.patient?.name ?? 'Unknown'}
                </p>
                {session.patient?.email && (
                  <p className="text-xs text-slate-500">{session.patient.email}</p>
                )}
              </div>
              {session.provider && (
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    Provider
                  </label>
                  <p className="mt-0.5 text-sm text-slate-800">
                    Dr. {session.provider.firstName} {session.provider.lastName}
                  </p>
                </div>
              )}
              {session.appointment && (
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    Scheduled
                  </label>
                  <p className="mt-0.5 text-sm text-slate-800">
                    {new Date(session.appointment.startTime).toLocaleString('en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                </div>
              )}

              <div className="space-y-1.5 border-t border-slate-100 pt-4">
                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  Session state
                </label>
                {[
                  { key: 'consult', label: 'Consultation', value: session.status },
                  { key: 'record', label: 'Recording', value: session.recordingStatus },
                  { key: 'consent', label: 'Consent', value: session.consentStatus },
                  ...(videoActive ? [{ key: 'video', label: 'Video call', value: 'LIVE' }] : []),
                  ...(session.transcriptStatus && session.transcriptStatus !== 'NOT_STARTED'
                    ? [{ key: 'transcript', label: 'Transcript', value: session.transcriptStatus }]
                    : []),
                  ...(transcript?.aiScribeStatus
                    ? [{ key: 'scribe', label: 'AI Scribe', value: transcript.aiScribeStatus }]
                    : []),
                ].map((row) => (
                  <div key={row.key} className="flex items-center justify-between">
                    <span className="text-xs text-slate-600">{row.label}</span>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        statusColor(row.value)
                      )}
                    >
                      {statusLabel(row.value)}
                    </span>
                  </div>
                ))}
              </div>
            </AppCardContent>
          </AppCard>

          {/* Patient join link */}
          {session.joinToken && (
            <AppCard className="relative overflow-hidden border-none bg-gradient-to-br from-[#1E3A5F] via-[#23436B] to-[#0F766E] text-white shadow-card">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -bottom-6 -left-4 h-32 w-32 rounded-full bg-[#14B8A6]/25 blur-2xl"
              />
              <AppCardContent className="relative space-y-3 p-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">
                  <Video className="h-3 w-3" />
                  Patient join link
                </div>
                <p className="text-xs leading-relaxed text-white/70">
                  Send this to the patient — it opens their side of the consultation with no login
                  required.
                </p>
                <div className="rounded-xl border border-white/15 bg-white/10 p-3">
                  <code className="block break-all text-[11px] text-white/90 selection:bg-white/30">
                    {typeof window !== 'undefined'
                      ? `${window.location.origin}/consultation/${session.joinToken}`
                      : ''}
                  </code>
                </div>
                <AppButton
                  size="sm"
                  className="w-full rounded-full bg-white font-semibold text-[#1E3A5F] hover:bg-white/90"
                  onClick={() => {
                    const link = `${window.location.origin}/consultation/${session.joinToken}`
                    navigator.clipboard.writeText(link)
                    toast.success('Link copied to clipboard')
                  }}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copy join link
                </AppButton>
              </AppCardContent>
            </AppCard>
          )}

          {/* Recent vitals */}
          <AppCard className="overflow-hidden border border-[#E5E7EB] shadow-none">
            <AppCardHeader className="border-b border-[#E5E7EB] bg-gradient-to-r from-white to-[#FFFBEB] py-4">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#FFFBEB] text-[#F59E0B]">
                  <Activity className="h-4 w-4" />
                </span>
                <AppCardTitle className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
                  Recent Vitals
                </AppCardTitle>
              </div>
            </AppCardHeader>
            <AppCardContent className="p-5">
              <p className="text-xs italic text-slate-400">
                No recent vitals recorded for this patient.
              </p>
            </AppCardContent>
          </AppCard>
        </div>
      </div>

      {/* Manual documentation modal — same as the appointment-detail page's */}
      <ManualNoteModal
        open={manualNoteOpen}
        onOpenChange={setManualNoteOpen}
        appointmentId={appointmentId}
        patientId={session.patient?.id ?? ''}
      />

      {/* Draft Modal */}
      <AppModal
        open={showDraftModal && aiScribeSession !== null}
        onOpenChange={setShowDraftModal}
        title="SOAP Note Draft"
        description="This draft was generated by the AI Scribe. Please review and make any necessary edits before finalizing."
        primaryAction={{ label: 'Approve & Finalize', onClick: handleApproveDraft }}
        secondaryAction={{ label: 'Cancel', onClick: () => setShowDraftModal(false) }}
        className="max-w-2xl"
        content={
          <div className="space-y-5 mt-2">
            {['subjective', 'objective', 'assessment', 'plan'].map((field) => (
              <AppFormField key={field} label={field.charAt(0).toUpperCase() + field.slice(1)}>
                <Textarea
                  value={draftForm[field as keyof typeof draftForm] || ''}
                  onChange={(e) => setDraftForm((prev) => ({ ...prev, [field]: e.target.value }))}
                  className="min-h-[100px] resize-y font-serif text-sm"
                  placeholder={`Enter ${field} notes...`}
                />
              </AppFormField>
            ))}
          </div>
        }
      />
    </PageContainer>
  )
}
