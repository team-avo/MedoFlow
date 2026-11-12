/**
 * Staff booking from the dashboard (CTO-24): the owner, front desk or a custom
 * role with `appointments.create` books a walk-in or a phone booking. Every
 * call is authenticated and clinic-scoped on the server; none of it goes
 * through the public (go-live gated) API.
 */
import api from './api'
import type { TimeSlot } from './types/booking'
import type { User } from './types'

/**
 * Who sees "New appointment": the owner, the front desk, and custom-role
 * staff holding `appointments.create` (the server checks the same).
 */
export function canBookAppointments(
  user:
    | (Pick<User, 'role' | 'permissions'> & { customRole?: { permissions?: unknown } | null })
    | null
    | undefined
): boolean {
  if (!user) return false
  if (user.role === 'SUPER_ADMIN' || user.role === 'FRONT_DESK') return true
  if (user.role !== 'STAFF') return false
  const perms = [
    ...(Array.isArray(user.permissions) ? user.permissions : []),
    ...(Array.isArray(user.customRole?.permissions)
      ? (user.customRole.permissions as string[])
      : []),
  ]
  return perms.includes('*') || perms.includes('appointments.create')
}

export type StaffBookingSource = 'WALK_IN' | 'PHONE'

export interface StaffService {
  id: string
  name: string
  duration: number
  defaultPrice: string
  requirePrepayment?: boolean
  /** CTO-31: the visit type a booking starts with. */
  defaultMode?: 'IN_PERSON' | 'VIRTUAL'
}

export interface StaffProvider {
  id: string
  firstName: string
  lastName: string
  userId?: string | null
  locationAssignments: { locationId: string; location: { id: string; name: string } }[]
  providerServices: { serviceId: string }[]
}

export interface StaffLocation {
  id: string
  name: string
  timezone: string
}

export interface ClinicPatientResult {
  patient: { id: string; name: string; email: string | null; phone: string | null }
  created: boolean
  /** Set-password link for a new patient with an email; shown for copying. */
  inviteLink: string | null
  inviteEmailed: boolean
}

export async function getStaffServices(): Promise<StaffService[]> {
  const { data } = await api.get<{ data: { services: StaffService[] } }>('/services')
  return data.data.services
}

export async function getStaffProviders(): Promise<StaffProvider[]> {
  const { data } = await api.get<{ data: { providers: StaffProvider[] } }>('/providers')
  return data.data.providers
}

export async function getStaffLocations(): Promise<StaffLocation[]> {
  const { data } = await api.get<{ data: { locations: StaffLocation[] } }>('/locations')
  return data.data.locations
}

export async function getStaffSlots(params: {
  serviceId: string
  providerId: string
  date: string
  locationId?: string
}): Promise<TimeSlot[]> {
  const qs = new URLSearchParams({
    serviceId: params.serviceId,
    providerId: params.providerId,
    date: params.date,
  })
  if (params.locationId) qs.set('locationId', params.locationId)
  const { data } = await api.get<{ data: { slots: TimeSlot[] } }>(
    `/appointments/availability?${qs}`
  )
  return data.data.slots
}

export async function createClinicPatient(input: {
  name: string
  email?: string
  phone?: string
  sendInvite?: boolean
}): Promise<ClinicPatientResult> {
  const { data } = await api.post<{ data: ClinicPatientResult }>('/patients', input)
  return data.data
}

export async function createStaffAppointment(payload: {
  patientId: string
  providerId: string
  serviceId: string
  locationId?: string
  startTime: string
  endTime: string
  bookingSource: StaffBookingSource
  collectAtDesk?: boolean
  mode?: 'IN_PERSON' | 'VIRTUAL'
}) {
  const { data } = await api.post<{
    data: { appointment: { id: string; status: string } }
  }>('/appointments', payload)
  return data.data.appointment
}

/**
 * The "Walk-in, now" time: the first open slot from now on today, or, when
 * the provider has none left, right now (rounded up to 5 minutes). The server
 * still refuses an overlap with a clear 409.
 */
export function walkInStart(
  slots: Pick<TimeSlot, 'start' | 'end' | 'locationId'>[],
  durationMinutes: number,
  now: Date = new Date()
): { startTime: string; endTime: string; locationId: string | null; fromSlot: boolean } {
  const soonest = slots
    .filter(
      (s) =>
        new Date(s.end).getTime() > now.getTime() &&
        new Date(s.start).getTime() >= now.getTime() - 5 * 60_000
    )
    .sort((a, b) => a.start.localeCompare(b.start))[0]
  if (soonest) {
    return {
      startTime: soonest.start,
      endTime: soonest.end,
      locationId: soonest.locationId ?? null,
      fromSlot: true,
    }
  }
  const start = new Date(Math.ceil(now.getTime() / (5 * 60_000)) * 5 * 60_000)
  return {
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + durationMinutes * 60_000).toISOString(),
    locationId: null,
    fromSlot: false,
  }
}
