import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { PrismaClient } from '@prisma/client'
import app from '../../app'

/** Owner connection: bypasses RLS. Fixtures and raw verification only. */
export const adminDb = new PrismaClient({
  datasourceUrl: process.env.INTEGRATION_ADMIN_DATABASE_URL,
})

export interface TestServer {
  url: string
  close: () => Promise<void>
}

export async function startServer(): Promise<TestServer> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

export interface ApiResponse<T = any> {
  status: number
  body: T
  headers: Headers
  setCookie: string[]
}

export async function api<T = any>(
  base: string,
  path: string,
  opts: {
    method?: string
    token?: string
    body?: unknown
    cookie?: string
    headers?: Record<string, string>
  } = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  if (opts.cookie) headers.cookie = opts.cookie
  let body: string | undefined
  if (opts.body !== undefined) {
    headers['content-type'] ??= 'application/json'
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
  }
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
  })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    /* keep text */
  }
  return {
    status: res.status,
    body: parsed as T,
    headers: res.headers,
    setCookie: res.headers.getSetCookie(),
  }
}

export interface LoginResult {
  accessToken: string
  refreshCookie: string
  userId: string
}

export async function login(
  base: string,
  email: string,
  password = FIXTURE_PASSWORD
): Promise<LoginResult> {
  const res = await api(base, '/auth/login', { body: { email, password } })
  if (res.status !== 200 || !res.body?.data?.accessToken) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return {
    accessToken: res.body.data.accessToken,
    refreshCookie: refreshCookieFrom(res.setCookie),
    userId: res.body.data.user.id,
  }
}

export function refreshCookieFrom(setCookie: string[]): string {
  const c = setCookie.find((x) => x.startsWith('refreshToken='))
  return c ? c.split(';')[0]! : ''
}

export const FIXTURE_PASSWORD = 'Synthetic-Test-Pass-2026'
