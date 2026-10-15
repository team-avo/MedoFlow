import axios from 'axios'
import api from './api'
import type { Location } from './types/booking'
import type { AppointmentStatus } from './patientApi'

const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
const publicApi = axios.create({
  baseURL: `${baseURL}/api/v1/public`,
  headers: { 'Content-Type': 'application/json' },
})

export interface CheckPatientExistsResponse {
  success: boolean
  data: { exists: boolean }
}

export interface CreateAppointmentPayload {
  clinicId: string
  locationId?: string
  providerId: string
  serviceId: string
  patientId: string
  startTime: string
  endTime: string
  slotHoldId?: string
  patientPackageId?: string
  /**
   * Patient opted-in to AI Scribe while booking. When true, the consultation
   * session for this appointment starts with consent already granted — the
   * provider doesn't have to re-prompt for it at visit time.
   */
  aiScribeConsent?: boolean
}

export interface CreatedAppointment {
  id: string
  status: AppointmentStatus
  bookingHoldExpiresAt?: string | null
}

export interface CreateAppointmentResponse {
  appointment: CreatedAppointment
  clientSecret?: string
}

export const getClinicLocations = async (clinicId: string): Promise<Location[]> => {
  const { data } = await publicApi.get<{ success: boolean; data: { locations: Location[] } }>(
    `/clinics/${clinicId}/locations`
  )
  return data.data.locations
}

export const checkPatientExists = async (email: string): Promise<boolean> => {
  // POST: the email travels in the body, never in a URL (F0.3.1).
  const { data } = await publicApi.post<CheckPatientExistsResponse>('/patients/check', { email })
  return data.data.exists
}

export const createAppointment = async (
  payload: CreateAppointmentPayload
): Promise<CreateAppointmentResponse> => {
  const { data } = await api.post<{
    success: boolean
    data: CreateAppointmentResponse
  }>('/appointments', payload)
  return data.data
}

export interface SlotHoldPayload {
  clinicId: string
  providerId: string
  serviceId: string
  locationId?: string
  timezone: string
  startTime: string
  endTime: string
}

export interface CreatedSlotHold {
  id: string
  clinicId: string
  providerId: string
  serviceId: string
  locationId?: string | null
  timezone: string
  startTime: string
  endTime: string
  expiresAt: string
  status: 'ACTIVE' | 'EXPIRED' | 'CONVERTED' | 'RELEASED'
}

export const createSlotHold = async (payload: SlotHoldPayload): Promise<CreatedSlotHold> => {
  const { data } = await publicApi.post<{
    success: boolean
    data: { hold: CreatedSlotHold }
  }>('/slots/hold', payload)
  return data.data.hold
}

export const releaseSlotHold = async (holdId: string, clinicId: string): Promise<boolean> => {
  const { data } = await publicApi.delete<{
    success: boolean
    data: { released: boolean }
  }>(`/slots/hold/${holdId}?clinicId=${encodeURIComponent(clinicId)}`)
  return data.data.released
}
