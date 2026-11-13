import axios from 'axios'
import api from './api'
import type { Service } from './types/booking'

const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
const publicApi = axios.create({
  baseURL: `${baseURL}/api/v1/public`,
  headers: { 'Content-Type': 'application/json' },
})

export interface GetClinicServicesResponse {
  success: boolean
  data: { services: Service[] }
}

export const getClinicServices = async (clinicId: string): Promise<Service[]> => {
  const { data } = await publicApi.get<GetClinicServicesResponse>(`/clinics/${clinicId}/services`)
  return data.data.services
}

export interface DashboardService {
  id: string
  name: string
  duration: number
  defaultPrice: string
  discipline: { id: string; name: string }
  recommendedProducts?: { id: string; name: string }[]
  /** CTO-31 */
  defaultMode?: 'IN_PERSON' | 'VIRTUAL'
  createdAt: string
}

export const getDashboardServices = async (): Promise<DashboardService[]> => {
  const { data } = await api.get<{
    success: boolean
    data: { services: DashboardService[] }
  }>('/services')
  return data.data.services
}

export interface ServiceWithCount extends DashboardService {
  _count?: { providerServices: number }
}

export interface CreateServicePayload {
  disciplineId: string
  name: string
  duration: number
  defaultPrice: number | string
  taxApplicable?: boolean
  recommendedProductIds?: string[]
  defaultMode?: 'IN_PERSON' | 'VIRTUAL'
}

export interface UpdateServicePayload {
  name?: string
  duration?: number
  defaultPrice?: number | string
  disciplineId?: string
  taxApplicable?: boolean
  recommendedProductIds?: string[]
  defaultMode?: 'IN_PERSON' | 'VIRTUAL'
}

export const createService = async (payload: CreateServicePayload): Promise<ServiceWithCount> => {
  const { data } = await api.post<{ success: boolean; data: { service: ServiceWithCount } }>(
    '/services',
    payload
  )
  return data.data.service
}

export const updateService = async (
  id: string,
  payload: UpdateServicePayload
): Promise<ServiceWithCount> => {
  const { data } = await api.put<{ success: boolean; data: { service: ServiceWithCount } }>(
    `/services/${id}`,
    payload
  )
  return data.data.service
}

export const archiveService = async (id: string): Promise<void> => {
  await api.delete(`/services/${id}`)
}
