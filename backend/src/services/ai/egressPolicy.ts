/**
 * PHI egress policy for the AI scribe (FR-13, B2.7, docs/adr/0006).
 *
 * Audio and transcripts are PHI. They may only leave our infrastructure for
 * a vendor that has signed a BAA with zero-retention confirmed in writing.
 * AI_SCRIBE_BAA_HOSTS mirrors that part of the BAA register
 * (docs/HIPAA_COMPLIANCE_CHECKLIST.md §1.2): a host is added only once its
 * BAA is on file. In production the app refuses to boot when the scribe
 * points anywhere else (envValidation.ts → validateProductionEnv).
 */
import net from 'net'
import { hostOf, loadScribeAiConfig, type EndpointConfig, type ScribeAiConfig } from './config'

/**
 * The Gemini Developer API (AI Studio keys) cannot be covered by a BAA
 * (PRD §9.2). Production Gemini goes through Vertex AI instead.
 */
const NEVER_PHI_HOSTS = new Set(['generativelanguage.googleapis.com'])

/** Loopback, RFC 1918 / ULA, link-local, and single-label or internal names (docker services). */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h.endsWith('.internal') || h.endsWith('.local') || h.endsWith('.svc')) return true
  const ipVersion = net.isIP(h)
  if (ipVersion === 4) {
    const [a, b] = h.split('.').map(Number) as [number, number]
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    )
  }
  if (ipVersion === 6)
    return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')
  return !h.includes('.')
}

const isLoopback = (host: string): boolean => {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h === '::1' || h.startsWith('127.')
}

export function baaHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.AI_SCRIBE_BAA_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  )
}

export interface EgressProblem {
  /** Blocks a production boot. */
  fatal: boolean
  message: string
  /** A missing BAA (not a transport or test-only problem): see SYNTHETIC_ONLY. */
  baa?: boolean
}

/**
 * The one explicit opt-out: an environment that holds synthetic data only
 * (docs/PHI_GATE.md — the hosted demo) may use an AI vendor without a BAA.
 * The value must be exactly this phrase; plain http and the mock provider
 * stay fatal, and every boot prints a warning naming the vendor.
 */
export const SYNTHETIC_ONLY = 'synthetic-data-only'

function endpointProblems(
  role: 'LLM' | 'STT',
  cfg: EndpointConfig,
  allowed: Set<string>,
  isProduction: boolean
): EgressProblem[] {
  const out: EgressProblem[] = []
  const name = `AI_SCRIBE_${role}`
  if (cfg.kind === 'mock') {
    if (isProduction) out.push({ fatal: true, message: `${name}_PROVIDER=mock is for tests only` })
    return out
  }
  if (cfg.kind !== 'openai-compatible') return out

  const host = hostOf(cfg.baseUrl)
  if (!host) return out
  const https = cfg.baseUrl.toLowerCase().startsWith('https://')

  if (NEVER_PHI_HOSTS.has(host)) {
    out.push({
      fatal: true,
      message: `${name} points at the Gemini Developer API (${host}), which cannot be covered by a BAA — use the vertex-gemini preset for real patient data`,
      baa: true,
    })
    return out
  }
  if (isPrivateHost(host)) {
    // Self-hosted: no PHI leaves our network, but it still crosses the wire.
    if (!https && !isLoopback(host)) {
      out.push({
        fatal: false,
        message: `${name}_BASE_URL uses plain http to ${host}; put the self-hosted model behind TLS on a private network`,
      })
    }
    return out
  }
  if (!https) {
    out.push({
      fatal: true,
      message: `${name}_BASE_URL must use https:// for an external host (${host})`,
    })
  }
  if (!allowed.has(host)) {
    out.push({
      fatal: true,
      message: `${name} sends PHI to ${host}, which is not in AI_SCRIBE_BAA_HOSTS — add it only after its BAA and zero-retention are confirmed in writing`,
      baa: true,
    })
  }
  return out
}

/** Every policy problem with the current scribe configuration. */
export function scribeEgressProblems(
  env: NodeJS.ProcessEnv = process.env,
  cfg: ScribeAiConfig = loadScribeAiConfig(env)
): EgressProblem[] {
  const isProduction = env.NODE_ENV === 'production'
  const allowed = baaHosts(env)
  const out: EgressProblem[] = cfg.problems.map((message) => ({ fatal: false, message }))
  const endpoint = [
    ...endpointProblems('LLM', cfg.llm, allowed, isProduction),
    ...endpointProblems('STT', cfg.stt, allowed, isProduction),
  ]
  const syntheticOnly = env.AI_SCRIBE_PHI_POLICY?.trim() === SYNTHETIC_ONLY
  for (const p of endpoint) {
    out.push(
      syntheticOnly && p.baa
        ? {
            fatal: false,
            baa: true,
            message: `AI_SCRIBE_PHI_POLICY=${SYNTHETIC_ONLY}: allowed for synthetic data only — ${p.message}`,
          }
        : p
    )
  }
  if (cfg.llm.kind === 'disabled' || cfg.stt.kind === 'disabled') {
    out.push({
      fatal: false,
      message:
        'The AI scribe is not fully configured (AI_SCRIBE_LLM_* / AI_SCRIBE_STT_*) — recording and drafting are unavailable',
    })
  }
  return out
}
