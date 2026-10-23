/**
 * B8.2 evidence: transport security of the live app / API / clinic hosts.
 *
 *   npx ts-node --transpile-only scripts/check-domain-posture.ts \
 *     app.medoflow.com api.medoflow.com everwell.medoflow.com \
 *     [--cors-from https://app.medoflow.com --cors-path /api/v1/health]
 *
 * For each host:
 *   TLS 1.0 and 1.1 handshakes are refused by the server   (min TLS 1.2)
 *   TLS 1.2 (and 1.3) handshakes succeed with a valid certificate
 *   https://host/ sends Strict-Transport-Security (max-age ≥ 1 year)
 *   http://host/  answers 301/308 to https
 *   optional: a CORS preflight from --cors-from is allowed
 * Exits 1 when any check fails. Prints one line per check — paste the
 * output into the PR as the B8.2 evidence.
 */
import tls from 'tls'
import http from 'http'
import https from 'https'

type Result = { host: string; check: string; ok: boolean; detail: string }

function handshake(
  host: string,
  version: tls.SecureVersion
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host,
      port: 443,
      servername: host,
      minVersion: version,
      maxVersion: version,
      // Let this client *offer* legacy versions so a refusal is the server's.
      ciphers: 'DEFAULT@SECLEVEL=0',
      rejectUnauthorized: version === 'TLSv1.2' || version === 'TLSv1.3',
      timeout: 10_000,
    })
    socket.once('secureConnect', () => {
      const detail = `${socket.getProtocol()} ${socket.authorized ? 'cert valid' : `cert: ${String(socket.authorizationError)}`}`
      socket.end()
      resolve({ ok: true, detail })
    })
    socket.once('error', (e) => resolve({ ok: false, detail: e.message }))
    socket.once('timeout', () => {
      socket.destroy()
      resolve({ ok: false, detail: 'timeout' })
    })
  })
}

function get(
  url: string,
  headers: Record<string, string> = {},
  method = 'GET'
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.request(url, { method, headers, timeout: 10_000 }, (res) => {
      res.resume()
      resolve(res)
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.end()
  })
}

async function checkHost(host: string, cors?: { from: string; path: string }): Promise<Result[]> {
  const out: Result[] = []
  for (const v of ['TLSv1', 'TLSv1.1'] as const) {
    const r = await handshake(host, v)
    const clientSide = /no protocols available|unsupported protocol/i.test(r.detail) && !r.ok
    out.push({
      host,
      check: `${v} refused`,
      ok: !r.ok && !clientSide,
      detail: r.ok
        ? `accepted (${r.detail})`
        : clientSide
          ? `inconclusive: this Node build cannot offer ${v}`
          : r.detail,
    })
  }
  for (const v of ['TLSv1.2', 'TLSv1.3'] as const) {
    const r = await handshake(host, v)
    out.push({
      host,
      check: `${v} accepted, valid cert`,
      ok: r.ok && r.detail.includes('cert valid'),
      detail: r.detail,
    })
  }
  try {
    const res = await get(`https://${host}/`)
    const hsts = String(res.headers['strict-transport-security'] ?? '')
    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0)
    out.push({ host, check: 'HSTS ≥ 1 year', ok: maxAge >= 31536000, detail: hsts || 'missing' })
  } catch (e) {
    out.push({ host, check: 'HSTS ≥ 1 year', ok: false, detail: (e as Error).message })
  }
  try {
    const res = await get(`http://${host}/`)
    const loc = String(res.headers.location ?? '')
    out.push({
      host,
      check: 'http → https redirect',
      ok: [301, 308].includes(res.statusCode ?? 0) && loc.startsWith('https://'),
      detail: `${res.statusCode} ${loc}`,
    })
  } catch (e) {
    out.push({ host, check: 'http → https redirect', ok: false, detail: (e as Error).message })
  }
  if (cors) {
    try {
      const res = await get(
        `https://${host}${cors.path}`,
        { origin: cors.from, 'access-control-request-method': 'GET' },
        'OPTIONS'
      )
      const allow = String(res.headers['access-control-allow-origin'] ?? '')
      out.push({
        host,
        check: `CORS from ${cors.from}`,
        ok: allow === cors.from,
        detail: allow || 'no Access-Control-Allow-Origin',
      })
    } catch (e) {
      out.push({ host, check: `CORS from ${cors.from}`, ok: false, detail: (e as Error).message })
    }
  }
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (name: string) => {
    const i = args.indexOf(name)
    if (i < 0) return undefined
    const v = args[i + 1]
    args.splice(i, 2)
    return v
  }
  const corsFrom = opt('--cors-from')
  const corsPath = opt('--cors-path') ?? '/api/v1/health'
  if (args.length === 0) {
    process.stderr.write(
      'usage: check-domain-posture.ts <host> [<host>…] [--cors-from <origin> --cors-path <path>]\n'
    )
    process.exit(2)
  }
  let failed = 0
  for (const host of args) {
    for (const r of await checkHost(
      host,
      corsFrom ? { from: corsFrom, path: corsPath } : undefined
    )) {
      if (!r.ok) failed++
      const detail = r.detail.replace(/\s+/g, ' ').slice(0, 140)
      process.stdout.write(
        `${r.ok ? 'PASS' : 'FAIL'}  ${r.host.padEnd(32)} ${r.check.padEnd(28)} ${detail}\n`
      )
    }
  }
  process.stdout.write(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n')
  process.exitCode = failed ? 1 : 0
}

void main()
