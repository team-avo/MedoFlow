import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'

/**
 * API client + token handling (F0.2.3 — see docs/FRONTEND_TOKEN_STORAGE.md).
 *
 *  - The access token (15 min) lives in memory only: never localStorage /
 *    sessionStorage, so injected script cannot lift a long-lived copy.
 *  - The refresh token is an HttpOnly cookie set by the API; page script
 *    cannot read it. A reload restores the session with one refresh call.
 *  - A 401 triggers ONE refresh for every request in flight (single-flight),
 *    then each failed request is replayed once. Across tabs, refreshes are
 *    serialised with the Web Locks API so two tabs never present the same
 *    (rotating) refresh token — the backend treats that as token theft.
 *  - Every request carries `X-MedoFlow-Client`; the API refuses refresh and
 *    logout without it (CSRF guard).
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
export const CLIENT_HEADER = 'X-MedoFlow-Client'

/** Pre-F0.2.3 builds kept the access token here; remove any leftover copy. */
const LEGACY_TOKEN_KEY = 'medoflow_access_token'
if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY)
  } catch {
    // storage unavailable (private mode) — nothing to clean up
  }
}

let accessToken: string | null = null
let refreshPromise: Promise<string | null> | null = null

export const setAccessToken = (token: string | null) => {
  accessToken = token
}

export const getAccessToken = () => accessToken

export const clearAccessToken = () => {
  accessToken = null
}

/** Called once when a refresh fails (session ended, idle, revoked). Set by AuthProvider. */
type AuthFailureHandler = (reason: { code?: string }) => void
let onAuthFailure: AuthFailureHandler | null = null
export const setAuthFailureHandler = (handler: AuthFailureHandler | null) => {
  onAuthFailure = handler
}

async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (locks?.request) return locks.request('medoflow-token-refresh', fn) as Promise<T>
  return fn()
}

let lastRefreshFailureCode: string | undefined

/** Exchange the HttpOnly refresh cookie for a new access token. Single-flight. */
export const refreshAccessToken = (): Promise<string | null> => {
  if (refreshPromise) return refreshPromise
  refreshPromise = withRefreshLock(async () => {
    try {
      const { data } = await axios.post(
        `${API_BASE_URL}/api/v1/auth/refresh-token`,
        {},
        { withCredentials: true, headers: { [CLIENT_HEADER]: 'web' } }
      )
      const token: string | null = data?.data?.accessToken ?? null
      setAccessToken(token)
      lastRefreshFailureCode = undefined
      return token
    } catch (err) {
      clearAccessToken()
      lastRefreshFailureCode = (err as AxiosError<{ code?: string }>)?.response?.data?.code
      return null
    }
  }).finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

const api = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    [CLIENT_HEADER]: 'web',
  },
})

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

const isAuthFlowUrl = (url?: string) =>
  !!url &&
  ['/auth/login', '/auth/mfa/verify', '/auth/refresh-token', '/auth/logout'].some((p) =>
    url.includes(p)
  )

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    // Only a 401 on a normal request is worth one refresh + replay.
    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      isAuthFlowUrl(originalRequest.url)
    ) {
      return Promise.reject(error)
    }
    originalRequest._retry = true

    const newToken = await refreshAccessToken()
    if (newToken) {
      originalRequest.headers.Authorization = `Bearer ${newToken}`
      return api(originalRequest)
    }

    // The session is gone (logged out elsewhere, idle timeout, revoked).
    // AuthProvider clears the user + cached data and routes to sign-in.
    const code =
      (error.response?.data as { code?: string } | undefined)?.code ?? lastRefreshFailureCode
    onAuthFailure?.({ code })
    return Promise.reject(error)
  }
)

export default api
