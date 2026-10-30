/**
 * One adapter for every OpenAI-compatible API (B2.1): OpenAI, Azure OpenAI
 * (v1), Groq, Gemini (Developer API and Vertex AI), Ollama's /v1, vLLM,
 * LM Studio and self-hosted whisper servers. Plain fetch, no SDK.
 *
 *   chat  POST {base}/chat/completions
 *   stt   POST {base}/audio/transcriptions          (mode 'transcriptions')
 *         POST {base}/chat/completions + input_audio (mode 'chat-audio', Gemini)
 *
 * Failures surface as AiError with a fixed, PHI-free message; provider error
 * bodies are never read into messages or logs (they can echo the prompt).
 */
import { AiError, aiErrorForStatus, aiErrorForThrown } from './errors'
import { getGoogleAccessToken } from './googleAuth'
import { hostOf, type EndpointConfig, type LlmConfig, type SttConfig } from './config'
import type {
  CallOptions,
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ProviderDescriptor,
  SpeechToTextProvider,
  TranscriptionInput,
  TranscriptionResult,
} from './types'
import { isPrivateHost } from './egressPolicy'

export interface HttpDeps {
  fetchImpl?: typeof fetch
  timeoutMs: number
}

function describeEndpoint(cfg: EndpointConfig): ProviderDescriptor {
  const host = hostOf(cfg.baseUrl)
  return {
    kind: 'openai-compatible',
    preset: cfg.preset,
    host,
    model: cfg.model,
    location: host && isPrivateHost(host) ? 'self-hosted' : 'external',
  }
}

async function authHeaders(cfg: EndpointConfig): Promise<Record<string, string>> {
  switch (cfg.auth) {
    case 'bearer':
      return { Authorization: `Bearer ${cfg.apiKey}` }
    case 'api-key':
      return { 'api-key': cfg.apiKey }
    case 'google-adc':
      return { Authorization: `Bearer ${await getGoogleAccessToken()}` }
    default:
      return {}
  }
}

/** POST to the endpoint with a timeout that really cancels the request. */
async function post(
  cfg: EndpointConfig,
  deps: HttpDeps,
  path: string,
  body: string | FormData,
  contentType: string | null,
  opts: CallOptions
): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeout = AbortSignal.timeout(deps.timeoutMs)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  let res: Response
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(await authHeaders(cfg)),
    }
    if (contentType) headers['Content-Type'] = contentType
    res = await fetchImpl(`${cfg.baseUrl}${path}`, { method: 'POST', headers, body, signal })
  } catch (e) {
    throw aiErrorForThrown(e)
  }
  if (!res.ok) {
    // Drain without reading the body into anything: it may echo the prompt.
    await res.body?.cancel().catch(() => undefined)
    throw aiErrorForStatus(res.status)
  }
  try {
    return await res.json()
  } catch (e) {
    throw (e as { name?: string })?.name === 'AbortError'
      ? aiErrorForThrown(e)
      : new AiError('ai_bad_output')
  }
}

interface ChatCompletionResponse {
  model?: string
  choices?: Array<{ message?: { content?: unknown } }>
}

/** The assistant text of a chat completion (string, or OpenAI-style content parts). */
function messageText(data: unknown): string {
  const content = (data as ChatCompletionResponse)?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string'
          ? (p as { text: string }).text
          : ''
      )
      .join('')
  }
  return ''
}

export class OpenAiCompatibleLlm implements LlmProvider {
  constructor(
    private readonly cfg: LlmConfig,
    private readonly deps: HttpDeps
  ) {}

  describe(): ProviderDescriptor {
    return describeEndpoint(this.cfg)
  }

  async complete(req: CompletionRequest, opts: CallOptions = {}): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      temperature: req.temperature ?? 0.2,
      stream: false,
    }
    if (req.maxTokens) body.max_tokens = req.maxTokens
    const wantsJson = Boolean(req.jsonSchema) || Boolean(req.json)
    if (wantsJson && this.cfg.jsonMode === 'json_schema' && req.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: false },
      }
    } else if (wantsJson && this.cfg.jsonMode !== 'none') {
      body.response_format = { type: 'json_object' }
    }

    const data = await post(
      this.cfg,
      this.deps,
      '/chat/completions',
      JSON.stringify(body),
      'application/json',
      opts
    )
    const text = messageText(data).trim()
    if (!text) throw new AiError('ai_bad_output')
    return { text, model: (data as ChatCompletionResponse).model || this.cfg.model }
  }
}

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/flac': 'flac',
}

/** File extension for an audio MIME type ("audio/webm;codecs=opus" → "webm"). */
export function audioExtension(mimeType: string): string {
  return AUDIO_EXTENSIONS[mimeType.split(';')[0]!.trim().toLowerCase()] ?? 'webm'
}

const TRANSCRIBE_SYSTEM =
  'You are a medical transcriptionist. Transcribe the audio verbatim, in the language spoken. ' +
  'Output only the transcript text: no commentary, no headings, no summary.'

export class OpenAiCompatibleStt implements SpeechToTextProvider {
  constructor(
    private readonly cfg: SttConfig,
    private readonly deps: HttpDeps
  ) {}

  describe(): ProviderDescriptor {
    return describeEndpoint(this.cfg)
  }

  async transcribe(
    input: TranscriptionInput,
    opts: CallOptions = {}
  ): Promise<TranscriptionResult> {
    if (input.audio.length === 0) throw new AiError('ai_rejected')
    const ext = audioExtension(input.mimeType)

    if (this.cfg.mode === 'chat-audio') {
      const body = {
        model: this.cfg.model,
        temperature: 0,
        stream: false,
        messages: [
          { role: 'system', content: TRANSCRIBE_SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this consultation recording.' },
              {
                type: 'input_audio',
                input_audio: { data: input.audio.toString('base64'), format: ext },
              },
            ],
          },
        ],
      }
      const data = await post(
        this.cfg,
        this.deps,
        '/chat/completions',
        JSON.stringify(body),
        'application/json',
        opts
      )
      const text = messageText(data).trim()
      if (!text) throw new AiError('ai_bad_output')
      return { text, model: (data as ChatCompletionResponse).model || this.cfg.model }
    }

    const form = new FormData()
    form.append(
      'file',
      new Blob([new Uint8Array(input.audio)], { type: input.mimeType.split(';')[0] }),
      `consultation.${ext}`
    )
    form.append('model', this.cfg.model)
    form.append('response_format', 'json')
    if (input.language) form.append('language', input.language)
    // fetch sets the multipart boundary itself.
    const data = await post(this.cfg, this.deps, '/audio/transcriptions', form, null, opts)
    const text =
      typeof (data as { text?: unknown })?.text === 'string'
        ? (data as { text: string }).text.trim()
        : ''
    if (!text) throw new AiError('ai_bad_output')
    return { text, model: this.cfg.model }
  }
}
