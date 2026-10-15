'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import api from '@/lib/api'
import { useAuth } from './AuthContext'
import type { Role } from '@/lib/types'
import {
  superAdminTour,
  providerTour,
  frontDeskTour,
  patientTour,
  type TourScript,
  type TourStep,
} from '@/components/tour/tours'
import { clientLog } from '@/lib/clientLog'

export interface StartOptions {
  /** force=true bypasses the hasSeenTour check; used by "Restart tour" */
  force?: boolean
}

interface TourContextValue {
  isActive: boolean
  stepIndex: number
  currentStep: TourStep | null
  script: TourScript | null
  start: (opts?: StartOptions) => void
  stop: () => void
  next: () => void
  prev: () => void
  skip: () => Promise<void>
  finish: () => Promise<void>
}

const TourContext = React.createContext<TourContextValue | null>(null)

function pickScript(role: Role | undefined): TourScript | null {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'STAFF':
      return superAdminTour
    case 'PROVIDER':
      return providerTour
    case 'FRONT_DESK':
      return frontDeskTour
    case 'PATIENT':
      return patientTour
    default:
      return null
  }
}

function isTourSurface(pathname: string | null, role: Role | undefined): boolean {
  if (!pathname) return false
  // Patient tour runs on /account, everyone else on /dashboard
  if (role === 'PATIENT') return pathname.startsWith('/account')
  return pathname.startsWith('/dashboard')
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { user, patchUser } = useAuth()
  const pathname = usePathname()
  const [active, setActive] = React.useState(false)
  const [stepIndex, setStepIndex] = React.useState(0)
  const [script, setScript] = React.useState<TourScript | null>(null)
  const autoStartedRef = React.useRef(false)

  // Auto-start on first sight of an unseen tour for roles that have a script.
  // Gate on pathname: tour should only appear on the role's natural surface
  // (dashboard / account), never on onboarding, login, or signup.
  React.useEffect(() => {
    if (autoStartedRef.current) return
    if (!user) return
    if (user.hasSeenTour) return
    if (!isTourSurface(pathname, user.role)) return
    // For SUPER_ADMIN, don't start the tour until onboarding is complete
    if (user.role === 'SUPER_ADMIN' && !user.clinic?.tenant?.onboardingCompletedAt) return
    const s = pickScript(user.role)
    if (!s) return
    autoStartedRef.current = true
    const timer = setTimeout(() => {
      setScript(s)
      setStepIndex(0)
      setActive(true)
    }, 1200)
    return () => clearTimeout(timer)
  }, [user, pathname])

  const start = React.useCallback(
    (opts?: StartOptions) => {
      if (!user) return
      const s = pickScript(user.role)
      if (!s) return
      if (!opts?.force && user.hasSeenTour) return
      setScript(s)
      setStepIndex(0)
      setActive(true)
    },
    [user]
  )

  const stop = React.useCallback(() => {
    setActive(false)
  }, [])

  const next = React.useCallback(() => {
    setStepIndex((i) => {
      if (!script) return i
      return Math.min(i + 1, script.steps.length - 1)
    })
  }, [script])

  const prev = React.useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1))
  }, [])

  const persistSeen = React.useCallback(async () => {
    try {
      await api.patch('/auth/me', { hasSeenTour: true })
      patchUser({ hasSeenTour: true, tourCompletedAt: new Date().toISOString() })
    } catch (err) {
      // Non-fatal — tour will just try to auto-start again on next login.
      // eslint-disable-next-line no-console
      clientLog.warn('[TourContext] failed to persist hasSeenTour', err)
    }
  }, [patchUser])

  const skip = React.useCallback(async () => {
    setActive(false)
    await persistSeen()
  }, [persistSeen])

  const finish = React.useCallback(async () => {
    setActive(false)
    await persistSeen()
  }, [persistSeen])

  const value: TourContextValue = {
    isActive: active,
    stepIndex,
    currentStep: active && script ? (script.steps[stepIndex] ?? null) : null,
    script,
    start,
    stop,
    next,
    prev,
    skip,
    finish,
  }

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

export function useTour(): TourContextValue {
  const ctx = React.useContext(TourContext)
  if (!ctx) {
    // Graceful fallback for components rendered outside the provider (e.g. during tests)
    return {
      isActive: false,
      stepIndex: 0,
      currentStep: null,
      script: null,
      start: () => undefined,
      stop: () => undefined,
      next: () => undefined,
      prev: () => undefined,
      skip: async () => undefined,
      finish: async () => undefined,
    }
  }
  return ctx
}
