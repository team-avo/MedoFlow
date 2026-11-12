import api from './api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConsultationStatus =
  | 'NOT_STARTED'
  | 'READY'
  | 'LIVE'
  | 'RECORDING'
  | 'ENDED'
  | 'PROCESSING'
  | 'TRANSCRIPT_READY'
  | 'FAILED'

export type RecordingStatus =
  | 'NOT_STARTED'
  | 'RECORDING'
  | 'STOPPED'
  | 'UPLOADING'
  | 'STORED'
  | 'FAILED'

export type ConsentStatus = 'PENDING' | 'GRANTED' | 'DECLINED'

export interface ConsultationSession {
  id: string
  clinicId: string
  appointmentId: string
  providerId: string
  patientId: string
  status: ConsultationStatus
  recordingStatus: RecordingStatus
  consentStatus: ConsentStatus
  consentGrantedAt: string | null
  joinToken: string
  recordingUrl: string | null
  transcriptText: string | null
  transcriptStatus: string
  aiScribeSessionId: string | null
  meetingRoomUrl: string | null
  meetingRoomName: string | null
  startedAt: string | null
  endedAt: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  appointment?: {
    id: string
    startTime: string
    endTime: string
    status?: string
    meetLink?: string | null
    /** CTO-31: in person (audio only) or a video visit. */
    mode?: 'IN_PERSON' | 'VIRTUAL'
  }
  provider?: {
    id: string
    firstName: string
    lastName: string
  }
  patient?: {
    id: string
    name: string
    email?: string
  }
  aiScribeSession?: {
    id: string
    status: string
    transcript: string | null
    aiDraft: unknown
    patientSummary: unknown
    patientSummaryPublished: boolean
    errorMessage: string | null
  }
}

export interface TranscriptResult {
  sessionId: string
  transcriptStatus: string
  transcript: string | null
  aiScribeStatus: string | null
  aiDraft: unknown
  timeline: unknown
  errorMessage: string | null
}

export interface ConvertResult {
  aiScribeSessionId: string
  aiScribeStatus: string
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

type ApiRes<T> = { success: boolean; data: T }

/** POST /appointments/:id/consultation/start */
export const startConsultation = async (
  appointmentId: string,
  clinicId?: string
): Promise<ConsultationSession> => {
  const body = clinicId ? { clinicId } : {}
  const { data } = await api.post<ApiRes<{ session: ConsultationSession }>>(
    `/appointments/${appointmentId}/consultation/start`,
    body
  )
  return data.data.session
}

/** GET /consultations/:id */
export const getSession = async (sessionId: string): Promise<ConsultationSession> => {
  const { data } = await api.get<ApiRes<{ session: ConsultationSession }>>(
    `/consultations/${sessionId}`
  )
  return data.data.session
}

/** GET /consultations/join/:token */
export const joinByToken = async (token: string): Promise<ConsultationSession> => {
  const { data } = await api.get<ApiRes<{ session: ConsultationSession }>>(
    `/consultations/join/${token}`
  )
  return data.data.session
}

/** GET /consultations/appointment/:appointmentId */
export const getByAppointment = async (
  appointmentId: string
): Promise<ConsultationSession | null> => {
  try {
    const { data } = await api.get<ApiRes<{ session: ConsultationSession }>>(
      `/consultations/appointment/${appointmentId}`
    )
    return data.data.session
  } catch {
    return null
  }
}

/** POST /consultations/:id/consent */
export const grantConsent = async (sessionId: string): Promise<ConsultationSession> => {
  const { data } = await api.post<ApiRes<{ session: ConsultationSession }>>(
    `/consultations/${sessionId}/consent`
  )
  return data.data.session
}

/** POST /consultations/:id/consent/attest: the provider records the patient's spoken consent (in person). */
export const attestConsent = async (sessionId: string): Promise<ConsultationSession> => {
  const { data } = await api.post<ApiRes<{ session: ConsultationSession }>>(
    `/consultations/${sessionId}/consent/attest`
  )
  return data.data.session
}

/** POST /consultations/:id/video/auto-ended (CTO-35): audited, ids only. */
export const videoAutoEnded = async (sessionId: string): Promise<void> => {
  await api.post(`/consultations/${sessionId}/video/auto-ended`)
}

/** POST /consultations/:id/recording/start */
export const startRecording = async (
  sessionId: string,
  clinicId?: string
): Promise<ConsultationSession> => {
  const body = clinicId ? { clinicId } : {}
  const { data } = await api.post<ApiRes<{ session: ConsultationSession }>>(
    `/consultations/${sessionId}/recording/start`,
    body
  )
  return data.data.session
}

/** POST /consultations/:id/recording/stop */
export const stopRecording = async (
  sessionId: string,
  clinicId?: string
): Promise<ConsultationSession> => {
  const body = clinicId ? { clinicId } : {}
  const { data } = await api.post<ApiRes<{ session: ConsultationSession }>>(
    `/consultations/${sessionId}/recording/stop`,
    body
  )
  return data.data.session
}

/** POST /consultations/:id/recording/upload */
export const uploadRecording = async (
  sessionId: string,
  file: Blob,
  clinicId?: string
): Promise<ConsultationSession> => {
  const formData = new FormData()
  formData.append('audio', file, 'recording.webm')
  if (clinicId) formData.append('clinicId', clinicId)
  const { data } = await api.post<ApiRes<{ session: ConsultationSession }>>(
    `/consultations/${sessionId}/recording/upload`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return data.data.session
}

/**
 * POST /consultations/:id/live-transcript: one live-caption segment while
 * recording (WS2). The text is a preview; nothing is stored server-side.
 */
export const liveTranscript = async (
  sessionId: string,
  segment: Blob,
  seq: number
): Promise<string> => {
  const formData = new FormData()
  formData.append('segment', String(seq))
  formData.append('audio', segment, 'segment.webm')
  const { data } = await api.post<ApiRes<{ text: string; segment: number }>>(
    `/consultations/${sessionId}/live-transcript`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return data.data.text
}

/** POST /consultations/:id/transcribe */
export const startTranscription = async (
  sessionId: string,
  clinicId?: string
): Promise<{ session: ConsultationSession; aiScribeSessionId: string }> => {
  const body = clinicId ? { clinicId } : {}
  const { data } = await api.post<
    ApiRes<{ session: ConsultationSession; aiScribeSessionId: string }>
  >(`/consultations/${sessionId}/transcribe`, body)
  return data.data
}

/** GET /consultations/:id/transcript */
export const getTranscript = async (
  sessionId: string,
  clinicId?: string
): Promise<TranscriptResult> => {
  const params = clinicId ? `?clinicId=${clinicId}` : ''
  const { data } = await api.get<ApiRes<TranscriptResult>>(
    `/consultations/${sessionId}/transcript${params}`
  )
  return data.data
}

// ---------------------------------------------------------------------------
// Jitsi (JaaS / 8x8.vc) Video Room
// ---------------------------------------------------------------------------

export interface VideoRoomResult {
  /** "8x8.vc" when JaaS is configured, "meet.jit.si" otherwise */
  domain: string
  roomUrl: string
  roomName: string
  /** Signed JWT from the backend, empty string when JaaS is not configured */
  jwt: string
  jaasEnabled: boolean
}

/** POST /consultations/:id/video-room: Create (or reuse) the 8x8 JaaS call room */
export const createVideoRoom = async (
  sessionId: string,
  clinicId?: string
): Promise<VideoRoomResult> => {
  const body = clinicId ? { clinicId } : {}
  const { data } = await api.post<ApiRes<VideoRoomResult>>(
    `/consultations/${sessionId}/video-room`,
    body
  )
  return data.data
}

/** GET /consultations/:id/video-token: Get meeting token (authenticated) */
export const getVideoToken = async (sessionId: string): Promise<VideoRoomResult> => {
  const { data } = await api.get<ApiRes<VideoRoomResult>>(`/consultations/${sessionId}/video-token`)
  return data.data
}

/** GET /consultations/join/:token/video-token: Get meeting token via join token (for patients) */
export const getVideoTokenByJoinToken = async (joinToken: string): Promise<VideoRoomResult> => {
  const { data } = await api.get<ApiRes<VideoRoomResult>>(
    `/consultations/join/${joinToken}/video-token`
  )
  return data.data
}

/** POST /consultations/:id/convert-to-template */
export const convertToTemplate = async (
  sessionId: string,
  clinicId?: string
): Promise<ConvertResult> => {
  const body = clinicId ? { clinicId } : {}
  const { data } = await api.post<ApiRes<ConvertResult>>(
    `/consultations/${sessionId}/convert-to-template`,
    body
  )
  return data.data
}
