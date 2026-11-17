/**
 * CTO-39: cross-clinic feature usage for platform admins. The backend reads
 * PostHog server-side; the browser only ever talks to the MedoFlow API.
 */
import api from './api'

export const USAGE_RANGES = [7, 30, 90, 180, 365] as const
export type UsageRange = (typeof USAGE_RANGES)[number]

export interface FeatureUsageRow {
  key: string
  label: string
  area: string
  areaLabel: string
  events: number
  clinics: number
  lastUsed: string | null
  weekly: { week: string; events: number; clinics: number }[]
}

export interface UsageSummary {
  configured: true
  env: string
  days: UsageRange
  generatedAt: string
  totals: {
    events: number
    activeClinics: number
    totalClinics: number
    featuresUsed: number
    featuresTotal: number
    scribeAdoption: number | null
  }
  weeks: string[]
  areas: { key: string; label: string }[]
  features: FeatureUsageRow[]
}

export type UsageSummaryResponse = UsageSummary | { configured: false }

export const getFeatureUsage = async (days: UsageRange): Promise<UsageSummaryResponse> => {
  const { data } = await api.get<{ success: boolean; data: UsageSummaryResponse }>(
    '/platform/usage',
    { params: { days } }
  )
  return data.data
}

/** Downloads the clinic × feature CSV (tier planning). */
export const downloadFeatureUsageCsv = async (days: UsageRange): Promise<void> => {
  const response = await api.get<BlobPart>('/platform/usage/export.csv', {
    params: { days },
    responseType: 'blob',
  })
  const blob = new Blob([response.data], { type: 'text/csv' })
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `medoflow-feature-usage-${days}d.csv`
  anchor.click()
  window.URL.revokeObjectURL(url)
}
