'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { onboardingApi, type Application } from '@/lib/onboardingApi'

export const APPLICATION_QUERY_KEY = ['onboarding', 'application'] as const

/** The clinic's application (practice details, practitioners, agreement, review state). */
export function useApplication() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: APPLICATION_QUERY_KEY,
    queryFn: onboardingApi.getApplication,
    staleTime: 30_000,
  })
  const setApplication = (app: Application) => qc.setQueryData(APPLICATION_QUERY_KEY, app)
  return { ...query, setApplication }
}
