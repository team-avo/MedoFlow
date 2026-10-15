import api from './api'
import type { AppointmentStatus } from './patientApi'

export type RecurringFrequency = 'WEEKLY'

export interface CreateRecurringSeriesPayload {
  clinicId: string
  locationId?: string
  providerId: string
  serviceId: string
  patientId: string
  startTime: string
  endTime: string
  frequency: RecurringFrequency
  numberOfSessions?: number
  endDate?: string | null
}

export interface CreatedAppointmentRecurring {
  id: string
  status: AppointmentStatus
  bookingHoldExpiresAt?: string | null
  recurringSeriesId?: string | null
  startTime?: string
}

export interface RecurringConflict {
  date: string
  reason: string
}

export interface CreateRecurringSeriesResponse {
  appointments: CreatedAppointmentRecurring[]
  conflicts: RecurringConflict[]
}

export const createRecurringSeries = async (
  payload: CreateRecurringSeriesPayload
): Promise<CreateRecurringSeriesResponse> => {
  const { data } = await api.post<{
    success: boolean
    data: CreateRecurringSeriesResponse
  }>('/appointments/recurring', payload)
  return data.data
}

export interface CancelRecurringSeriesResponse {
  seriesId: string
  cancelledAppointmentIds: string[]
}

/** Staff: cancel every upcoming visit of a recurring series. */
export const cancelRecurringSeries = async (
  seriesId: string,
  reason?: string
): Promise<CancelRecurringSeriesResponse> => {
  const { data } = await api.post<{
    success: boolean
    data: CancelRecurringSeriesResponse
  }>(`/appointments/recurring/${seriesId}/cancel`, { reason: reason ?? '' })
  return data.data
}
