import api from './api'

export type AppointmentStatus =
  | 'DRAFT'
  | 'PENDING_PROVIDER_APPROVAL'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'RESCHEDULED'

export type VisitRecordStatus = 'DRAFT' | 'FINAL'

export interface PatientAppointment {
  id: string
  clinicId: string
  locationId: string
  providerId: string
  serviceId: string
  patientId: string
  startTime: string
  endTime: string
  status: AppointmentStatus
  priceAtBooking: string
  createdAt: string
  updatedAt: string
  location: { id: string; name: string }
  provider: {
    id: string
    firstName: string
    lastName: string
    discipline: { id: string; name: string }
    user: { id: string; name: string }
  }
  service: { id: string; name: string }
  meetLink?: string | null
  recurringSeriesId?: string | null
}

export interface PatientAppointmentDetail extends PatientAppointment {
  clinic: { id: string; name: string }
  service: {
    id: string
    name: string
    duration: number
    /** Cancellation policy (F1.3); see lib/cancellationPolicy.ts. */
    cancellationWindowHours?: number | null
    cancellationFeeType?: string | null
    cancellationFeeValue?: string | null
  }
  patient: { id: string; name: string; email: string }
}

export interface PatientSummary {
  diagnosis?: string
  treatmentPlan?: string
  nextSteps?: string
}

export interface VisitRecord {
  id: string
  clinicId: string
  appointmentId: string
  providerId: string
  patientId: string
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  note: string | null
  status: VisitRecordStatus
  isFinalized?: boolean
  createdAt: string
  updatedAt: string
  provider: { id: string; firstName: string; lastName: string }
}

export interface Prescription {
  id: string
  clinicId: string
  appointmentId: string
  providerId: string
  patientId: string
  notes: string
  createdAt: string
  updatedAt: string
  appointment: { id: string; startTime: string }
  provider: { id: string; firstName: string; lastName: string }
}

export const getMyAppointments = async (
  startDate?: Date,
  endDate?: Date
): Promise<PatientAppointment[]> => {
  const search = new URLSearchParams()
  if (startDate) search.set('startDate', startDate.toISOString())
  if (endDate) search.set('endDate', endDate.toISOString())
  const qs = search.toString()
  const { data } = await api.get<{
    success: boolean
    data: { appointments: PatientAppointment[] }
  }>(`/appointments/my${qs ? `?${qs}` : ''}`)
  return data.data.appointments
}

export interface ProviderAppointment {
  id: string
  clinicId: string
  locationId: string
  providerId: string
  serviceId: string
  patientId: string
  startTime: string
  endTime: string
  status: AppointmentStatus
  priceAtBooking?: string
  createdAt: string
  updatedAt: string
  location: { id: string; name: string }
  service: { id: string; name: string }
  patient: { id: string; name: string; email: string }
  provider?: { id: string; firstName: string; lastName: string }
  meetLink?: string | null
  recurringSeriesId?: string | null
}

export interface ClinicPatient {
  id: string
  name: string
  email: string
}

/** Staff: the clinic's active patients (id, name, email only). */
export const getClinicPatients = async (): Promise<ClinicPatient[]> => {
  const { data } = await api.get<{ success: boolean; data: { patients: ClinicPatient[] } }>(
    '/patients'
  )
  return data.data.patients
}

export const getProviderAppointments = async (
  startDate?: Date,
  endDate?: Date
): Promise<ProviderAppointment[]> => {
  const search = new URLSearchParams()
  if (startDate) search.set('startDate', startDate.toISOString())
  if (endDate) search.set('endDate', endDate.toISOString())
  const qs = search.toString()
  const { data } = await api.get<{
    success: boolean
    data: { appointments: ProviderAppointment[] }
  }>(`/appointments/provider${qs ? `?${qs}` : ''}`)
  return data.data.appointments
}

export const getClinicAppointments = async (
  startDate?: Date,
  endDate?: Date
): Promise<ProviderAppointment[]> => {
  const search = new URLSearchParams()
  if (startDate) search.set('startDate', startDate.toISOString())
  if (endDate) search.set('endDate', endDate.toISOString())
  const qs = search.toString()
  const { data } = await api.get<{
    success: boolean
    data: { appointments: ProviderAppointment[] }
  }>(`/appointments/clinic${qs ? `?${qs}` : ''}`)
  return data.data.appointments
}

export const cancelAppointment = async (
  appointmentId: string,
  reason?: string
): Promise<{
  appointment: PatientAppointment
  lateCancellation?: boolean
  cancellationFee?: { type: string; value: string; amount?: string }
}> => {
  const { data } = await api.post<{
    success: boolean
    data: {
      appointment: PatientAppointment
      lateCancellation?: boolean
      cancellationFee?: { type: string; value: string; amount?: string }
    }
  }>(`/appointments/${appointmentId}/cancel`, { reason: reason ?? '' })
  return data.data
}

export const rescheduleAppointment = async (
  appointmentId: string,
  payload: {
    locationId?: string
    slotHoldId?: string
    newStartTime: string
    newEndTime: string
  }
): Promise<{ oldAppointment: PatientAppointment; newAppointment: PatientAppointment }> => {
  const { data } = await api.post<{
    success: boolean
    data: { oldAppointment: PatientAppointment; newAppointment: PatientAppointment }
  }>(`/appointments/${appointmentId}/reschedule`, payload)
  return data.data
}

export const getAppointmentById = async (id: string): Promise<PatientAppointmentDetail> => {
  const { data } = await api.get<{
    success: boolean
    data: { appointment: PatientAppointmentDetail }
  }>(`/appointments/${id}`)
  return data.data.appointment
}

export const createVisitRecord = async (
  appointmentId: string,
  payload?: {
    patientId?: string
    subjective?: string
    objective?: string
    assessment?: string
    plan?: string
  }
): Promise<VisitRecord> => {
  const body = { ...payload, appointmentId }
  const { data } = await api.post<{
    success: boolean
    data: { visitRecord: VisitRecord }
  }>('/visits', body)
  return data.data.visitRecord
}

export const updateVisitRecord = async (
  visitId: string,
  payload: Partial<Pick<VisitRecord, 'subjective' | 'objective' | 'assessment' | 'plan'>>
): Promise<VisitRecord> => {
  const { data } = await api.put<{
    success: boolean
    data: { visitRecord: VisitRecord }
  }>(`/visits/${visitId}`, payload)
  return data.data.visitRecord
}

export const finalizeVisitRecord = async (visitId: string): Promise<VisitRecord> => {
  const { data } = await api.put<{
    success: boolean
    data: { visitRecord: VisitRecord }
  }>(`/visits/${visitId}/finalize`, {})
  return data.data.visitRecord
}

export const getVisitByAppointment = async (
  appointmentId: string
): Promise<{ visitRecord: VisitRecord; patientSummary?: PatientSummary } | null> => {
  try {
    const { data } = await api.get<{
      success: boolean
      data: { visitRecord: VisitRecord; patientSummary?: PatientSummary }
    }>(`/visits/appointment/${appointmentId}`)
    return data.data
  } catch {
    return null
  }
}

export const getVisitWithHistory = async (
  visitId: string
): Promise<VisitRecord & { versions: any[] }> => {
  const { data } = await api.get<{
    success: boolean
    data: { visitRecord: VisitRecord & { versions: any[] } }
  }>(`/visits/${visitId}?includeHistory=true`)
  return data.data.visitRecord
}

export const getMyPrescriptions = async (): Promise<Prescription[]> => {
  const { data } = await api.get<{
    success: boolean
    data: { prescriptions: Prescription[] }
  }>('/prescriptions/my')
  return data.data.prescriptions
}

export interface PatientPackage {
  id: string
  packageId: string
  status?: string
  totalSessions: number
  usedSessions: number
  remainingSessions?: number
  expiresAt: string | null
  package: {
    id?: string
    name: string
  }
}

export const getMyPackages = async (): Promise<PatientPackage[]> => {
  const { data } = await api.get<{
    success: boolean
    data: { packages: PatientPackage[] }
  }>('/patients/packages')
  return data.data.packages
}

export interface PatientMembershipSubscription {
  id: string
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodStart: string
  currentPeriodEnd: string
  membership: {
    id: string
    name: string
    billingPeriod: string
    monthlyPrice: string
    serviceDiscountPercent: string
  }
}

export interface PatientEntitlements {
  packages: PatientPackage[]
  subscriptions: PatientMembershipSubscription[]
  activeMembershipBenefit: {
    subscriptionId: string
    membershipId: string
    membershipName: string
    serviceDiscountPercent: string
  } | null
}

export const getMyEntitlements = async (): Promise<PatientEntitlements> => {
  const { data } = await api.get<{
    success: boolean
    data: { entitlements: PatientEntitlements }
  }>('/patients/entitlements')
  return data.data.entitlements
}

export const getPatientEntitlements = async (patientId: string): Promise<PatientEntitlements> => {
  const { data } = await api.get<{
    success: boolean
    data: { entitlements: PatientEntitlements }
  }>(`/patients/${patientId}/entitlements`)
  return data.data.entitlements
}

export const getMyInvoices = async (): Promise<any[]> => {
  const { data } = await api.get<{
    success: boolean
    data: { invoices: any[] }
  }>('/invoices/my')
  return data.data.invoices
}

/** One published care summary in the patient's portal (F2.6). */
export interface PublishedSummary {
  sessionId: string
  visitRecordId: string
  appointmentId: string
  visitDate: string
  providerName: string | null
  publishedAt: string
  summary: { diagnosis: string; treatmentPlan: string; nextSteps: string }
}

/** The signed-in patient's published care summaries, newest first. */
export const getMySummaries = async (): Promise<PublishedSummary[]> => {
  const { data } = await api.get<{ success: boolean; data: { summaries: PublishedSummary[] } }>(
    '/visits/me/summaries'
  )
  return data.data.summaries
}
