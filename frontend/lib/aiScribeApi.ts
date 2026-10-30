import api from './api'
import type { RxCartResult, RxConfirmation } from './rxCartApi'

export type AIScribeStatus =
  | 'RECORDING'
  | 'TRANSCRIBING'
  | 'DRAFT_GENERATED'
  | 'EDITED'
  | 'APPROVED'
  | 'FAILED'

export interface SoapDraft {
  subjective: string
  objective: string
  assessment: string
  plan: string
}

export interface PatientSummary {
  diagnosis: string
  treatmentPlan: string
  nextSteps: string
}

export const EMPTY_SOAP: SoapDraft = { subjective: '', objective: '', assessment: '', plan: '' }
export const EMPTY_SUMMARY: PatientSummary = { diagnosis: '', treatmentPlan: '', nextSteps: '' }

export interface ClinicalTimeline {
  symptoms: string[]
  duration: string | null
  assessment: string | null
  plan: string[]
  /** FR-7: what changed since the last approved visit. */
  continuity?: string | null
}

/** FR-1: whether this visit may be recorded. */
export interface ConsentState {
  status: 'GRANTED' | 'DECLINED' | 'PENDING'
  source: 'BOOKING' | 'PATIENT_CONSULTATION' | 'PROVIDER_ATTESTED_VERBAL' | null
}

export interface AIScribeSession {
  id: string
  visitRecordId: string
  providerId: string
  clinicId: string
  audioUrl: string | null
  transcript: string | null
  timeline: ClinicalTimeline | null
  aiDraft: SoapDraft | null
  /** The patient-facing summary: a draft until approved and published. */
  patientSummary: PatientSummary | null
  status: AIScribeStatus
  patientSummaryPublished?: boolean
  aiModel?: string | null
  /** Which AI wrote the draft (provenance), e.g. "openai-compatible:openai@api.openai.com". */
  aiProvider?: string | null
  sttModel?: string | null
  /** A safe, fixed text (never provider output). */
  errorMessage?: string | null
  processingStartedAt?: string | null
  processingCompletedAt?: string | null
  consent?: ConsentState
  createdAt: string
  updatedAt: string
  visitRecord?: {
    id: string
    appointmentId: string
    patientId?: string
    isFinalized?: boolean
    currentVersion?: unknown
  }
}

/** What the server's scribe can do. No hosts, URLs or keys. */
export interface ScribeCapabilities {
  available: boolean
  transcriptionAvailable: boolean
  draftingAvailable: boolean
  demoEnabled: boolean
  llm: { kind: string; preset: string; model: string; location: string }
  stt: { kind: string; preset: string; model: string; location: string }
}

export interface LongitudinalVisit {
  visitRecordId: string
  date: string
  assessment: string | null
  plan: string | null
  products: Array<{ name: string; dose: string | null; quantity: number }>
}

type SessionResponse = { success: boolean; data: { session: AIScribeSession } }

export const getCapabilities = async (): Promise<ScribeCapabilities> => {
  const { data } = await api.get<{ success: boolean; data: { capabilities: ScribeCapabilities } }>(
    '/ai-scribe/capabilities'
  )
  return data.data.capabilities
}

export const startSession = async (
  visitRecordId: string,
  clinicId?: string
): Promise<AIScribeSession> => {
  const { data } = await api.post<SessionResponse>('/ai-scribe/session/start', {
    visitRecordId,
    clinicId,
  })
  return data.data.session
}

/** The provider attests the patient gave verbal consent (in-person visits). */
export const attestVerbalConsent = async (sessionId: string): Promise<AIScribeSession> => {
  const { data } = await api.post<SessionResponse>(`/ai-scribe/session/${sessionId}/consent`, {
    method: 'VERBAL',
    acknowledged: true,
  })
  return data.data.session
}

export const getSessionStatus = async (
  sessionId: string,
  clinicId?: string
): Promise<{
  status: AIScribeStatus
  processingStartedAt?: string | null
  processingCompletedAt?: string | null
  processingDuration?: number | null
  errorMessage?: string | null
}> => {
  const params = clinicId ? `?clinicId=${clinicId}` : ''
  const { data } = await api.get<{
    success: boolean
    data: {
      status: AIScribeStatus
      processingStartedAt?: string | null
      processingCompletedAt?: string | null
      processingDuration?: number | null
      errorMessage?: string | null
    }
  }>(`/ai-scribe/session/${sessionId}/status${params}`)
  return data.data
}

export const getSession = async (
  sessionId: string,
  clinicId?: string
): Promise<AIScribeSession> => {
  const params = clinicId ? `?clinicId=${clinicId}` : ''
  const { data } = await api.get<SessionResponse>(`/ai-scribe/session/${sessionId}${params}`)
  return data.data.session
}

/** The visit's scribe session, or null when there is none yet. Other errors are thrown. */
export const getSessionByVisitRecord = async (
  visitRecordId: string,
  clinicId?: string
): Promise<AIScribeSession | null> => {
  const params = clinicId ? `?clinicId=${clinicId}` : ''
  const { data } = await api.get<{ success: boolean; data: { session: AIScribeSession | null } }>(
    `/ai-scribe/session/visit/${visitRecordId}${params}`
  )
  return data.data.session ?? null
}

export const uploadAudio = async (
  sessionId: string,
  file: File,
  onProgress?: (fraction: number) => void
): Promise<AIScribeSession> => {
  const formData = new FormData()
  formData.append('audio', file)
  const { data } = await api.post<SessionResponse>(
    `/ai-scribe/session/${sessionId}/audio`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.min(1, e.loaded / e.total))
      },
    }
  )
  return data.data.session
}

/** Retries processing the stored audio (after a failure). */
export const processSession = async (sessionId: string): Promise<AIScribeSession> => {
  const { data } = await api.post<SessionResponse>(`/ai-scribe/session/${sessionId}/process`, {})
  return data.data.session
}

export const simulateSession = async (sessionId: string): Promise<AIScribeSession> => {
  const { data } = await api.post<SessionResponse>(`/ai-scribe/session/${sessionId}/simulate`, {})
  return data.data.session
}

export interface DraftEdit extends Partial<SoapDraft> {
  patientSummary?: Partial<PatientSummary>
}

export const updateDraft = async (sessionId: string, edit: DraftEdit): Promise<AIScribeSession> => {
  const { data } = await api.put<SessionResponse>(`/ai-scribe/session/${sessionId}/draft`, edit)
  return data.data.session
}

export const regenerateDraft = async (sessionId: string): Promise<AIScribeSession> => {
  const { data } = await api.post<SessionResponse>(`/ai-scribe/session/${sessionId}/regenerate`, {})
  return data.data.session
}

export interface ApproveInput {
  /** The provider-confirmed products (B5.2 / B5.3). */
  rxConfirmation?: RxConfirmation
  /** "Approve & send": publish the reviewed patient summary in the same step (B2.4). */
  sendToPatient?: boolean
  /** The final on-screen text, saved together with the approval. */
  draft?: SoapDraft
  patientSummary?: PatientSummary
}

export const approveSession = async (
  sessionId: string,
  input: ApproveInput = {}
): Promise<AIScribeSession & { rxCart?: RxCartResult | null }> => {
  const { data } = await api.post<{
    success: boolean
    data: { session: AIScribeSession & { rxCart?: RxCartResult | null } }
  }>(`/ai-scribe/session/${sessionId}/approve`, input)
  return data.data.session
}

export const publishPatientSummary = async (sessionId: string): Promise<AIScribeSession> => {
  const { data } = await api.post<SessionResponse>(
    `/ai-scribe/session/${sessionId}/publish-summary`,
    {}
  )
  return data.data.session
}

/** FR-7: the patient's prior approved visits, for the "Record over time" panel. */
export const getLongitudinal = async (sessionId: string): Promise<LongitudinalVisit[]> => {
  const { data } = await api.get<{ success: boolean; data: { visits: LongitudinalVisit[] } }>(
    `/ai-scribe/session/${sessionId}/longitudinal`
  )
  return data.data.visits
}

/** "Drafted by gpt-4o-mini" — the model, and the vendor preset when it adds information. */
export function provenanceLabel(
  session: Pick<AIScribeSession, 'aiModel' | 'aiProvider'>
): string | null {
  if (!session.aiModel) return null
  if (session.aiProvider === 'demo') return 'Demo conversation (synthetic)'
  const preset = session.aiProvider?.match(/^[^:]+:([^@]+)/)?.[1]
  return preset && !['mock', 'custom'].includes(preset)
    ? `Drafted by ${session.aiModel} · ${preset}`
    : `Drafted by ${session.aiModel}`
}
