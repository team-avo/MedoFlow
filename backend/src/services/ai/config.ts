/**
 * AI scribe configuration (B2.1, docs/adr/0006).
 *
 * Speech-to-text and the LLM are configured independently, so they can be
 * mixed (e.g. OpenAI transcription + Gemini drafting). A preset fills in the
 * base URL, default model, auth style and JSON mode for a known vendor; any
 * of those can be overridden. Everything is read from the environment once,
 * when the registry is built — switching vendors is an env change + restart.
 *
 *   AI_SCRIBE_LLM_PRESET   openai | azure | groq | gemini | vertex-gemini | ollama | custom
 *   AI_SCRIBE_LLM_PROVIDER openai-compatible (default when a preset/base URL is set) | mock | disabled
 *   AI_SCRIBE_LLM_BASE_URL / _API_KEY / _MODEL / _AUTH / _JSON_MODE
 *
 *   AI_SCRIBE_STT_PRESET   openai | azure | groq | gemini | vertex-gemini | whisper-server | custom
 *   AI_SCRIBE_STT_PROVIDER openai-compatible | mock | disabled
 *   AI_SCRIBE_STT_BASE_URL / _API_KEY / _MODEL / _AUTH / _MODE
 *
 *   AI_SCRIBE_TIMEOUT_MS   per request (default 120000)
 *   AI_SCRIBE_LANGUAGE     transcription language hint (default en)
 */

export type AdapterKind = 'openai-compatible' | 'mock' | 'disabled'
/** How the request is authenticated. 'api-key' is Azure's header; 'google-adc' mints Vertex tokens. */
export type AuthStyle = 'bearer' | 'api-key' | 'google-adc' | 'none'
/** How structured output is requested from /chat/completions. */
export type JsonMode = 'json_schema' | 'json_object' | 'none'
/** 'transcriptions' = POST /audio/transcriptions; 'chat-audio' = audio inside a chat message (Gemini). */
export type SttMode = 'transcriptions' | 'chat-audio'

export interface EndpointConfig {
  kind: AdapterKind
  preset: string
  baseUrl: string
  apiKey: string
  model: string
  auth: AuthStyle
}

export interface LlmConfig extends EndpointConfig {
  jsonMode: JsonMode
}

export interface SttConfig extends EndpointConfig {
  mode: SttMode
}

export interface ScribeAiConfig {
  llm: LlmConfig
  stt: SttConfig
  timeoutMs: number
  language: string
  /** Problems that make an endpoint unusable; it is built as 'disabled' instead. */
  problems: string[]
}

interface Preset {
  baseUrl?: string
  auth: AuthStyle
  llmModel?: string
  jsonMode?: JsonMode
  sttModel?: string
  sttMode?: SttMode
  /** STT presets only: no chat model. */
  sttOnly?: boolean
}

/** Known vendors. A missing baseUrl/model means it must be configured explicitly. */
export const PRESETS: Readonly<Record<string, Preset>> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    auth: 'bearer',
    llmModel: 'gpt-4o-mini',
    jsonMode: 'json_schema',
    sttModel: 'whisper-1',
    sttMode: 'transcriptions',
  },
  // Azure OpenAI v1 API: https://<resource>.openai.azure.com/openai/v1, model = deployment name.
  azure: { auth: 'api-key', jsonMode: 'json_schema', sttMode: 'transcriptions' },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    auth: 'bearer',
    llmModel: 'openai/gpt-oss-120b',
    jsonMode: 'json_object',
    sttModel: 'whisper-large-v3-turbo',
    sttMode: 'transcriptions',
  },
  // Gemini Developer API (AI Studio key). NOT BAA-eligible: synthetic data only.
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    auth: 'bearer',
    llmModel: 'gemini-2.5-flash',
    jsonMode: 'json_schema',
    sttModel: 'gemini-2.5-flash',
    sttMode: 'chat-audio',
  },
  // Gemini on Vertex AI (BAA-eligible). Base URL:
  // https://<location>-aiplatform.googleapis.com/v1/projects/<project>/locations/<location>/endpoints/openapi
  'vertex-gemini': {
    auth: 'google-adc',
    llmModel: 'google/gemini-2.5-flash',
    jsonMode: 'json_schema',
    sttModel: 'google/gemini-2.5-flash',
    sttMode: 'chat-audio',
  },
  // Self-hosted Ollama through its OpenAI-compatible /v1 API.
  ollama: {
    baseUrl: 'http://127.0.0.1:11434/v1',
    auth: 'none',
    llmModel: 'llama3.1:8b',
    jsonMode: 'json_object',
  },
  // Any self-hosted OpenAI-compatible whisper server (faster-whisper / speaches, …).
  'whisper-server': {
    baseUrl: 'http://127.0.0.1:8000/v1',
    auth: 'none',
    sttModel: 'Systran/faster-whisper-small',
    sttMode: 'transcriptions',
    sttOnly: true,
  },
  custom: { auth: 'bearer', jsonMode: 'json_object', sttMode: 'transcriptions' },
}

const DEFAULT_TIMEOUT_MS = 120_000

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[]): T | null =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : null

/** Host name of a base URL, or null when it does not parse. */
export function hostOf(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

function resolveEndpoint(
  role: 'LLM' | 'STT',
  env: NodeJS.ProcessEnv,
  problems: string[]
): EndpointConfig & { presetDef: Preset | null } {
  const v = (name: string) => env[`AI_SCRIBE_${role}_${name}`]?.trim() || ''
  const presetName = v('PRESET').toLowerCase()
  const explicitKind = v('PROVIDER').toLowerCase()
  const presetDef = presetName ? (PRESETS[presetName] ?? null) : null

  const off = (kind: AdapterKind, preset: string) => ({
    kind,
    preset,
    baseUrl: '',
    apiKey: '',
    model: kind === 'mock' ? 'mock-scribe-1' : '',
    auth: 'none' as AuthStyle,
    presetDef,
  })

  if (explicitKind === 'mock') return off('mock', 'mock')
  if (explicitKind === 'disabled') return off('disabled', 'disabled')
  if (explicitKind && explicitKind !== 'openai-compatible') {
    problems.push(`AI_SCRIBE_${role}_PROVIDER "${explicitKind}" is not a known provider`)
    return off('disabled', 'disabled')
  }
  if (presetName && !presetDef) {
    problems.push(
      `AI_SCRIBE_${role}_PRESET "${presetName}" is not known (use one of: ${Object.keys(PRESETS).join(', ')})`
    )
    return off('disabled', 'disabled')
  }
  if (!presetName && !v('BASE_URL')) return off('disabled', 'disabled')
  if (role === 'LLM' && presetDef?.sttOnly) {
    problems.push(`AI_SCRIBE_LLM_PRESET "${presetName}" is a speech-to-text preset`)
    return off('disabled', 'disabled')
  }
  if (role === 'STT' && presetDef && !presetDef.sttModel && !v('MODEL')) {
    // e.g. ollama: it has no speech-to-text endpoint.
    problems.push(
      `AI_SCRIBE_STT_PRESET "${presetName}" has no speech-to-text model; pair it with a transcription preset (openai, groq, whisper-server, …)`
    )
    return off('disabled', 'disabled')
  }

  const baseUrl = (v('BASE_URL') || presetDef?.baseUrl || '').replace(/\/+$/, '')
  const model = v('MODEL') || (role === 'LLM' ? presetDef?.llmModel : presetDef?.sttModel) || ''
  const auth = v('AUTH')
    ? oneOf(v('AUTH'), ['bearer', 'api-key', 'google-adc', 'none'] as const)
    : (presetDef?.auth ?? 'bearer')
  const preset = presetName || 'custom'

  if (!baseUrl) problems.push(`AI_SCRIBE_${role}_BASE_URL is required for preset "${preset}"`)
  else if (!hostOf(baseUrl)) problems.push(`AI_SCRIBE_${role}_BASE_URL is not a valid URL`)
  if (!model) problems.push(`AI_SCRIBE_${role}_MODEL is required for preset "${preset}"`)
  if (!auth) problems.push(`AI_SCRIBE_${role}_AUTH must be bearer, api-key, google-adc or none`)

  // One key for both roles when they use the same vendor.
  let apiKey = v('API_KEY')
  if (!apiKey && role === 'STT' && presetName && env.AI_SCRIBE_LLM_PRESET?.trim() === presetName) {
    apiKey = env.AI_SCRIBE_LLM_API_KEY?.trim() || ''
  }
  if ((auth === 'bearer' || auth === 'api-key') && !apiKey) {
    problems.push(`AI_SCRIBE_${role}_API_KEY is required for preset "${preset}"`)
  }

  const usable = baseUrl && hostOf(baseUrl) && model && auth && !problems.length
  return {
    kind: usable ? 'openai-compatible' : 'disabled',
    preset,
    baseUrl,
    apiKey,
    model,
    auth: auth ?? 'none',
    presetDef,
  }
}

export function loadScribeAiConfig(env: NodeJS.ProcessEnv = process.env): ScribeAiConfig {
  const problems: string[] = []

  const llmProblems: string[] = []
  const llmBase = resolveEndpoint('LLM', env, llmProblems)
  const jsonMode =
    oneOf(env.AI_SCRIBE_LLM_JSON_MODE?.trim(), ['json_schema', 'json_object', 'none'] as const) ??
    llmBase.presetDef?.jsonMode ??
    'json_object'
  if (
    env.AI_SCRIBE_LLM_JSON_MODE &&
    !oneOf(env.AI_SCRIBE_LLM_JSON_MODE.trim(), ['json_schema', 'json_object', 'none'])
  ) {
    llmProblems.push('AI_SCRIBE_LLM_JSON_MODE must be json_schema, json_object or none')
  }

  const sttProblems: string[] = []
  const sttBase = resolveEndpoint('STT', env, sttProblems)
  const mode =
    oneOf(env.AI_SCRIBE_STT_MODE?.trim(), ['transcriptions', 'chat-audio'] as const) ??
    sttBase.presetDef?.sttMode ??
    'transcriptions'
  if (
    env.AI_SCRIBE_STT_MODE &&
    !oneOf(env.AI_SCRIBE_STT_MODE.trim(), ['transcriptions', 'chat-audio'])
  ) {
    sttProblems.push('AI_SCRIBE_STT_MODE must be transcriptions or chat-audio')
  }

  problems.push(...llmProblems, ...sttProblems)
  const endpoint = (e: typeof llmBase, failed: boolean): EndpointConfig => ({
    kind: failed ? 'disabled' : e.kind,
    preset: e.preset,
    baseUrl: e.baseUrl,
    apiKey: e.apiKey,
    model: e.model,
    auth: e.auth,
  })

  const timeout = Number.parseInt(env.AI_SCRIBE_TIMEOUT_MS ?? '', 10)
  return {
    llm: { ...endpoint(llmBase, llmProblems.length > 0), jsonMode },
    stt: { ...endpoint(sttBase, sttProblems.length > 0), mode },
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? timeout : DEFAULT_TIMEOUT_MS,
    language: env.AI_SCRIBE_LANGUAGE?.trim() || 'en',
    problems,
  }
}

/**
 * The demo shortcut (POST /ai-scribe/session/:id/simulate) fills a session
 * with a synthetic conversation. On by default outside production; in
 * production only when AI_SCRIBE_DEMO_ENABLED=true (the hosted demo).
 */
export function isScribeDemoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.AI_SCRIBE_DEMO_ENABLED?.trim().toLowerCase()
  if (flag === 'true' || flag === '1') return true
  if (flag === 'false' || flag === '0') return false
  return env.NODE_ENV !== 'production'
}
