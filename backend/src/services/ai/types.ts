/**
 * The AI scribe's provider contract (B2.1, docs/adr/0006).
 *
 * The scribe pipeline only ever talks to these two interfaces. Which vendor
 * sits behind them — OpenAI, Azure OpenAI, Groq, Gemini / Vertex AI, a
 * self-hosted Ollama or whisper server, or the in-process mock — is chosen
 * by AI_SCRIBE_* configuration (see ./config.ts), so switching vendors is a
 * config change, never a code change.
 */

/** Where a provider runs, for the PHI egress policy (./egressPolicy.ts). */
export type ProviderLocation = 'self-hosted' | 'external' | 'in-process'

/**
 * What is safe to say about a provider: stored on every scribe session as
 * provenance (FR-15) and returned by GET /ai-scribe/capabilities. Never
 * carries keys, credentials or full URLs.
 */
export interface ProviderDescriptor {
  /** Adapter: 'openai-compatible' | 'mock' | 'disabled'. */
  kind: string
  /** Preset the configuration came from, e.g. 'openai', 'gemini', 'ollama'. */
  preset: string
  /** Host name only (no scheme, path or credentials); null for in-process. */
  host: string | null
  model: string
  location: ProviderLocation
}

export interface CallOptions {
  /** Aborts the request (timeouts, job cancellation). */
  signal?: AbortSignal
}

export interface TranscriptionInput {
  audio: Buffer
  mimeType: string
  /** BCP-47 / ISO-639-1 hint, e.g. 'en'. */
  language?: string
}

export interface TranscriptionResult {
  text: string
  model: string
}

export interface SpeechToTextProvider {
  describe(): ProviderDescriptor
  transcribe(input: TranscriptionInput, opts?: CallOptions): Promise<TranscriptionResult>
}

export interface CompletionRequest {
  system: string
  user: string
  /**
   * When set, the model is asked for JSON matching this JSON Schema (draft
   * 2020-12). Adapters that cannot enforce a schema still ask for JSON.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> }
  /** Plain JSON object output, without a schema. Ignored when jsonSchema is set. */
  json?: boolean
  temperature?: number
  maxTokens?: number
}

export interface CompletionResult {
  text: string
  model: string
}

export interface LlmProvider {
  describe(): ProviderDescriptor
  complete(req: CompletionRequest, opts?: CallOptions): Promise<CompletionResult>
}

export interface ScribeAi {
  stt: SpeechToTextProvider
  llm: LlmProvider
}
