import axios from 'axios'
import type { Clinic } from './types/booking'

const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
const api = axios.create({
  baseURL: `${baseURL}/api/v1/public`,
  headers: { 'Content-Type': 'application/json' },
})

export interface GetClinicsResponse {
  success: boolean
  data: { clinics: Clinic[] }
}

export interface GetClinicResponse {
  success: boolean
  data: { clinic: Clinic }
}

export const getClinics = async (): Promise<Clinic[]> => {
  const { data } = await api.get<GetClinicsResponse>('/clinics')
  return data.data.clinics
}

export const getClinic = async (id: string): Promise<Clinic> => {
  const { data } = await api.get<GetClinicResponse>(`/clinics/${id}`)
  return data.data.clinic
}

export const getPublicClinicProducts = async (clinicId: string) => {
  const { data } = await api.get(`/clinics/${clinicId}/products`)
  return data.data.products
}

export const getPublicClinicPackages = async (clinicId: string) => {
  const { data } = await api.get(`/clinics/${clinicId}/packages`)
  return data.data.packages
}

export const getPublicClinicMemberships = async (clinicId: string) => {
  const { data } = await api.get(`/clinics/${clinicId}/memberships`)
  return data.data.memberships
}

export const getPublicProduct = async (id: string) => {
  const { data } = await api.get(`/products/${id}`)
  return data.data.product
}
