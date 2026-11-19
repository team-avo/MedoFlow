/**
 * Cloudflare Pages front door, from the backend (CTO-26). Replaces running
 * .github/workflows/front-door.yml by hand for each clinic.
 *
 * Every clinic deployment is the same tiny worker: it hands each request to
 * the app Worker over the project's `APP` service binding, and the app reads
 * the address (<label>.medoflow.pages.dev) to know which clinic it is. So a
 * clinic going live is one Direct Upload deployment of that worker to the
 * branch <label>. The project and its service bindings (production and
 * preview) are set up once by the front-door workflow.
 *
 * Least privilege: CF_PAGES_API_TOKEN needs only Account · Cloudflare Pages ·
 * Edit, and never leaves the server. Requests time out after 15 s.
 */
import { cfCall, pagesConfig, projectPath, type FetchLike, type PagesConfig } from './cfApi'

export { pagesConfig, PagesError, type PagesConfig } from './cfApi'

/** The worker every clinic branch serves (advanced mode `_worker.js`). */
export const FRONT_DOOR_WORKER = `// MedoFlow front door: pass every request to the app unchanged.
export default { fetch: (request, env) => env.APP.fetch(request) }
`
export const FRONT_DOOR_ROUTES = '{ "version": 1, "include": ["/*"], "exclude": [] }'

export class PagesClient {
  constructor(
    private readonly cfg: PagesConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  private call<T>(path: string, init: RequestInit): Promise<T> {
    return cfCall<T>(this.cfg, path, init, this.fetchImpl)
  }

  private projectPath() {
    return projectPath(this.cfg)
  }

  /** Deploys the front door to branch `label`. Returns the deployment id and address. */
  async deployBranch(label: string): Promise<{ id: string; url: string }> {
    const form = new FormData()
    form.append('manifest', '{}')
    form.append('branch', label)
    form.append(
      '_worker.js',
      new Blob([FRONT_DOOR_WORKER], { type: 'application/javascript+module' }),
      '_worker.js'
    )
    form.append(
      '_routes.json',
      new Blob([FRONT_DOOR_ROUTES], { type: 'application/json' }),
      '_routes.json'
    )
    const result = await this.call<{ id: string; url?: string }>(
      `${this.projectPath()}/deployments`,
      {
        method: 'POST',
        body: form,
      }
    )
    return { id: result.id, url: `https://${label}.${this.cfg.project}.pages.dev` }
  }

  /** Removes every deployment of branch `label` (off-boarding). Returns how many. */
  async deleteBranch(label: string): Promise<number> {
    const list = await this.call<
      Array<{ id: string; deployment_trigger?: { metadata?: { branch?: string } } }>
    >(`${this.projectPath()}/deployments?env=preview`, { method: 'GET' })
    const mine = list.filter((d) => d.deployment_trigger?.metadata?.branch === label)
    for (const d of mine) {
      await this.call(`${this.projectPath()}/deployments/${encodeURIComponent(d.id)}?force=true`, {
        method: 'DELETE',
      })
    }
    return mine.length
  }
}

let override: Pick<PagesClient, 'deployBranch' | 'deleteBranch'> | null = null
/** Tests: a stubbed Cloudflare (null restores the real one). */
export function setPagesClientForTests(
  c: Pick<PagesClient, 'deployBranch' | 'deleteBranch'> | null
) {
  override = c
}

/** The client, or null when Cloudflare isn't configured on this server. */
export function getPagesClient(): Pick<PagesClient, 'deployBranch' | 'deleteBranch'> | null {
  if (override) return override
  const cfg = pagesConfig()
  return cfg ? new PagesClient(cfg) : null
}
