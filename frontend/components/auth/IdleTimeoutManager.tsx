'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import api from '@/lib/api'
import {
  ACTIVITY_STORAGE_KEY,
  heartbeatDue,
  idlePhase,
  idleWindow,
  secondsLeft as secondsUntilLogout,
} from '@/lib/idleTimeout'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'wheel',
  'touchstart',
  'scroll',
] as const

interface Props {
  timeoutMinutes: number
  onTimeout: () => void
  warningSeconds?: number
}

/**
 * Idle-logoff UX (F0.2.1). Mounted by AuthProvider while someone is signed in.
 * Activity is shared across tabs through localStorage (a timestamp only, no
 * PHI), so working in one tab keeps the others signed in.
 */
export function IdleTimeoutManager({ timeoutMinutes, onTimeout, warningSeconds = 60 }: Props) {
  const windowRef = useRef(idleWindow(timeoutMinutes, warningSeconds))
  windowRef.current = idleWindow(timeoutMinutes, warningSeconds)
  const lastActivity = useRef(Date.now())
  const lastHeartbeat = useRef(Date.now())
  const lastEventAt = useRef(0)
  const fired = useRef(false)
  const warningOpenRef = useRef(false)
  const onTimeoutRef = useRef(onTimeout)
  onTimeoutRef.current = onTimeout

  const [warningOpen, setWarningOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)

  const recordActivity = useCallback((at: number) => {
    lastActivity.current = at
    try {
      window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(at))
    } catch {
      // storage unavailable — this tab still tracks its own activity
    }
  }, [])

  const sendHeartbeat = useCallback((at: number) => {
    lastHeartbeat.current = at
    // Records activity on the server session. A 401 here is handled by the
    // API client (refresh, or end the session everywhere).
    api.get('/auth/session').catch(() => undefined)
  }, [])

  const tick = useCallback(() => {
    if (fired.current) return
    const now = Date.now()
    const w = windowRef.current
    const phase = idlePhase(now, lastActivity.current, w)
    if (phase === 'expired') {
      fired.current = true
      warningOpenRef.current = false
      setWarningOpen(false)
      onTimeoutRef.current()
      return
    }
    const warn = phase === 'warning'
    if (warn !== warningOpenRef.current) {
      warningOpenRef.current = warn
      setWarningOpen(warn)
    }
    if (warn) setSecondsLeft(secondsUntilLogout(now, lastActivity.current, w))
    if (heartbeatDue(now, lastActivity.current, lastHeartbeat.current, w)) sendHeartbeat(now)
  }, [sendHeartbeat])

  useEffect(() => {
    recordActivity(Date.now())
    const onActivity = () => {
      // While the warning is up only the explicit "Stay signed in" counts, so
      // a nudged mouse can't silently keep an abandoned screen open.
      if (warningOpenRef.current) return
      const now = Date.now()
      if (now - lastEventAt.current < 1000) return
      lastEventAt.current = now
      recordActivity(now)
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ACTIVITY_STORAGE_KEY || !e.newValue) return
      const at = Number(e.newValue)
      if (Number.isFinite(at) && at > lastActivity.current) {
        lastActivity.current = at
        tick()
      }
    }
    // Coming back to the tab is not activity — re-check immediately so an
    // expired session is closed before anything is shown.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, onActivity, { passive: true })
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisible)
    const interval = window.setInterval(tick, 1000)
    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(interval)
    }
  }, [recordActivity, tick])

  const staySignedIn = () => {
    const now = Date.now()
    recordActivity(now)
    sendHeartbeat(now)
    warningOpenRef.current = false
    setWarningOpen(false)
  }

  const signOutNow = () => {
    fired.current = true
    warningOpenRef.current = false
    setWarningOpen(false)
    onTimeoutRef.current()
  }

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = secondsLeft % 60
  const countdown = minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`

  return (
    <AlertDialog open={warningOpen}>
      <AlertDialogContent
        data-testid="idle-warning"
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="max-w-md"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" aria-hidden="true" />
            Are you still there?
          </AlertDialogTitle>
          <AlertDialogDescription>
            For patient privacy you will be signed out after inactivity. Signing out in{' '}
            <span
              className="font-semibold tabular-nums"
              aria-live="polite"
              data-testid="idle-countdown"
            >
              {countdown}
            </span>
            .
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <button
            type="button"
            onClick={signOutNow}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            Sign out now
          </button>
          <button
            type="button"
            autoFocus
            onClick={staySignedIn}
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            Stay signed in
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
