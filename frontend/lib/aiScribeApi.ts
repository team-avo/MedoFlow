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
  diagnosis?: string
  treatmentPlan?: string
  nextSteps?: string
}

export interface ClinicalTimeline {
  symptoms: string[]
  duration: string | null
  assessment: string | null
  plan: string[]
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
  patientSummary: PatientSummary | null
  status: AIScribeStatus
  patientSummaryPublished?: boolean
  aiModel?: string | null
  errorMessage?: string | null
  processingStartedAt?: string | null
  processingCompletedAt?: string | null
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

export const startSession = async (
  visitRecordId: string,
  clinicId?: string
): Promise<AIScribeSession> => {
  const { data } = await api.post<{
    success: boolean
    data: { session: AIScribeSession }
  }>('/ai-scribe/session/start', { visitRecordId, clinicId })
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
  const { data } = await api.get<{
    success: boolean
    data: { session: AIScribeSession }
  }>(`/ai-scribe/session/${sessionId}${params}`)
  return data.data.session
}

export const getSessionByVisitRecord = async (
  visitRecordId: string,
  clinicId?: string
): Promise<AIScribeSession | null> => {
  try {
    const params = clinicId ? `?clinicId=${clinicId}` : ''
    const { data } = await api.get<{
      success: boolean
      data: { session: AIScribeSession }
    }>(`/ai-scribe/session/visit/${visitRecordId}${params}`)
    return data.data.session
  } catch {
    return null
  }
}

export const uploadAudio = async (
  sessionId: string,
  file: File,
  clinicId?: string
): Promise<AIScribeSession> => {
  const formData = new FormData()
  formData.append('audio', file)
  if (clinicId) formData.append('clinicId', clinicId)
  const { data } = await api.post<{
    success: boolean
    data: { session: AIScribeSession }
  }>(`/ai-scribe/session/${sessionId}/audio`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data.data.session
}

export const processSession = async (
  sessionId: string,
  clinicId?: string
): Promise<AIScribeSession> => {
  const body = clinicId ? { clinicId } : {}
  const { data } = await api.post<{
    success: boolean
    data: { session: AIScribeSession }
  }>(`/ai-scribe/session/${sessionId}/process`, body)
  return data.data.session
}

export const simulateSession = async (
  sessionId: string,
  clinicId?: string
): Promise<AIScribeSession> => {
  const body = clinicId ? { clinicId } : {}
  const { data } = await api.post<{
    success: boolean
    data: { session: AIScribeSession }
  }>(`/ai-scribe/session/${sessionId}/simulate`, body)
  return data.data.session
}

export const updateDraft = async (
  sessionId: string,
  draft: Partial<SoapDraft>,
  clinicId?: string
): Promise<AIScribeSession> => {
  const { data } = await api.put<{
    success: boolean
    data: { session: AIScribeSession }
  }>(`/ai-scribe/session/${sessionId}/draft`, { ...draft, clinicId })
  return data.data.session
}

export const regenerateDraft = async (
  sessionId: string,
  clinicId?: string
): Promise<AIScribeSession> => {
  const body = clinicId ? { clinicId } : {}
  const { data } = await api.post<{
    success: boolean
    data: { session: AIScribeSession }
  }>(`/ai-scribe/session/${sessionId}/regenerate`, body)
  return data.data.session
}

/**
 * Approves the note. With `rxConfirmation` this is "Approve & send": the
 * provider-confirmed products go to the patient's cart (B5.2 / B5.3).
 */
export const approveSession = async (
  sessionId: string,
  rxConfirmation?: RxConfirmation
): Promise<AIScribeSession & { rxCart?: RxCartResult | null }> => {
  const body = rxConfirmation ? { rxConfirmation } : {}
  const { data } = await api.post<{
    success: boolean
    data: { session: AIScribeSession & { rxCart?: RxCartResult | null } }
  }>(`/ai-scribe/session/${sessionId}/approve`, body)
  return data.data.session
}

export const regenerateSoapOnly = async (
  sessionId: string,
  clinicId?: string
): Promise<AIScribeSession> => {
  const body = clinicId ? { clinicId } : {}
  const { data } = await api.post<{
    success: boolean
    data: { session: AIScribeSession }
  }>(`/ai-scribe/session/${sessionId}/regenerate-soap-only`, body)
  return data.data.session
}

export const publishPatientSummary = async (
  sessionId: string,
  clinicId?: string
): Promise<AIScribeSession> => {
  const body = clinicId ? { clinicId } : {}
  const { data } = await api.post<{
    success: boolean
    data: { session: AIScribeSession }
  }>(`/ai-scribe/session/${sessionId}/publish-summary`, body)
  return data.data.session
}
