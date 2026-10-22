'use client'

import React, { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Mic,
  MicOff,
  Upload,
  RotateCcw,
  Save,
  CheckCircle,
  Loader2,
  Share2,
  ArrowLeft,
  FileText,
  Activity,
  History as HistoryIcon,
  Sparkles,
  AlertCircle,
} from 'lucide-react'
import {
  getSessionByVisitRecord,
  startSession,
  uploadAudio,
  getSession,
  processSession,
  updateDraft,
  regenerateDraft,
  approveSession,
  publishPatientSummary,
  simulateSession,
  type AIScribeSession,
  type SoapDraft,
} from '@/lib/aiScribeApi'
import { getVisitWithHistory } from '@/lib/patientApi'
import {
  AppCard,
  AppCardHeader,
  AppCardTitle,
  AppCardContent,
  AppButton,
  AppBadge,
  AppPageHeader,
  AppFormField,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { ClinicalTimelineCard } from '@/components/aiScribe/ClinicalTimelineCard'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppToast } from '@/hooks/useAppToast'
import { useAuth } from '@/contexts/AuthContext'
import { NoteHistoryModal } from '@/components/visit/NoteHistoryModal'
import { cn } from '@/lib/utils'
import {
  DetectedProductsPanel,
  rxApproval,
  type RxSelection,
} from '@/components/rxCart/DetectedProductsPanel'

const STATUS_BADGES: Record<
  string,
  { label: string; variant: 'destructive' | 'warning' | 'accent' | 'outline' | 'success' }
> = {
  RECORDING: { label: 'Live Recording', variant: 'destructive' },
  TRANSCRIBING: { label: 'AI Processing...', variant: 'warning' },
  DRAFT_GENERATED: { label: 'Draft Ready', variant: 'accent' },
  EDITED: { label: 'Draft Edited', variant: 'outline' },
  APPROVED: { label: 'Approved', variant: 'success' },
  FAILED: { label: 'AI Error', variant: 'destructive' },
}

function SoapEditor({
  draft,
  onChange,
  onSave,
  onRegenerate,
  onApprove,
  onShowHistory,
  isSaving,
  isRegenerating,
  isApproving,
  canEdit,
  products,
  approveBlockedReason,
}: {
  draft: SoapDraft
  onChange: (draft: SoapDraft) => void
  onSave: () => void
  onRegenerate: () => void
  onApprove: () => void
  onShowHistory: () => void
  isSaving: boolean
  isRegenerating: boolean
  isApproving: boolean
  canEdit: boolean
  /** F5.1: the detected-products panel, confirmed before "Approve & send". */
  products?: React.ReactNode
  approveBlockedReason?: string | null
}) {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary-600" />
          <h2 className="text-xl font-bold text-slate-900">SOAP Note Editor</h2>
        </div>
        <AppButton
          variant="ghost"
          size="sm"
          onClick={onShowHistory}
          className="rounded-full text-slate-500 hover:text-slate-900"
        >
          <HistoryIcon className="mr-2 h-4 w-4" />
          Version History
        </AppButton>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {(['subjective', 'objective', 'assessment', 'plan'] as const).map((field) => (
          <AppFormField
            key={field}
            label={field.charAt(0).toUpperCase() + field.slice(1)}
            className="w-full"
          >
            <Textarea
              className={cn(
                'min-h-[180px] rounded-[12px] border-slate-200 bg-white text-slate-900 placeholder:text-muted',
                'focus-visible:ring-accent/20 focus-visible:border-accent transition-all text-sm leading-relaxed p-6'
              )}
              value={draft[field] || ''}
              onChange={(e) => onChange({ ...draft, [field]: e.target.value })}
              placeholder={`Clinical ${field} notes...`}
              disabled={!canEdit}
            />
          </AppFormField>
        ))}
      </div>

      {products}

      <div className="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-slate-100">
        <div className="flex gap-3">
          {canEdit && (
            <>
              <AppButton
                variant="outline"
                className="rounded-full bg-white px-6"
                onClick={onRegenerate}
                disabled={isRegenerating}
              >
                {isRegenerating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Regenerate AI Draft
              </AppButton>
              <AppButton
                variant="outline"
                className="rounded-full bg-white px-6"
                onClick={onSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Changes
              </AppButton>
            </>
          )}
        </div>

        <AppButton
          size="lg"
          className="rounded-full px-10 shadow-lg shadow-primary-100 font-bold"
          onClick={onApprove}
          disabled={isApproving || !canEdit || !!approveBlockedReason}
          title={approveBlockedReason ?? undefined}
        >
          {isApproving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle className="mr-2 h-4 w-4" />
          )}
          Approve & send
        </AppButton>
      </div>
      {canEdit && approveBlockedReason && (
        <p className="text-right text-xs font-medium text-amber-700">{approveBlockedReason}</p>
      )}
    </div>
  )
}

function ProviderAIScribePageContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()
  const visitRecordId = params.id as string
  const appointmentId = searchParams.get('appointmentId')
  const toast = useAppToast()

  const queryClient = useQueryClient()
  const [localDraft, setLocalDraft] = useState<SoapDraft | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [audioInputRef, setAudioInputRef] = useState<HTMLInputElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [isRecordingLocal, setIsRecordingLocal] = useState(false)

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ['ai-scribe', 'session', visitRecordId],
    queryFn: () => getSessionByVisitRecord(visitRecordId),
    enabled: !!visitRecordId,
    refetchOnMount: 'always',
    refetchInterval: (query) => {
      const s = query.state.data as AIScribeSession | undefined
      if (s?.status === 'TRANSCRIBING') return 3000
      return false
    },
  })

  const { data: visitWithHistory } = useQuery({
    queryKey: ['visit-history', visitRecordId],
    queryFn: () => getVisitWithHistory(visitRecordId),
    enabled: !!visitRecordId && showHistory,
  })

  const startSessionMutation = useMutation({
    mutationFn: () => startSession(visitRecordId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-scribe', 'session', visitRecordId] })
      toast.success('Session started')
    },
  })

  const uploadMutation = useMutation({
    mutationFn: ({ sessionId, file }: { sessionId: string; file: File }) =>
      uploadAudio(sessionId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-scribe', 'session', visitRecordId] })
      toast.success('Audio uploaded, AI processing started')
    },
  })

  const saveDraftMutation = useMutation({
    mutationFn: ({ sessionId, draft }: { sessionId: string; draft: SoapDraft }) =>
      updateDraft(sessionId, draft),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-scribe', 'session', visitRecordId] })
      toast.success('Draft saved')
    },
  })

  const regenerateMutation = useMutation({
    mutationFn: (sessionId: string) => regenerateDraft(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-scribe', 'session', visitRecordId] })
      toast.success('Regenerating AI draft...')
    },
  })

  const [rxSelection, setRxSelection] = useState<RxSelection | null>(null)
  const approval = rxApproval(rxSelection)

  const approveMutation = useMutation({
    // "Approve & send": save the edited note, then approve it together with
    // the products the provider confirmed (F5.1).
    mutationFn: async ({ sessionId, draft }: { sessionId: string; draft: SoapDraft }) => {
      if (!approval.ok) throw new Error(approval.reason)
      await updateDraft(sessionId, draft)
      return approveSession(sessionId, approval.rxConfirmation)
    },
    onSuccess: (approved) => {
      queryClient.invalidateQueries({ queryKey: ['ai-scribe', 'session', visitRecordId] })
      queryClient.invalidateQueries({ queryKey: ['rx-cart', 'proposal'] })
      const sent = approved.rxCart?.cartItemIds.length ?? 0
      toast.success(
        sent > 0
          ? `Note approved · ${sent} product${sent > 1 ? 's' : ''} sent to the patient's cart`
          : 'Note approved and finalized'
      )
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err instanceof Error ? err.message : 'Could not approve the note')
      toast.error(message)
    },
  })

  const simulateMutation = useMutation({
    mutationFn: (sessionId: string) => simulateSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-scribe', 'session', visitRecordId] })
      toast.success('Clinical conversation simulated')
    },
  })

  const publishMutation = useMutation({
    mutationFn: (sessionId: string) => publishPatientSummary(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-scribe', 'session', visitRecordId] })
      toast.success('Summary shared with patient')
    },
  })

  const handleStartRecording = useCallback(async () => {
    if (!session) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        setIsRecordingLocal(false)
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const file = new File([blob], 'recording.webm', { type: 'audio/webm' })
        uploadMutation.mutate({ sessionId: session.id, file })
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecordingLocal(true)
    } catch {
      toast.error('Microphone access denied')
    }
  }, [session, uploadMutation, toast])

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const draft = localDraft ??
    session?.aiDraft ?? { subjective: '', objective: '', assessment: '', plan: '' }
  const canEdit = session?.status === 'DRAFT_GENERATED' || session?.status === 'EDITED'
  const isProcessing = session?.status === 'TRANSCRIBING'

  React.useEffect(() => {
    if (session?.aiDraft) setLocalDraft(session.aiDraft)
  }, [session?.aiDraft])

  if (sessionLoading && !session) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="bg-slate-50 min-h-screen">
      <div className="px-8 py-6 bg-white border-b sticky top-0 z-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <AppButton
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
              className="rounded-full"
            >
              <ArrowLeft className="h-5 w-5" />
            </AppButton>
            <div>
              <h1 className="text-2xl font-black text-slate-900">AI Scribe Console</h1>
              <p className="text-sm text-slate-500 font-medium">Documentation Assistant</p>
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

      <PageContainer className="py-8 max-w-6xl">
        {!session ? (
          <AppCard className="border-none shadow-sm p-12 text-center space-y-6">
            <div className="w-20 h-20 bg-primary-50 rounded-full flex items-center justify-center mx-auto text-primary-600">
              <Sparkles className="h-10 w-10" />
            </div>
            <div className="max-w-md mx-auto space-y-2">
              <h2 className="text-2xl font-bold text-slate-900">Initialize Documentation</h2>
              <p className="text-slate-500">
                Prepare the AI pipeline for this consultation. You can record live or upload an
                existing audio file.
              </p>
            </div>
            <AppButton
              size="lg"
              className="rounded-full px-10 shadow-xl"
              onClick={() => startSessionMutation.mutate()}
              disabled={startSessionMutation.isPending}
            >
              Start Documentation Session
            </AppButton>
          </AppCard>
        ) : (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Action Bar */}
            <AppCard className="border-none shadow-sm overflow-hidden bg-white">
              <AppCardContent className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    {session.status === 'RECORDING' && (
                      <div className="flex items-center gap-3">
                        {!isRecordingLocal ? (
                          <AppButton
                            variant="destructive"
                            className="rounded-full px-6 animate-pulse"
                            onClick={handleStartRecording}
                          >
                            <Mic className="mr-2 h-4 w-4" /> Start Recording
                          </AppButton>
                        ) : (
                          <AppButton
                            variant="outline"
                            className="rounded-full px-6 border-rose-200 text-rose-600 hover:bg-rose-50"
                            onClick={handleStopRecording}
                          >
                            <MicOff className="mr-2 h-4 w-4" /> Stop & Process
                          </AppButton>
                        )}
                      </div>
                    )}

                    {(session.status === 'RECORDING' || isProcessing) && (
                      <div className="flex items-center gap-4">
                        <input
                          ref={setAudioInputRef}
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) uploadMutation.mutate({ sessionId: session.id, file })
                          }}
                        />
                        <AppButton
                          variant="ghost"
                          className="rounded-full text-slate-500"
                          onClick={() => audioInputRef?.click()}
                          disabled={isProcessing}
                        >
                          <Upload className="mr-2 h-4 w-4" /> Upload File Instead
                        </AppButton>
                        {session.status === 'RECORDING' && (
                          <AppButton
                            variant="outline"
                            className="rounded-full"
                            onClick={() => simulateMutation.mutate(session.id)}
                            disabled={simulateMutation.isPending}
                          >
                            <Sparkles className="mr-2 h-4 w-4" /> Demo: simulate conversation
                          </AppButton>
                        )}
                      </div>
                    )}
                  </div>

                  {isProcessing && (
                    <div className="flex items-center gap-3 text-primary-600 font-bold text-sm">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      AI is analyzing the conversation...
                    </div>
                  )}
                </div>
              </AppCardContent>
            </AppCard>

            {/* Transcript & Editor Main Flow */}
            <div className="grid gap-8 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-8">
                {(session.status === 'DRAFT_GENERATED' ||
                  session.status === 'EDITED' ||
                  session.status === 'APPROVED') && (
                  <AppCard className="border-none shadow-xl rounded-[2.5rem] overflow-hidden bg-white">
                    <AppCardContent className="p-10">
                      <SoapEditor
                        draft={draft}
                        onChange={setLocalDraft}
                        onSave={() => saveDraftMutation.mutate({ sessionId: session.id, draft })}
                        onRegenerate={() => regenerateMutation.mutate(session.id)}
                        onApprove={() => approveMutation.mutate({ sessionId: session.id, draft })}
                        onShowHistory={() => setShowHistory(true)}
                        isSaving={saveDraftMutation.isPending}
                        isRegenerating={regenerateMutation.isPending}
                        isApproving={approveMutation.isPending}
                        canEdit={canEdit && !session.visitRecord?.isFinalized}
                        approveBlockedReason={approval.ok ? null : approval.reason}
                        products={
                          <DetectedProductsPanel
                            sessionId={session.id}
                            disabled={approveMutation.isPending}
                            onSelectionChange={setRxSelection}
                          />
                        }
                      />
                    </AppCardContent>
                  </AppCard>
                )}

                {session.status === 'APPROVED' && session.patientSummary && (
                  <AppCard className="border-none shadow-md bg-emerald-600 text-white rounded-3xl overflow-hidden">
                    <AppCardContent className="p-10 flex items-center justify-between gap-8">
                      <div className="space-y-2">
                        <h3 className="text-xl font-bold flex items-center gap-2">
                          <CheckCircle className="h-6 w-6" /> Patient Summary Ready
                        </h3>
                        <p className="text-emerald-100 text-sm">
                          A patient-friendly summary has been generated based on your finalized
                          notes.
                        </p>
                      </div>
                      {!session.patientSummaryPublished ? (
                        <AppButton
                          className="bg-white text-emerald-700 hover:bg-emerald-50 rounded-full px-8 shrink-0 font-bold"
                          onClick={() => publishMutation.mutate(session.id)}
                          disabled={publishMutation.isPending}
                        >
                          {publishMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Share2 className="h-4 w-4 mr-2" />
                          )}
                          Publish to Patient
                        </AppButton>
                      ) : (
                        <div className="bg-emerald-500/50 px-6 py-2 rounded-full text-sm font-bold border border-white/20">
                          Published
                        </div>
                      )}
                    </AppCardContent>
                  </AppCard>
                )}
              </div>

              <div className="space-y-8">
                {session.transcript && (
                  <AppCard className="border-none shadow-sm overflow-hidden bg-white">
                    <AppCardHeader className="bg-slate-50/50 border-b-0 py-4 px-6 flex flex-row items-center justify-between">
                      <AppCardTitle className="text-sm font-black uppercase tracking-widest text-slate-400">
                        Transcript
                      </AppCardTitle>
                      <AppBadge variant="outline" className="text-[10px] uppercase font-black">
                        AI High Confidence
                      </AppBadge>
                    </AppCardHeader>
                    <AppCardContent className="p-0">
                      <ScrollArea className="h-[400px] w-full p-6">
                        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap italic">
                          "{session.transcript}"
                        </p>
                      </ScrollArea>
                    </AppCardContent>
                  </AppCard>
                )}

                {session.timeline && <ClinicalTimelineCard timeline={session.timeline} />}
              </div>
            </div>
          </div>
        )}
      </PageContainer>

      <NoteHistoryModal
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        versions={visitWithHistory?.versions || []}
      />
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
