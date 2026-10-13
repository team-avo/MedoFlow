/**
 * Text-to-speech for the AI Front Desk.
 *
 * Primary: Groq (Canopy Labs Orpheus) — same API key as the rest of the
 * voice agent (Whisper STT + Llama tool-calling), so the whole agent runs
 * on a single credential.
 *
 * Fallback: Gemini TTS, used only when GEMINI_API_KEY is present AND Groq
 * fails. This exists so the voice keeps working while Groq's model terms are
 * pending acceptance. Once Groq TTS is verified, GEMINI_API_KEY can be
 * dropped from the environment entirely and this path never runs.
 *
 * If both fail, `speak()` in voiceAgentService soft-fails and the browser
 * falls back to its built-in speech synthesis — the agent stays usable.
 */

import type { ApiError } from '../types/errors'
import type { VoicePersona } from '@prisma/client'

// ─────────────────────────── Groq (primary) ──────────────────────────

const GROQ_SPEECH_ENDPOINT = 'https://api.groq.com/openai/v1/audio/speech'
const GROQ_TTS_MODEL = process.env.GROQ_TTS_MODEL || 'canopylabs/orpheus-v1-english'

// Persona → Orpheus voice. Override per-clinic via VoiceAgentConfig.voice,
// or globally via env, without touching code.
const personaToGroqVoice: Record<VoicePersona, string> = {
  WARM: process.env.GROQ_VOICE_WARM || 'hannah',
  PROFESSIONAL: process.env.GROQ_VOICE_PROFESSIONAL || 'troy',
  UPBEAT: process.env.GROQ_VOICE_UPBEAT || 'austin',
}

// ─────────────────────────── Gemini (fallback) ───────────────────────

const GEMINI_TTS_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent'

const personaToGeminiVoice: Record<VoicePersona, string> = {
  WARM: 'Kore',
  PROFESSIONAL: 'Charon',
  UPBEAT: 'Puck',
}

// ─────────────────────────── Types ───────────────────────────────────

export interface SynthesisOptions {
  persona?: VoicePersona
  /** Explicit voice override — wins over the persona mapping. */
  voiceName?: string
}

export interface SynthesisResult {
  audioBase64: string
  mimeType: 'audio/wav'
  voice: string
  provider: 'groq' | 'gemini'
}

// ─────────────────────────── WAV helpers (Gemini path) ───────────────

/** Build a 44-byte RIFF/WAVE header for raw 16-bit signed mono PCM. */
const buildWavHeader = (pcmByteLength: number, sampleRate: number): Buffer => {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8
  const buf = Buffer.alloc(44)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + pcmByteLength, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(numChannels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(bitsPerSample, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(pcmByteLength, 40)
  return buf
}

const parseRateFromMime = (mime: string, fallback = 24000): number => {
  const m = /rate=(\d+)/.exec(mime)
  return m ? Number(m[1]) : fallback
}

// ─────────────────────────── Providers ───────────────────────────────

const synthesizeWithGroq = async (
  text: string,
  opts: SynthesisOptions
): Promise<SynthesisResult> => {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    const err = new Error('GROQ_API_KEY not configured for TTS') as ApiError
    err.statusCode = 503
    err.code = 'tts_not_configured'
    throw err
  }

  const voice = opts.voiceName ?? personaToGroqVoice[opts.persona ?? 'WARM']

  const response = await fetch(GROQ_SPEECH_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_TTS_MODEL,
      voice,
      input: text,
      response_format: 'wav',
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    // Surface the terms gate explicitly — it's a one-click fix in the console,
    // not a code problem, and the generic 400 is not self-explanatory.
    if (body.includes('model_terms_required')) {
      const err = new Error(
        `Groq TTS model "${GROQ_TTS_MODEL}" requires one-time terms acceptance. ` +
          `An org admin must accept them at https://console.groq.com/playground?model=${encodeURIComponent(GROQ_TTS_MODEL)}`
      ) as ApiError
      err.statusCode = 503
      err.code = 'tts_terms_required'
      throw err
    }
    const err = new Error(`Groq TTS failed (${response.status}): ${body}`) as ApiError
    err.statusCode = 502
    err.code = 'tts_failed'
    throw err
  }

  // Groq returns the audio file directly as binary.
  const audio = Buffer.from(await response.arrayBuffer())
  if (audio.length === 0) {
    const err = new Error('Groq TTS returned empty audio') as ApiError
    err.statusCode = 502
    throw err
  }

  return {
    audioBase64: audio.toString('base64'),
    mimeType: 'audio/wav',
    voice,
    provider: 'groq',
  }
}

const synthesizeWithGemini = async (
  text: string,
  opts: SynthesisOptions
): Promise<SynthesisResult> => {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY not configured') as ApiError
    err.statusCode = 503
    err.code = 'tts_not_configured'
    throw err
  }

  const voice = opts.voiceName ?? personaToGeminiVoice[opts.persona ?? 'WARM']

  const response = await fetch(`${GEMINI_TTS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const err = new Error(`Gemini TTS failed (${response.status}): ${body}`) as ApiError
    err.statusCode = 502
    err.code = 'tts_failed'
    throw err
  }

  type GeminiTtsResponse = {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }
    }>
  }
  const data = (await response.json()) as GeminiTtsResponse
  const inline = data.candidates?.[0]?.content?.parts?.[0]?.inlineData
  if (!inline?.data) {
    const err = new Error('Gemini TTS returned no audio') as ApiError
    err.statusCode = 502
    throw err
  }

  // Gemini returns raw PCM — wrap it in a WAV header so browsers can play it.
  const pcm = Buffer.from(inline.data, 'base64')
  const wav = Buffer.concat([
    buildWavHeader(pcm.length, parseRateFromMime(inline.mimeType ?? '')),
    pcm,
  ])

  return {
    audioBase64: wav.toString('base64'),
    mimeType: 'audio/wav',
    voice,
    provider: 'gemini',
  }
}

// ─────────────────────────── Public API ──────────────────────────────

/**
 * Synthesize speech. Tries Groq first; falls back to Gemini only if a
 * GEMINI_API_KEY is configured. Throws if no provider succeeds — callers
 * are expected to soft-fail (the browser then uses its own speech synthesis).
 */
export const synthesize = async (
  text: string,
  opts: SynthesisOptions = {}
): Promise<SynthesisResult> => {
  try {
    return await synthesizeWithGroq(text, opts)
  } catch (groqErr) {
    if (!process.env.GEMINI_API_KEY) throw groqErr
    console.warn(
      '[tts] Groq TTS unavailable, falling back to Gemini:',
      groqErr instanceof Error ? groqErr.message : groqErr
    )
    return synthesizeWithGemini(text, opts)
  }
}
