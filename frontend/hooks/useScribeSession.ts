'use client'

/**
 * The AI scribe session behind both scribe screens (F2.1): the console
 * (by visit record) and the consultation room (by session id).
 *
 * While the AI is working the session is polled with backoff (3 s, growing
 * to 10 s) and the polling stops after 10 minutes: the screen then says it
 * is taking longer than expected and offers "Check again" instead of
 * spinning forever (FR-11).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getCapabilities,
  getSession,
  getSessionByVisitRecord,
  type AIScribeSession,
} from '@/lib/aiScribeApi'

export const POLL_START_MS = 3_000
export const POLL_MAX_MS = 10_000
export const POLL_CAP_MS = 10 * 60_000

/** The next poll delay: +50% per poll, capped. */
export const nextPollDelay = (previous: number): number =>
  Math.min(POLL_MAX_MS, Math.round(previous * 1.5))

export type ScribeSessionKey =
  | { by: 'visit'; visitRecordId: string }
  | { by: 'id'; sessionId: string | null | undefined }

export const scribeSessionQueryKey = (key: ScribeSessionKey) =>
  key.by === 'visit'
    ? ['ai-scribe', 'session', 'visit', key.visitRecordId]
    : ['ai-scribe', 'session', 'id', key.sessionId ?? '']

export function useScribeSession(key: ScribeSessionKey) {
  const queryClient = useQueryClient()
  const queryKey = scribeSessionQueryKey(key)
  const enabled = key.by === 'visit' ? Boolean(key.visitRecordId) : Boolean(key.sessionId)
  const delayRef = useRef(POLL_START_MS)
  const processingSinceRef = useRef<number | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  const query = useQuery({
    queryKey,
    queryFn: (): Promise<AIScribeSession | null> =>
      key.by === 'visit'
        ? getSessionByVisitRecord(key.visitRecordId)
        : getSession(key.sessionId as string),
    enabled,
    refetchOnMount: 'always',
    refetchInterval: (q) => {
      const s = q.state.data as AIScribeSession | null | undefined
      if (s?.status !== 'TRANSCRIBING') {
        processingSinceRef.current = null
        delayRef.current = POLL_START_MS
        return false
      }
      processingSinceRef.current ??= Date.now()
      if (Date.now() - processingSinceRef.current > POLL_CAP_MS) return false
      const delay = delayRef.current
      delayRef.current = nextPollDelay(delay)
      return delay
    },
  })

  const session = query.data ?? null
  const processing = session?.status === 'TRANSCRIBING'

  useEffect(() => {
    if (!processing) {
      setTimedOut(false)
      return
    }
    const since = processingSinceRef.current ?? Date.now()
    const remaining = POLL_CAP_MS - (Date.now() - since)
    if (remaining <= 0) {
      setTimedOut(true)
      return
    }
    const t = setTimeout(() => setTimedOut(true), remaining)
    return () => clearTimeout(t)
  }, [processing, query.dataUpdatedAt])

  /** Replace the cached session with a fresh server copy (after a mutation). */
  const setSession = useCallback(
    (next: AIScribeSession | null) => queryClient.setQueryData(queryKey, next),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, JSON.stringify(queryKey)]
  )

  /** Start polling afresh (after "Check again", retry or regenerate). */
  const restartPolling = useCallback(() => {
    processingSinceRef.current = null
    delayRef.current = POLL_START_MS
    setTimedOut(false)
    void query.refetch()
  }, [query])

  return {
    session,
    isLoading: query.isLoading && enabled,
    error: query.error,
    processing,
    /** Still processing after the 10-minute cap: polling stopped. */
    timedOut: processing && timedOut,
    setSession,
    restartPolling,
    refetch: query.refetch,
  }
}

/** What the server's scribe can do (record? draft? demo?). */
export function useScribeCapabilities() {
  return useQuery({
    queryKey: ['ai-scribe', 'capabilities'],
    queryFn: getCapabilities,
    staleTime: 60_000,
  })
}
