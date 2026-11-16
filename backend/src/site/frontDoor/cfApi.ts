/**
 * One Cloudflare API call with the account's Pages token (CTO-26, CTO-38).
 * Shared by the front-door launcher and the Pages custom-domain provider.
 *
 * Errors carry Cloudflare's own message only (never the token or the request
 * body) and the HTTP status. Requests time out after 15 s.
 */
export const CF_API = 'https://api.cloudflare.com/client/v4'
const TIMEOUT_MS = 15_000

export type FetchLike = typeof fetch

export class PagesError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

export interface PagesConfig {
  token: string
  accountId: string
  project: string
}

export function pagesConfig(env: NodeJS.ProcessEnv = process.env): PagesConfig | null {
  const token = env.CF_PAGES_API_TOKEN?.trim()
  const accountId = env.CF_ACCOUNT_ID?.trim()
  if (!token || !accountId) return null
  return { token, accountId, project: env.CF_PAGES_PROJECT?.trim() || 'medoflow' }
}

export function projectPath(cfg: PagesConfig): string {
  return `/accounts/${encodeURIComponent(cfg.accountId)}/pages/projects/${encodeURIComponent(cfg.project)}`
}

export async function cfCall<T>(
  cfg: Pick<PagesConfig, 'token'>,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike = fetch
): Promise<T> {
  const res = await fetchImpl(`${CF_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${cfg.token}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = (await res.json().catch(() => null)) as {
    success?: boolean
    result?: T
    errors?: Array<{ message?: string }>
  } | null
  if (!res.ok || !body?.success) {
    const msg = body?.errors?.[0]?.message ?? `Cloudflare answered ${res.status}`
    throw new PagesError(msg.slice(0, 200), res.status)
  }
  return body.result as T
}
