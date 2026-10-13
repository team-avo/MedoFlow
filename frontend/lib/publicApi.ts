import axios from 'axios'

const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const publicApi = axios.create({
  baseURL: `${baseURL}/api/v1/public`,
  headers: { 'Content-Type': 'application/json' },
})

export interface Clinic {
  id: string
  name: string
  email: string
  subscriptionPlan: string
}

export interface Service {
  id: string
  name: string
  duration: number
  defaultPrice: string
  discipline: { id: string; name: string }
}

export interface Provider {
  id: string
  firstName: string
  lastName: string
  email: string | null
  discipline: { id: string; name: string }
  providerServices: { serviceId: string }[]
}

export interface Location {
  id: string
  name: string
  address: string | null
  timezone: string
}

export interface TimeSlot {
  start: string
  end: string
}

export const getClinics = async (): Promise<Clinic[]> => {
  const { data } = await publicApi.get<{ success: boolean; data: { clinics: Clinic[] } }>(
    '/clinics'
  )
  return data.data.clinics
}

export const getClinic = async (id: string): Promise<Clinic> => {
  const { data } = await publicApi.get<{ success: boolean; data: { clinic: Clinic } }>(
    `/clinics/${id}`
  )
  return data.data.clinic
}

export const getClinicServices = async (clinicId: string): Promise<Service[]> => {
  const { data } = await publicApi.get<{ success: boolean; data: { services: Service[] } }>(
    `/clinics/${clinicId}/services`
  )
  return data.data.services
}

export const getClinicProviders = async (clinicId: string): Promise<Provider[]> => {
  const { data } = await publicApi.get<{ success: boolean; data: { providers: Provider[] } }>(
    `/clinics/${clinicId}/providers`
  )
  return data.data.providers
}

export const getClinicLocations = async (clinicId: string): Promise<Location[]> => {
  const { data } = await publicApi.get<{ success: boolean; data: { locations: Location[] } }>(
    `/clinics/${clinicId}/locations`
  )
  return data.data.locations
}

export const checkPatientExists = async (email: string): Promise<boolean> => {
  // POST: the email travels in the body, never in a URL (F0.3.1).
  const { data } = await publicApi.post<{ success: boolean; data: { exists: boolean } }>(
    '/patients/check',
    { email }
  )
  return data.data.exists
}

export const getAvailability = async (
  clinicId: string,
  serviceId: string,
  date: string,
  providerId?: string
): Promise<TimeSlot[]> => {
  const params = new URLSearchParams({ clinicId, serviceId, date })
  if (providerId) params.set('providerId', providerId)
  const { data } = await publicApi.get<{ success: boolean; data: { slots: TimeSlot[] } }>(
    `/availability?${params}`
  )
  return data.data.slots
}
