/**
 * Groq client — Whisper STT + Llama chat with tool calling.
 *
 * Groq is OpenAI-compatible (same /v1/* shape) so we can use the OpenAI SDK
 * format directly. Two endpoints we use:
 *   - POST /openai/v1/audio/transcriptions  (Whisper Large v3 Turbo)
 *   - POST /openai/v1/chat/completions      (Llama 3.3 70B with tools)
 *
 * Why Groq: their LPU inference is 5-10× faster than OpenAI for the same
 * Llama-class model, which gives us sub-second response time per turn.
 */

import type { ApiError } from '../types/errors'

const GROQ_BASE = 'https://api.groq.com/openai/v1'
const GROQ_STT_MODEL = 'whisper-large-v3-turbo'

// Primary first, then fallbacks. Each model has its OWN per-day token budget
// on Groq's free tier, so when one hits the daily cap we just try the next.
const GROQ_LLM_MODELS = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'llama-3.1-8b-instant',
] as const

const getApiKey = (): string => {
  const key = process.env.GROQ_API_KEY
  if (!key) {
    const err = new Error('GROQ_API_KEY not configured') as ApiError
    err.statusCode = 503
    err.code = 'groq_not_configured'
    throw err
  }
  return key
}

// ─────────────────────────── Transcription ───────────────────────────

export interface TranscriptionResult {
  text: string
  durationSec?: number
}

export const transcribe = async (
  audio: Buffer,
  mimeType: string,
  filename = 'audio.webm'
): Promise<TranscriptionResult> => {
  const form = new FormData()
  // Copy into a fresh ArrayBuffer so Blob accepts it across Node TS lib versions.
  const ab = audio.buffer.slice(
    audio.byteOffset,
    audio.byteOffset + audio.byteLength
  ) as ArrayBuffer
  const blob = new Blob([ab], { type: mimeType })
  form.append('file', blob, filename)
  form.append('model', GROQ_STT_MODEL)
  form.append('response_format', 'verbose_json')
  form.append('temperature', '0')

  const response = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getApiKey()}` },
    body: form,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const err = new Error(`Groq STT failed (${response.status}): ${text}`) as ApiError
    err.statusCode = 502
    err.code = 'groq_stt_failed'
    throw err
  }

  const data = (await response.json()) as {
    text: string
    duration?: number
  }
  return { text: data.text?.trim() ?? '', durationSec: data.duration }
}

// ─────────────────────────── Chat with tools ─────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: ChatToolCall[]
}

export interface ChatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatResponse {
  content: string | null
  toolCalls: ChatToolCall[]
  finishReason: string
}

const callGroqChat = async (
  model: string,
  messages: ChatMessage[],
  tools: ChatTool[],
  opts: { temperature?: number; toolChoice?: 'auto' | 'required' | 'none' }
): Promise<{ ok: true; data: ChatResponse } | { ok: false; status: number; body: string }> => {
  const response = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? (opts.toolChoice ?? 'auto') : undefined,
      temperature: opts.temperature ?? 0.3,
      max_tokens: 800,
    }),
  })

  if (!response.ok) {
    return { ok: false, status: response.status, body: await response.text().catch(() => '') }
  }

  const data = (await response.json()) as {
    choices: Array<{
      message: { content: string | null; tool_calls?: ChatToolCall[] }
      finish_reason: string
    }>
  }
  const choice = data.choices[0]
  return {
    ok: true,
    data: {
      content: choice?.message?.content ?? null,
      toolCalls: choice?.message?.tool_calls ?? [],
      finishReason: choice?.finish_reason ?? 'unknown',
    },
  }
}

const isQuotaError = (status: number, body: string): boolean => {
  if (status === 429) return true
  return /rate_limit|quota|too many|tokens per day/i.test(body)
}

export const chatWithTools = async (
  messages: ChatMessage[],
  tools: ChatTool[],
  opts: { temperature?: number; toolChoice?: 'auto' | 'required' | 'none' } = {}
): Promise<ChatResponse> => {
  let lastBody = ''
  let lastStatus = 0
  for (const model of GROQ_LLM_MODELS) {
    const r = await callGroqChat(model, messages, tools, opts)
    if (r.ok) return r.data
    lastStatus = r.status
    lastBody = r.body
    // Try to salvage tool_use_failed regardless of which model said it.
    const salvaged = trySalvageToolUseFailure(r.body)
    if (salvaged) return salvaged
    // If it's not a quota issue, no point trying another model — fail now.
    if (!isQuotaError(r.status, r.body)) break
    console.warn(`[groq] ${model} quota-limited, falling back to next model`)
  }

  const err = new Error(`Groq chat failed (${lastStatus}): ${lastBody}`) as ApiError
  err.statusCode = 502
  err.code = 'groq_chat_failed'
  throw err
}

/**
 * Parse Groq's `tool_use_failed` error body and rebuild a ChatResponse with
 * the function call the model tried to make. Returns null if the body
 * doesn't fit that shape, so callers fall back to throwing.
 *
 * Accepts both `<function=name>{args}</function>` and the malformed
 * `<function=name{args}</function>` variants Llama 3.x produces.
 */
const trySalvageToolUseFailure = (bodyText: string): ChatResponse | null => {
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { code?: string; failed_generation?: string }
    }
    if (parsed.error?.code !== 'tool_use_failed') return null
    const fg = parsed.error.failed_generation ?? ''

    // Very permissive — match <function=NAME …{args}…></function> in any of:
    //  <function=NAME>{args}</function>
    //  <function=NAME{args}</function>
    //  <function=NAME {args}></function>
    //  <function=NAME {args}</function>
    // We look for the function name, then the first `{...}` JSON block
    // before the closing </function>.
    const re = /<function\s*=\s*([a-z_][a-z0-9_]*)[^{]*?(\{[\s\S]*?\})\s*>?\s*<\/function>/gi
    const calls: ChatToolCall[] = []
    let cleaned = fg
    let m: RegExpExecArray | null
    while ((m = re.exec(fg)) !== null) {
      const name = m[1]!
      let argsJson = (m[2] ?? '').trim() || '{}'
      try {
        JSON.parse(argsJson)
      } catch {
        argsJson = '{}'
      }
      calls.push({
        id: `salvage_${Date.now()}_${calls.length}`,
        type: 'function',
        function: { name, arguments: argsJson },
      })
      cleaned = cleaned.replace(m[0], '').trim()
    }

    if (calls.length === 0) return null
    return {
      content: cleaned || null,
      toolCalls: calls,
      finishReason: 'tool_calls',
    }
  } catch {
    return null
  }
}
