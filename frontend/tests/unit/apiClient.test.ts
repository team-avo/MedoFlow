/**
 * F0.4.2 (a) — the refresh interceptor: 401 → ONE refresh for every request
 * in flight → each request replayed with the new token; refresh failure →
 * the auth-failure handler runs (AuthProvider then clears data + routes to
 * sign-in). F0.2.3 — the access token is memory-only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import api, {
  CLIENT_HEADER,
  clearAccessToken,
  getAccessToken,
  refreshAccessToken,
  setAccessToken,
  setAuthFailureHandler,
} from '@/lib/api'

type Handler = (config: InternalAxiosRequestConfig) => { status: number; data: unknown }

let handler: Handler
const seen: InternalAxiosRequestConfig[] = []
/** Authorization as sent (axios mutates the config object on replay). */
const sentAuth: (string | undefined)[] = []

const adapter: AxiosAdapter = async (config) => {
  seen.push(config)
  sentAuth.push(isRefresh(config) ? undefined : authHeader(config))
  // Let concurrent requests all reach the adapter before any answer.
  await new Promise((r) => setTimeout(r, 5))
  const { status, data } = handler(config)
  const response = { status, statusText: String(status), headers: {}, config, data }
  if (status >= 400) {
    throw new AxiosError(`status ${status}`, 'ERR_BAD_RESPONSE', config, null, response)
  }
  return response
}

const isRefresh = (c: InternalAxiosRequestConfig) => !!c.url?.includes('/auth/refresh-token')
const authHeader = (c: InternalAxiosRequestConfig) =>
  (c.headers as Record<string, string | undefined>).Authorization

beforeEach(() => {
  seen.length = 0
  sentAuth.length = 0
  api.defaults.adapter = adapter
  axios.defaults.adapter = adapter
  clearAccessToken()
  setAuthFailureHandler(null)
})
afterEach(() => {
  setAuthFailureHandler(null)
  vi.restoreAllMocks()
})

describe('refresh interceptor', () => {
  it('three concurrent 401s trigger exactly one refresh, then all three are replayed and succeed', async () => {
    setAccessToken('expired-token')
    handler = (c) => {
      if (isRefresh(c)) return { status: 200, data: { data: { accessToken: 'fresh-token' } } }
      return authHeader(c) === 'Bearer fresh-token'
        ? { status: 200, data: { ok: c.url } }
        : { status: 401, data: { code: 'token_expired' } }
    }

    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')])

    expect(results.map((r) => r.data.ok)).toEqual(['/a', '/b', '/c'])
    expect(seen.filter(isRefresh)).toHaveLength(1)
    // 3 original attempts + 3 replays, each replay with the new token
    expect(sentAuth.filter((a) => a === 'Bearer expired-token')).toHaveLength(3)
    expect(sentAuth.filter((a) => a === 'Bearer fresh-token')).toHaveLength(3)
    expect(getAccessToken()).toBe('fresh-token')
  })

  it('when refresh fails, requests reject and the auth-failure handler runs with the API code', async () => {
    const onFailure = vi.fn()
    setAuthFailureHandler(onFailure)
    setAccessToken('expired-token')
    handler = (c) =>
      isRefresh(c)
        ? { status: 401, data: { code: 'session_idle_timeout' } }
        : { status: 401, data: {} }

    await expect(api.get('/patients')).rejects.toBeInstanceOf(AxiosError)
    expect(onFailure).toHaveBeenCalledWith({ code: 'session_idle_timeout' })
    expect(getAccessToken()).toBeNull()
  })

  it('a replay that 401s again is not retried a second time (no loop)', async () => {
    setAccessToken('t1')
    handler = (c) =>
      isRefresh(c)
        ? { status: 200, data: { data: { accessToken: 't2' } } }
        : { status: 401, data: {} }
    await expect(api.get('/x')).rejects.toBeInstanceOf(AxiosError)
    expect(seen.filter(isRefresh)).toHaveLength(1)
    expect(seen.filter((c) => !isRefresh(c))).toHaveLength(2)
  })

  it('a 401 from login / MFA verify is a wrong password or code — never a refresh', async () => {
    handler = () => ({ status: 401, data: { code: 'mfa_invalid_code' } })
    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(AxiosError)
    await expect(api.post('/auth/mfa/verify', {})).rejects.toBeInstanceOf(AxiosError)
    expect(seen.filter(isRefresh)).toHaveLength(0)
  })

  it('non-401 errors pass straight through', async () => {
    handler = () => ({ status: 403, data: {} })
    await expect(api.get('/forbidden')).rejects.toMatchObject({ response: { status: 403 } })
    expect(seen.filter(isRefresh)).toHaveLength(0)
  })
})

describe('token storage + CSRF header (F0.2.3)', () => {
  it('the access token never touches localStorage or sessionStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    handler = (c) =>
      isRefresh(c)
        ? { status: 200, data: { data: { accessToken: 'memory-only' } } }
        : { status: 200, data: {} }
    setAccessToken('abc')
    await refreshAccessToken()
    await api.get('/anything')
    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('memory-only')
  })

  it('every API call and the refresh call carry the client header the API requires', async () => {
    handler = (c) =>
      isRefresh(c)
        ? { status: 200, data: { data: { accessToken: 'n' } } }
        : { status: 200, data: {} }
    await api.get('/one')
    await refreshAccessToken()
    for (const c of seen) {
      expect((c.headers as Record<string, string>)[CLIENT_HEADER]).toBe('web')
    }
    expect(seen.find(isRefresh)?.withCredentials).toBe(true)
  })
})
