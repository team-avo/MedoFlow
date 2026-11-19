/**
 * "Is this domain really live?" (CTO-38): one HTTPS request to the clinic's
 * domain. A valid certificate (fetch refuses a bad one) plus the HSTS header
 * the app Worker adds to every response (frontend/cf-worker.js) proves the
 * request went through Cloudflare's certificate to our front door. 200 is
 * the primary domain; 301/308 is a verified alias redirecting to it.
 *
 * Only called once DNS is verified, i.e. the name CNAMEs to our target.
 */
export type HttpsProbe = (hostname: string) => Promise<{ ok: boolean; detail: string }>

const TIMEOUT_MS = 5_000

export const probeHttps: HttpsProbe = async (hostname) => {
  try {
    const res = await fetch(`https://${hostname}/robots.txt`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    await res.body?.cancel().catch(() => undefined)
    const hsts = res.headers.get('strict-transport-security')
    if (![200, 301, 308].includes(res.status)) {
      return { ok: false, detail: `https://${hostname} answered ${res.status}` }
    }
    if (!hsts) return { ok: false, detail: `https://${hostname} is not served by MedoFlow yet` }
    return { ok: true, detail: 'ok' }
  } catch (err) {
    // fetch reports TLS problems on `cause` (e.g. ERR_TLS_CERT_ALTNAME_INVALID).
    const cause = (err as { cause?: { code?: string; message?: string } }).cause
    const msg = `${(err as Error).message ?? ''} ${cause?.code ?? ''} ${cause?.message ?? ''}`
    return {
      ok: false,
      detail: /certificate|SSL|TLS/i.test(msg)
        ? `The HTTPS certificate for ${hostname} isn't ready yet`
        : `https://${hostname} can't be reached yet`,
    }
  }
}

let override: HttpsProbe | null = null
export const httpsProbe = (): HttpsProbe => override ?? probeHttps

/** Tests: replace the network probe (null restores it). */
export function setHttpsProbeForTests(p: HttpsProbe | null): void {
  override = p
}
