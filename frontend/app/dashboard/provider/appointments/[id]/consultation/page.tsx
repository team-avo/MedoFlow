'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import * as consultationApi from '@/lib/consultationApi'
import * as aiScribeApi from '@/lib/aiScribeApi'
import { createVisitRecord, getVisitByAppointment } from '@/lib/patientApi'
import { apiErrorOf } from '@/lib/apiError'
import { startConsultationRecordingFlow } from '@/lib/consultationRecordingFlow'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { useAppToast } from '@/hooks/useAppToast'
import { useScribeCapabilities, useScribeSession } from '@/hooks/useScribeSession'
import { JitsiVideoCall } from '@/components/consultation/JitsiVideoCall'
import { ScribeWorkspace } from '@/components/aiScribe/ScribeWorkspace'

// UI System Components
import { PageContainer } from '@/components/layout/PageContainer'
import {
  AppCard,
  AppCardHeader,
  AppCardTitle,
  AppCardContent,
} from '@/components/ui-system/AppCard'
import { AppButton } from '@/components/ui-system/AppButton'
import { ManualNoteModal } from '@/components/visit/ManualNoteModal'
import {
  ArrowLeft,
  Video,
  Mic,
  Square,
  Sparkles,
  Upload,
  Copy,
  Lock,
  Activity,
  AlertTriangle,
  PencilLine,
  ShieldX,
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
  const [manualNoteOpen, setManualNoteOpen] = useState(false)
  // A demo session (synthetic conversation) when no recording fed the scribe.
  const [demoSessionId, setDemoSessionId] = useState<string | null>(null)
  const [simulating, setSimulating] = useState(false)
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

  const recorder = useAudioRecorder()
  const toast = useAppToast()
  const { data: caps } = useScribeCapabilities()

  // The AI scribe session behind this consultation: everything after the
  // recording is the shared review core (F2.1).
  const scribeSessionId = session?.aiScribeSessionId ?? demoSessionId
  const scribe = useScribeSession({ by: 'id', sessionId: scribeSessionId })
  const scribeStatus = scribe.session?.status

  const showError = useCallback((err: unknown) => setError(apiErrorOf(err).message), [])

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
      showError(err)
    } finally {
      setLoading(false)
    }
  }, [appointmentId, showError])

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

  // ----- Poll for the patient's consent decision -----
  useEffect(() => {
    if (!sessionId || consentStatus === 'GRANTED' || consentStatus === 'DECLINED') return

    const poll = setInterval(() => {
      refreshSession()
    }, 3000)

    return () => clearInterval(poll)
  }, [sessionId, consentStatus, refreshSession])

  // ----- The consultation follows the scribe (TRANSCRIPT_READY / FAILED) -----
  useEffect(() => {
    if (scribeStatus && scribeStatus !== 'TRANSCRIBING' && scribeStatus !== 'RECORDING') {
      setTranscribing(false)
      void refreshSession()
    }
  }, [scribeStatus, refreshSession])

  // ----- Upload + transcribe a finished recording -----
  const uploadAndTranscribe = useCallback(
    async (blob: Blob) => {
      if (!session) return
      try {
        setError(null)
        setUploading(true)
        const uploaded = await consultationApi.uploadRecording(session.id, blob)
        setSession(uploaded)
        setUploading(false)

        setTranscribing(true)
        const result = await consultationApi.startTranscription(session.id)
        setSession(result.session)
        scribe.restartPolling()
      } catch (err: unknown) {
        showError(err)
        setTranscribing(false)
        await refreshSession()
      } finally {
        setUploading(false)
      }
    },
    [session, scribe, showError, refreshSession]
  )

  // ----- Auto-upload the captured blob when the call ends -----
  // `autoUploadPending` is flipped on by `handleCallEnded`; we wait here
  // for MediaRecorder's async onstop to populate `recorder.audioBlob` and
  // then kick the upload → transcription chain without any user click.
  useEffect(() => {
    if (!autoUploadPending || !recorder.audioBlob || !session) return

    const blob = recorder.audioBlob
    setAutoUploadPending(false)

    void (async () => {
      // Let the backend know recording is done (best-effort).
      await consultationApi.stopRecording(session.id).catch(() => null)
      toast.success('Transcribing the call — hold tight')
      await uploadAndTranscribe(blob)
    })()
  }, [autoUploadPending, recorder.audioBlob, session, toast, uploadAndTranscribe])

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
      showError(err)
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
    if (caps && !caps.available) return
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
      // A microphone problem is shown by recorder.error; anything else here.
      if (!recorder.error) showError(err)
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
      // A microphone problem is shown by recorder.error; anything else here.
      if (!recorder.error) showError(err)
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
      showError(err)
    }
  }

  // ----- Upload + Transcribe (manual recording) -----
  const handleUploadAndTranscribe = async () => {
    if (recorder.audioBlob) await uploadAndTranscribe(recorder.audioBlob)
  }

  // ----- Demo: a synthetic conversation, when the server allows it -----
  const handleSimulate = async () => {
    if (!session) return
    try {
      setSimulating(true)
      setError(null)
      const existing = await getVisitByAppointment(appointmentId)
      const visit =
        existing?.visitRecord ??
        (await createVisitRecord(appointmentId, { patientId: session.patientId }))
      const started = await aiScribeApi.startSession(visit.id)
      const simulated = await aiScribeApi.simulateSession(started.id)
      setDemoSessionId(started.id)
      scribe.setSession({ ...started, ...simulated })
      toast.success('Demo conversation loaded (synthetic)')
    } catch (err: unknown) {
      showError(err)
    } finally {
      setSimulating(false)
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
        : session.consentStatus === 'DECLINED'
          ? 'Consent declined'
          : scribeStatus === 'APPROVED'
            ? 'Approved'
            : scribeStatus === 'DRAFT_GENERATED' || scribeStatus === 'EDITED'
              ? 'Draft ready'
              : scribeStatus === 'TRANSCRIBING' || session.recordingStatus === 'STORED'
                ? 'AI drafting'
                : 'Ready to start'

  return (
    <PageContainer className="space-y-8">
      {/* Hero header — gradient band with back + live status + start video */}
      <div className="relative overflow-clip rounded-3xl border border-[#E5E7EB] bg-gradient-to-br from-[#1E3A5F] via-[#23436B] to-[#0F766E] text-white">
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
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
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
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-white/10 p-3">
              {[
                { label: 'Consent', value: session.consentStatus },
                { label: 'Recording', value: session.recordingStatus },
                ...(scribeStatus ? [{ label: 'Scribe', value: scribeStatus }] : []),
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
                  <div className="absolute inset-0 rounded-full bg-amber-200 opacity-50" />
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

          {/* Consent declined — no recording for this visit */}
          {session.consentStatus === 'DECLINED' && (
            <AppCard className="overflow-hidden border border-rose-200 bg-gradient-to-br from-rose-50 to-white shadow-none">
              <AppCardContent className="p-6 sm:p-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700">
                    <ShieldX className="h-5 w-5" />
                  </span>
                  <div className="flex-1 space-y-3">
                    <div>
                      <h3 className="text-base font-bold text-rose-900">
                        The patient declined AI recording
                      </h3>
                      <p className="mt-1 text-sm leading-relaxed text-rose-800/80">
                        This consultation will not be recorded or sent to the AI. Document the visit
                        manually.
                      </p>
                    </div>
                    <AppButton
                      onClick={() => setManualNoteOpen(true)}
                      variant="outline"
                      className="rounded-full"
                    >
                      <PencilLine className="mr-2 h-4 w-4" />
                      Write note manually
                    </AppButton>
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
                          : recorder.audioBlob
                            ? 'Ready to transcribe'
                            : caps && !caps.available
                              ? 'Not set up on this server'
                              : session.consentStatus === 'GRANTED'
                                ? 'Ready to record'
                                : session.consentStatus === 'DECLINED'
                                  ? 'Consent declined'
                                  : 'Consent required'}
                  </p>
                </div>
              </div>
              {recorder.isRecording && (
                <div className="inline-flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1.5 text-red-700 ring-1 ring-red-500/20">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60" />
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
                  disabled={session.consentStatus !== 'GRANTED' || Boolean(caps && !caps.available)}
                  size="lg"
                  className={cn(
                    'w-full rounded-2xl shadow-md',
                    session.consentStatus === 'GRANTED' && caps?.available !== false
                      ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-red-500/30 hover:from-red-600 hover:to-red-700'
                      : 'bg-slate-200 text-slate-500'
                  )}
                >
                  <Mic className="mr-2 h-4 w-4" />
                  Start manual recording
                </AppButton>
              ) : null}

              {/* Hints — only when idle / pre-recording */}
              {hasVideoRoom && !recorder.isRecording && !uploading && !transcribing && (
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
                session.recordingStatus !== 'STOPPED' &&
                session.recordingStatus !== 'STORED' &&
                !uploading &&
                !transcribing && (
                  <p className="text-xs leading-relaxed text-slate-500">
                    Start the video call above and AI Scribe kicks in automatically, or record
                    locally from your browser&apos;s mic as a fallback.
                  </p>
                )}

              {caps && !caps.available && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  The AI scribe is not set up on this server, so the call cannot be transcribed.
                  Document the visit manually.
                </p>
              )}

              {/* Secondary row — demo simulator + recording metadata */}
              <div className="flex flex-wrap items-center gap-3">
                {caps?.demoEnabled &&
                  !scribeSessionId &&
                  !recorder.isRecording &&
                  !uploading &&
                  !transcribing && (
                    <AppButton
                      onClick={handleSimulate}
                      disabled={simulating}
                      variant="outline"
                      size="sm"
                      className="rounded-full border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    >
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      {simulating ? 'Loading demo…' : 'Demo: simulate conversation'}
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
              </div>
            </AppCardContent>
          </AppCard>

          {/* Manual documentation fallback — opens the new modal rather than routing to a dead list page */}
          {session.status === 'FAILED' && !scribe.session && (
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
                  ...(scribeStatus
                    ? [{ key: 'scribe', label: 'AI Scribe', value: scribeStatus }]
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
        </div>
      </div>

      {/* Everything after the recording: the shared review core (F2.1) */}
      {scribeSessionId && (
        <ScribeWorkspace scribe={scribe} onManual={() => setManualNoteOpen(true)} />
      )}

      {/* Manual documentation modal — same as the appointment-detail page's */}
      <ManualNoteModal
        open={manualNoteOpen}
        onOpenChange={setManualNoteOpen}
        appointmentId={appointmentId}
        patientId={session.patient?.id ?? ''}
      />
    </PageContainer>
  )
}
