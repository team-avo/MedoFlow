/**
 * Retired-host redirects for the medoflow.pages.dev -> medoflow.com migration.
 *
 * Runs at the very top of the Cloudflare Worker (cf-worker.js), before anything
 * else, so a request that still arrives on a retired free address is answered
 * with a 308 to the equivalent medoflow.com address. A 308 keeps the method and
 * body, so a form POST or an API call to an old address still works. Requests on
 * the new root, on a clinic's own custom domain, or anywhere else return null and
 * are served unchanged.
 *
 *   medoflow.pages.dev / <worker>.workers.dev  -> https://medoflow.com<path>
 *   <label>.medoflow.pages.dev                 -> https://<label>.medoflow.com<path>
 *   reserved or Pages preview-hash host        -> https://medoflow.com/  (never a
 *                                                 made-up clinic address)
 *
 * Controlled by two runtime Worker vars (set by .github/workflows/deploy.yml):
 *   LEGACY_ROOT_DOMAINS  comma list of retired roots, e.g.
 *                        "medoflow.pages.dev,medoflow-web.advertout-medoflow.workers.dev"
 *   SITE_ROOT_DOMAIN     the new root, e.g. "medoflow.com"
 *
 * When LEGACY_ROOT_DOMAINS is empty the function is a no-op, so merging this code
 * changes nothing for users until the operator sets the var at cut-over.
 *
 * (This is about host migration. The per-clinic /clinic/* URL moves live in
 * legacyRedirect.ts.)
 */

export interface RetiredHostEnv {
  LEGACY_ROOT_DOMAINS?: string
  SITE_ROOT_DOMAIN?: string
}

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** A Cloudflare Pages preview deployment alias, e.g. "a1b2c3d4.medoflow.pages.dev". */
const PREVIEW_HASH_RE = /^[0-9a-f]{8}$/

/** Labels under the new root that never belong to a clinic (mirror of host.ts). */
const RESERVED_LABELS: ReadonlySet<string> = new Set([
  'www',
  'app',
  'api',
  'admin',
  'dashboard',
  'mail',
  'smtp',
  'pop',
  'imap',
  'ns1',
  'ns2',
  'ftp',
  'cdn',
  'media',
  'assets',
  'static',
  'status',
  'help',
  'support',
  'blog',
  'docs',
  'dev',
  'staging',
  'medoflow',
  'sites',
  'preview',
])

function cleanRoot(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '')
}

/**
 * A 308 Response to the medoflow.com equivalent of a retired address, or null to
 * serve the request unchanged.
 */
export function retiredHostRedirect(requestUrl: string, env: RetiredHostEnv): Response | null {
  const roots = (env.LEGACY_ROOT_DOMAINS || '').split(',').map(cleanRoot).filter(Boolean)
  if (roots.length === 0) return null

  const newRoot = cleanRoot(env.SITE_ROOT_DOMAIN || '')
  if (!newRoot) return null

  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')

  for (const root of roots) {
    let target: string | null = null
    if (host === root) {
      target = `https://${newRoot}`
    } else if (host.endsWith(`.${root}`)) {
      const label = host.slice(0, -(root.length + 1))
      const perLabel =
        !label.includes('.') &&
        LABEL_RE.test(label) &&
        !RESERVED_LABELS.has(label) &&
        !PREVIEW_HASH_RE.test(label)
      // A real clinic label keeps its subdomain; anything else lands on the app root.
      target = perLabel ? `https://${label}.${newRoot}` : `https://${newRoot}`
    }
    if (target !== null) {
      return new Response(null, {
        status: 308,
        headers: { location: `${target}${url.pathname}${url.search}` },
      })
    }
  }
  return null
}
