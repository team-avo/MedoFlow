'use client'

import { usePathname, useRouter } from 'next/navigation'
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import api, {
  clearAccessToken,
  getAccessToken,
  refreshAccessToken,
  setAccessToken,
  setAuthFailureHandler,
} from '@/lib/api'
import { clientLog } from '@/lib/clientLog'
import { loginRedirect, setSessionEndReason } from '@/lib/routeGuards'
import type { User } from '@/lib/types'
import { IdleTimeoutManager } from '@/components/auth/IdleTimeoutManager'

/** Server default (SESSION_IDLE_TIMEOUT_MINUTES); replaced by the value /auth/me reports. */
const DEFAULT_IDLE_TIMEOUT_MINUTES = 15

export type LoginResult =
  | { mfaRequired: false; user: User }
  | { mfaRequired: true; mfaToken: string }

export type MfaFactor = { code: string } | { recoveryCode: string }

/** Why a session ended locally — drives the message on the sign-in screen. */
export type SessionEndReason = 'user' | 'idle' | 'expired'

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  idleTimeoutMinutes: number
  /** Password step. Staff with MFA get `{ mfaRequired: true, mfaToken }` instead of a session. */
  login: (email: string, password: string, clinicId?: string | null) => Promise<LoginResult>
  /** Second step of an MFA sign-in (TOTP or a one-time recovery code). */
  verifyMfa: (mfaToken: string, factor: MfaFactor) => Promise<User>
  logout: (reason?: SessionEndReason) => Promise<void>
  getCurrentUser: () => Promise<User | null>
  refetchUser: () => Promise<User | null>
  /** Optimistic local merge; useful for updating tour/preference flags without a round-trip */
  patchUser: (partial: Partial<User>) => void
  markPatientTourSeen: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const PROTECTED_PREFIXES = ['/dashboard', '/account', '/platform']

function isProtectedRoute(pathname: string | null): boolean {
  if (!pathname) return false
  return PROTECTED_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

export function landingForRole(user: Pick<User, 'role'>): string {
  return user.role === 'PATIENT' ? '/' : '/dashboard'
}

type AuthPayload = { accessToken: string; user: User }
type MePayload = { user: User; session?: { idleTimeoutMinutes?: number } }

const AUTH_CHANNEL = 'medoflow-auth'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(DEFAULT_IDLE_TIMEOUT_MINUTES)
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname
  const channelRef = useRef<BroadcastChannel | null>(null)

  /**
   * Drop everything this tab holds for the signed-in user: the in-memory
   * token, the user object and every cached query (no stale PHI is left for
   * the next person at this screen — F0.2.4). Then route to sign-in.
   */
  const endSessionLocally = useCallback(
    (reason: SessionEndReason, opts: { broadcast: boolean }) => {
      setSessionEndReason(reason === 'user' ? null : reason)
      clearAccessToken()
      setUser(null)
      queryClient.cancelQueries()
      queryClient.clear()
      if (opts.broadcast) channelRef.current?.postMessage({ type: 'logout', reason })

      const current = pathnameRef.current
      if (reason === 'user') {
        // On a clinic site, stay on the clinic landing — never bounce to the
        // Medoflow marketing root.
        router.push(current?.startsWith('/clinic/') ? current : '/')
        return
      }
      if (isProtectedRoute(current)) {
        router.replace(loginRedirect(current))
      }
    },
    [queryClient, router]
  )

  const getCurrentUser = useCallback(async (): Promise<User | null> => {
    try {
      const { data } = await api.get<{ success: boolean; data: MePayload }>('/auth/me')
      if (data.success && data.data.user) {
        setUser(data.data.user)
        const minutes = data.data.session?.idleTimeoutMinutes
        if (typeof minutes === 'number' && minutes > 0) setIdleTimeoutMinutes(minutes)
        return data.data.user
      }
      return null
    } catch {
      clearAccessToken()
      setUser(null)
      return null
    }
  }, [])

  const startSession = useCallback(
    async (payload: AuthPayload | undefined, message?: string): Promise<User> => {
      if (!payload?.accessToken || !payload?.user) {
        throw new Error(message || 'Invalid response from server')
      }
      // A new identity must never see the previous one's cached data.
      setSessionEndReason(null)
      queryClient.clear()
      setAccessToken(payload.accessToken)
      setUser(payload.user)
      // /auth/me carries the full profile and the session's idle window.
      return (await getCurrentUser()) ?? payload.user
    },
    [getCurrentUser, queryClient]
  )

  const login = useCallback(
    async (email: string, password: string, clinicId?: string | null): Promise<LoginResult> => {
      // `clinicId` (slug or cuid) is forwarded so the backend can reject
      // cross-clinic logins from a clinic-branded sign-in surface. Backend
      // returns the same generic 401 for safety.
      const { data } = await api.post<{
        success: boolean
        message?: string
        data: Partial<AuthPayload> & { mfaRequired?: boolean; mfaToken?: string }
      }>('/auth/login', { email, password, clinicId })
      const payload = data?.data
      if (payload?.mfaRequired && payload.mfaToken) {
        return { mfaRequired: true, mfaToken: payload.mfaToken }
      }
      const signedIn = await startSession(payload as AuthPayload, data?.message)
      return { mfaRequired: false, user: signedIn }
    },
    [startSession]
  )

  const verifyMfa = useCallback(
    async (mfaToken: string, factor: MfaFactor): Promise<User> => {
      const { data } = await api.post<{ success: boolean; message?: string; data: AuthPayload }>(
        '/auth/mfa/verify',
        { mfaToken, ...factor }
      )
      return startSession(data?.data, data?.message)
    },
    [startSession]
  )

  const logout = useCallback(
    async (reason: SessionEndReason = 'user') => {
      try {
        await api.post('/auth/logout')
      } catch {
        // The server session may already be gone (idle/revoked); clear locally regardless.
      } finally {
        endSessionLocally(reason, { broadcast: true })
      }
    },
    [endSessionLocally]
  )

  const markPatientTourSeen = useCallback(async () => {
    try {
      await api.post('/auth/patient-tour-seen')
      setUser((prev) => (prev ? { ...prev, hasSeenPatientTour: true } : prev))
    } catch (err) {
      clientLog.error('Failed to mark tour as seen', err)
    }
  }, [])

  // A failed refresh anywhere (session revoked, idle timeout on the server,
  // logged out in another browser) ends the session in this tab.
  useEffect(() => {
    setAuthFailureHandler(({ code }) => {
      endSessionLocally(code === 'session_idle_timeout' ? 'idle' : 'expired', { broadcast: true })
    })
    return () => setAuthFailureHandler(null)
  }, [endSessionLocally])

  // Sign-out in one tab signs out every tab of this browser.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(AUTH_CHANNEL)
    channelRef.current = channel
    channel.onmessage = (event: MessageEvent<{ type?: string; reason?: SessionEndReason }>) => {
      if (event.data?.type === 'logout') {
        endSessionLocally(event.data.reason ?? 'user', { broadcast: false })
      }
    }
    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [endSessionLocally])

  // Restore the session once on mount: the access token is memory-only, so
  // a reload exchanges the HttpOnly refresh cookie for a new one.
  useEffect(() => {
    let cancelled = false
    const restore = async () => {
      try {
        const token = getAccessToken() ?? (await refreshAccessToken())
        const restored = token ? await getCurrentUser() : null
        if (!cancelled && !restored && isProtectedRoute(pathnameRef.current)) {
          router.replace(loginRedirect(pathnameRef.current))
        }
      } catch (err) {
        clientLog.error('Auth initialization error', err)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
    // Mount only: later navigations are guarded by the layouts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patchUser = useCallback((partial: Partial<User>) => {
    setUser((current) => (current ? { ...current, ...partial } : current))
  }, [])

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    idleTimeoutMinutes,
    login,
    verifyMfa,
    logout,
    getCurrentUser,
    refetchUser: getCurrentUser,
    patchUser,
    markPatientTourSeen,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      {user && (
        <IdleTimeoutManager
          timeoutMinutes={idleTimeoutMinutes}
          onTimeout={() => void logout('idle')}
        />
      )}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
