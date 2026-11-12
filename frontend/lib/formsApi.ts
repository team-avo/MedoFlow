import api from './api'

export interface FormFieldDefinition {
  id: string
  type: 'text' | 'textarea' | 'number' | 'checkbox' | 'select'
  label: string
  required?: boolean
  options?: { value: string; label: string }[]
  placeholder?: string
  /** CTO-21: asked when this yes/no question is answered Yes. */
  followUp?: {
    label: string
    options: { value: string; label: string }[]
    allowOther?: boolean
    required?: boolean
  }
}

export type FormScope = 'CLINIC' | 'DISCIPLINE' | 'SERVICE'

export interface FormTemplate {
  id: string
  name: string
  description: string | null
  scope: FormScope
  fields: FormFieldDefinition[]
  isActive: boolean
  discipline?: { id: string; name: string } | null
  service?: { id: string; name: string } | null
  createdAt: string
}

export interface CreateTemplatePayload {
  name: string
  description?: string
  scope: FormScope
  disciplineId?: string
  serviceId?: string
  fields: FormFieldDefinition[]
}

export const listTemplates = async (): Promise<FormTemplate[]> => {
  const { data } = await api.get<{
    success: boolean
    data: { templates: FormTemplate[] }
  }>('/forms/templates')
  return data.data.templates
}

export const createTemplate = async (payload: CreateTemplatePayload): Promise<FormTemplate> => {
  const { data } = await api.post<{
    success: boolean
    data: { template: FormTemplate }
  }>('/forms/templates', payload)
  return data.data.template
}

/** CTO-21: add the default patient intake form (idempotent). */
export const addDefaultIntakeTemplate = async (): Promise<{
  template: FormTemplate
  created: boolean
}> => {
  const { data } = await api.post<{
    success: boolean
    data: { template: FormTemplate; created: boolean }
  }>('/forms/templates/default', {})
  return data.data
}

export const updateTemplate = async (
  id: string,
  payload: Partial<CreateTemplatePayload>
): Promise<FormTemplate> => {
  const { data } = await api.put<{
    success: boolean
    data: { template: FormTemplate }
  }>(`/forms/templates/${id}`, payload)
  return data.data.template
}

export const disableTemplate = async (id: string): Promise<void> => {
  await api.delete(`/forms/templates/${id}`)
}

export interface FormResponsePayload {
  templateId: string
  patientId: string
  appointmentId?: string
  responses: Record<string, unknown>
}

export const submitFormResponse = async (payload: FormResponsePayload) => {
  const { data } = await api.post<{ success: boolean; data: { response: unknown } }>(
    '/forms/respond',
    payload
  )
  return data.data
}

export interface FormResponseItem {
  id: string
  templateId: string
  appointmentId: string | null
  responses: Record<string, unknown>
  createdAt: string
  template: { id: string; name: string; scope: string }
  appointment?: { id: string; startTime: string }
}

export const getPatientForms = async (
  patientId: string,
  clinicId?: string
): Promise<FormResponseItem[]> => {
  const params = clinicId ? `?clinicId=${clinicId}` : ''
  const { data } = await api.get<{
    success: boolean
    data: { responses: FormResponseItem[] }
  }>(`/forms/patient/${patientId}${params}`)
  return data.data.responses
}

export const getTemplatesForAppointment = async (
  appointmentId: string
): Promise<FormTemplate[]> => {
  const { data } = await api.get<{
    success: boolean
    data: { templates: FormTemplate[] }
  }>(`/forms/templates/for-appointment/${appointmentId}`)
  return data.data.templates
}
