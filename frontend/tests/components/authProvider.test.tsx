/**
 * AuthProvider against a mocked API:
 *  - F0.2.4: after logout the TanStack Query cache is empty (no stale PHI
 *    for the next person at this screen), and on a new login too;
 *  - F0.2.3: a reload restores the session from the HttpOnly cookie
 *    (refresh call), with no token in storage;
 *  - F0.2.2: password step → MFA challenge → session;
 *  - a failed refresh mid-session ends the session and routes to sign-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import api, { clearAccessToken } from '@/lib/api'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'

const replace = vi.fn()
const push = vi.fn()
let pathname = '/dashboard/patients'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, refresh: vi.fn() }),
  usePathname: () => pathname,
}))

const staff = {
  id: 'u1',
  name: 'Synthetic Staff',
  email: 'staff@example.test',
  role: 'FRONT_DESK',
  clinicId: 'c1',
}

type Reply = { status: number; data: unknown }
let routes: Record<string, (c: InternalAxiosRequestConfig) => Reply>
const calls: string[] = []
const adapter: AxiosAdapter = async (config) => {
  const key = `${config.method?.toUpperCase()} ${config.url?.replace(/^.*\/api\/v1/, '')}`
  calls.push(key)
  const route = routes[key]
  const { status, data } = route ? route(config) : { status: 404, data: {} }
  const response = { status, statusText: '', headers: {}, config, data }
  if (status >= 400) throw new AxiosError(`status ${status}`, 'ERR', config, null, response)
  return response
}

let ctx: ReturnType<typeof useAuth>
function Probe() {
  ctx = useAuth()
  return <p data-testid="who">{ctx.isLoading ? 'loading' : (ctx.user?.email ?? 'anonymous')}</p>
}

function renderProvider(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  api.defaults.adapter = adapter
  axios.defaults.adapter = adapter
  clearAccessToken()
  calls.length = 0
  replace.mockReset()
  push.mockReset()
  pathname = '/dashboard/patients'
  routes = {
    'POST /auth/refresh-token': () => ({ status: 401, data: {} }),
    'GET /auth/me': (c) =>
      (c.headers as Record<string, string>).Authorization
        ? {
            status: 200,
            data: { success: true, data: { user: staff, session: { idleTimeoutMinutes: 20 } } },
          }
        : { status: 401, data: {} },
    'POST /auth/logout': () => ({ status: 200, data: {} }),
  }
})
afterEach(() => vi.restoreAllMocks())

describe('session restore (memory-only access token)', () => {
  it('a reload with a valid refresh cookie restores the user and the server idle window', async () => {
    routes['POST /auth/refresh-token'] = () => ({
      status: 200,
      data: { data: { accessToken: 'restored' } },
    })
    renderProvider(new QueryClient())
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('staff@example.test'))
    expect(calls.slice(0, 2)).toEqual(['POST /auth/refresh-token', 'GET /auth/me'])
    expect(ctx.idleTimeoutMinutes).toBe(20)
    expect(JSON.stringify({ ...localStorage })).not.toContain('restored')
  })

  it('no refresh cookie on a protected route → anonymous and sent to sign-in', async () => {
    renderProvider(new QueryClient())
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('anonymous'))
    expect(replace).toHaveBeenCalledWith('/?auth=login&returnUrl=%2Fdashboard%2Fpatients')
    expect(calls).not.toContain('GET /auth/me')
  })
})

describe('logout clears every cached query (F0.2.4)', () => {
  it('cache is empty after logout and the user is gone', async () => {
    routes['POST /auth/login'] = () => ({
      status: 200,
      data: { data: { accessToken: 'a1', user: staff } },
    })
    const client = new QueryClient()
    renderProvider(client)
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('anonymous'))

    await act(async () => {
      await ctx.login('staff@example.test', 'pw')
    })
    client.setQueryData(['patients'], [{ id: 'p1', name: 'Synthetic Patient', dob: '1980-02-03' }])
    client.setQueryData(['visit', 'v1'], { subjective: 'internal note' })
    expect(client.getQueryCache().getAll()).toHaveLength(2)

    await act(async () => {
      await ctx.logout()
    })
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(screen.getByTestId('who')).toHaveTextContent('anonymous')
    expect(calls).toContain('POST /auth/logout')
  })

  it('a new login also starts from an empty cache', async () => {
    routes['POST /auth/login'] = () => ({
      status: 200,
      data: { data: { accessToken: 'a2', user: staff } },
    })
    const client = new QueryClient()
    client.setQueryData(['patients'], [{ id: 'p-from-previous-user' }])
    renderProvider(client)
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('anonymous'))
    await act(async () => {
      await ctx.login('staff@example.test', 'pw')
    })
    expect(client.getQueryData(['patients'])).toBeUndefined()
  })

  it('when the server ends the session (refresh fails mid-session) the cache is cleared and the user is routed to sign-in', async () => {
    routes['POST /auth/refresh-token'] = () => ({
      status: 200,
      data: { data: { accessToken: 'r1' } },
    })
    const client = new QueryClient()
    renderProvider(client)
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('staff@example.test'))
    client.setQueryData(['patients'], [{ id: 'p1' }])

    routes['POST /auth/refresh-token'] = () => ({
      status: 401,
      data: { code: 'session_idle_timeout' },
    })
    routes['GET /patients'] = () => ({ status: 401, data: { code: 'session_idle_timeout' } })
    await act(async () => {
      await api.get('/patients').catch(() => undefined)
    })
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(screen.getByTestId('who')).toHaveTextContent('anonymous')
    expect(replace).toHaveBeenCalledWith(
      '/?auth=login&returnUrl=%2Fdashboard%2Fpatients&reason=idle'
    )
  })
})

describe('MFA sign-in (F0.2.2)', () => {
  it('password step returns a challenge and no session; the second step creates it', async () => {
    routes['POST /auth/login'] = () => ({
      status: 200,
      data: { data: { mfaRequired: true, mfaToken: 'challenge-1' } },
    })
    routes['POST /auth/mfa/verify'] = (c) =>
      JSON.parse(String(c.data)).code === '123456'
        ? { status: 200, data: { data: { accessToken: 'mfa-ok', user: staff } } }
        : { status: 401, data: { code: 'mfa_invalid_code' } }
    renderProvider(new QueryClient())
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('anonymous'))

    let result: Awaited<ReturnType<typeof ctx.login>> | undefined
    await act(async () => {
      result = await ctx.login('staff@example.test', 'pw')
    })
    expect(result).toEqual({ mfaRequired: true, mfaToken: 'challenge-1' })
    expect(screen.getByTestId('who')).toHaveTextContent('anonymous')

    await act(async () => {
      await expect(ctx.verifyMfa('challenge-1', { code: '000000' })).rejects.toBeInstanceOf(
        AxiosError
      )
    })
    expect(screen.getByTestId('who')).toHaveTextContent('anonymous')

    await act(async () => {
      await ctx.verifyMfa('challenge-1', { code: '123456' })
    })
    expect(screen.getByTestId('who')).toHaveTextContent('staff@example.test')
  })
})
