'use client'

/**
 * VoiceAgentTester — Groq-powered push-to-talk voice agent.
 *
 * Flow per turn:
 *   1. User holds the big Talk button (mouse/touch) → MediaRecorder captures mic.
 *   2. Release → blob uploads to POST /voice-agent/turn.
 *   3. Backend: Groq Whisper STT → Llama with tools → tool exec → reply.
 *   4. We render transcript bubbles and speak the reply via SpeechSynthesis.
 *
 * The first turn is preceded by a spoken greeting from the clinic config.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Mic, Phone, PhoneOff, Volume2, AlertCircle, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { voiceAgentApi, type TranscriptEntry } from '@/lib/voiceAgentApi'
import { useAppToast } from '@/hooks/useAppToast'
import { clientLog } from '@/lib/clientLog'

type CallState = 'idle' | 'starting' | 'live' | 'listening' | 'thinking' | 'speaking' | 'ending'

// Module-level handle so subsequent calls can stop the previous audio.
let currentAudio: HTMLAudioElement | null = null

const stopAudio = () => {
  if (currentAudio) {
    try {
      currentAudio.pause()
      currentAudio.src = ''
    } catch {
      /* noop */
    }
    currentAudio = null
  }
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* noop */
  }
}

const playBase64Audio = (base64: string, mime: string, onEnd?: () => void): Promise<void> => {
  return new Promise((resolve) => {
    stopAudio()
    try {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: mime || 'audio/wav' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      currentAudio = audio
      const done = () => {
        URL.revokeObjectURL(url)
        if (currentAudio === audio) currentAudio = null
        onEnd?.()
        resolve()
      }
      audio.onended = done
      audio.onerror = done
      audio.play().catch(done)
    } catch {
      onEnd?.()
      resolve()
    }
  })
}

// Fallback to browser SpeechSynthesis when the server didn't return audio.
const fallbackSpeak = (text: string, onEnd?: () => void) => {
  if (!('speechSynthesis' in window) || !text) {
    onEnd?.()
    return
  }
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = 1.02
  const voices = window.speechSynthesis.getVoices()
  const preferred = voices.find((v) => /samantha|nicky|aria|joanna/i.test(v.name))
  if (preferred) u.voice = preferred
  u.onend = () => onEnd?.()
  u.onerror = () => onEnd?.()
  window.speechSynthesis.speak(u)
}

const speakResponse = async (
  audioBase64: string | undefined,
  audioMime: string | undefined,
  fallbackText: string,
  onEnd?: () => void
) => {
  if (audioBase64) {
    await playBase64Audio(audioBase64, audioMime ?? 'audio/wav', onEnd)
  } else {
    fallbackSpeak(fallbackText, onEnd)
  }
}

export function VoiceAgentTester() {
  const [state, setState] = useState<CallState>('idle')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [toolEvents, setToolEvents] = useState<Array<{ name: string; args: unknown; ts: number }>>(
    []
  )
  const [error, setError] = useState<string | null>(null)
  const [callId, setCallId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const callIdRef = useRef<string | null>(null)
  const transcriptRef = useRef<TranscriptEntry[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const startTimeRef = useRef<number>(0)

  const toast = useAppToast()

  // Elapsed-time ticker
  useEffect(() => {
    if (state === 'idle' || state === 'starting' || state === 'ending') return
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [state])

  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])
  useEffect(() => {
    callIdRef.current = callId
  }, [callId])

  useEffect(() => {
    return () => {
      teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const teardown = () => {
    try {
      mediaRecorderRef.current?.state !== 'inactive' && mediaRecorderRef.current?.stop()
    } catch {
      /* noop */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    audioChunksRef.current = []
    stopAudio()
  }

  const append = (entry: TranscriptEntry) => setTranscript((prev) => [...prev, entry])

  const startCall = async () => {
    setError(null)
    setTranscript([])
    setToolEvents([])
    setState('starting')

    try {
      // Mic permission early — if denied, fail fast.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const call = await voiceAgentApi.startCall()
      setCallId(call.id)
      callIdRef.current = call.id

      // Fetch the clinic's configured greeting + pre-rendered audio.
      let greeting = 'Hi! Thanks for calling. How can I help you today?'
      let greetingAudio: string | undefined
      let greetingMime: string | undefined
      try {
        const g = await voiceAgentApi.getGreeting()
        if (g.greeting) greeting = g.greeting
        greetingAudio = g.audioBase64
        greetingMime = g.audioMime
      } catch {
        // fall back to default text only
      }

      append({ role: 'assistant', content: greeting, ts: Date.now() })
      startTimeRef.current = Date.now()
      setElapsed(0)
      setState('speaking')
      void speakResponse(greetingAudio, greetingMime, greeting, () => setState('live'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start call'
      setError(msg)
      toast.error(msg)
      teardown()
      setState('idle')
    }
  }

  const beginRecording = () => {
    const stream = streamRef.current
    if (!stream || state !== 'live') return
    audioChunksRef.current = []
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    const recorder = new MediaRecorder(stream, { mimeType: mime })
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data)
    }
    recorder.start()
    mediaRecorderRef.current = recorder
    setState('listening')
  }

  const finishRecording = async () => {
    const recorder = mediaRecorderRef.current
    const id = callIdRef.current
    if (!recorder || !id) return
    if (recorder.state === 'inactive') return

    const stopPromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType })
        resolve(blob)
      }
    })
    recorder.stop()
    setState('thinking')

    try {
      const blob = await stopPromise
      if (blob.size < 1000) {
        // Too short — just go back to live.
        setState('live')
        return
      }
      const result = await voiceAgentApi.runTurn(id, blob, recorder.mimeType)
      if (result.userText) {
        append({ role: 'user', content: result.userText, ts: Date.now() })
      }
      if (result.toolCalls && result.toolCalls.length > 0) {
        setToolEvents((prev) => [
          ...prev,
          ...result.toolCalls.map((t) => ({
            name: t.name,
            args: t.args,
            ts: Date.now(),
          })),
        ])
      }
      append({ role: 'assistant', content: result.assistantText, ts: Date.now() })
      setState('speaking')
      void speakResponse(result.audioBase64, result.audioMime, result.assistantText, () =>
        setState('live')
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Turn failed'
      setError(msg)
      toast.error(msg)
      setState('live')
    }
  }

  const endCall = async () => {
    if (state === 'idle' || state === 'ending') return
    setState('ending')
    const dur = Math.floor((Date.now() - startTimeRef.current) / 1000)
    stopAudio()
    teardown()
    const id = callIdRef.current
    if (id) {
      try {
        await voiceAgentApi.endCall(id, {
          status: 'COMPLETED',
          transcript: transcriptRef.current,
          durationSec: dur,
        })
        voiceAgentApi.summarizeCall(id).catch(() => {})
      } catch (err) {
        clientLog.error('[voice-agent] end-call save failed', err)
      }
    }
    setCallId(null)
    callIdRef.current = null
    setState('idle')
  }

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  // ── Click-to-toggle handler (more intuitive than push-to-talk)
  const onTalkClick = () => {
    if (state === 'listening') {
      void finishRecording()
      return
    }
    if (state === 'speaking') {
      // Barge-in — interrupt the agent and start listening immediately.
      stopAudio()
      setState('live')
      // After state flush, begin recording.
      setTimeout(() => beginRecording(), 0)
      return
    }
    if (state === 'live') beginRecording()
  }

  const statusLabel = (() => {
    switch (state) {
      case 'idle':
        return { tone: 'idle', text: 'Ready' }
      case 'starting':
        return { tone: 'pending', text: 'Connecting…' }
      case 'live':
        return { tone: 'live', text: `LIVE · ${fmtTime(elapsed)}` }
      case 'listening':
        return { tone: 'listening', text: 'Listening…' }
      case 'thinking':
        return { tone: 'pending', text: 'Thinking…' }
      case 'speaking':
        return { tone: 'speaking', text: 'Speaking…' }
      case 'ending':
        return { tone: 'pending', text: 'Ending…' }
    }
  })()

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
      {/* ─── Left: phone-call UI ─────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-hairline bg-gradient-to-br from-navy via-navy to-[#142a48] p-8 text-white shadow-card">
        <div className="flex items-start justify-between">
          <div>
            <p className="mf-eyebrow text-teal-bright">Live test · Groq</p>
            <h2 className="mf-display mt-2 text-[22px] text-white">Talk to your AI front desk</h2>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-white/60">
              Click <span className="text-white">Call agent</span>, then{' '}
              <span className="text-white">click the mic to start speaking</span>. Click again to
              send. Try: <em>"I'd like to book an appointment with Dr. Wilson tomorrow."</em>
            </p>
          </div>
          <StatusBadge label={statusLabel.text} tone={statusLabel.tone} />
        </div>

        {/* Talk button */}
        <div className="my-10 flex items-center justify-center">
          <div className="relative flex h-44 w-44 items-center justify-center">
            <AnimatePresence>
              {state === 'listening' && (
                <>
                  <motion.div
                    key="l1"
                    className="absolute inset-0 rounded-full bg-rose-400/30"
                    animate={{ scale: [1, 1.6, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 1.4, repeat: Infinity }}
                  />
                  <motion.div
                    key="l2"
                    className="absolute inset-2 rounded-full bg-rose-400/40"
                    animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ duration: 1.4, repeat: Infinity, delay: 0.3 }}
                  />
                </>
              )}
              {state === 'speaking' && (
                <motion.div
                  key="s1"
                  className="absolute inset-0 rounded-full bg-teal-bright/20"
                  animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                />
              )}
              {state === 'thinking' && (
                <motion.div
                  key="t1"
                  className="absolute inset-0 rounded-full border-2 border-amber-300/50"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                  style={{ borderTopColor: 'transparent' }}
                />
              )}
            </AnimatePresence>

            <button
              type="button"
              onClick={onTalkClick}
              disabled={
                state === 'idle' ||
                state === 'starting' ||
                state === 'thinking' ||
                state === 'ending'
              }
              className={`relative flex h-32 w-32 items-center justify-center rounded-full transition-all ${
                state === 'listening'
                  ? 'bg-rose-500 text-white shadow-[0_0_80px_-10px_rgba(244,63,94,0.8)] hover:scale-[1.02] active:scale-95'
                  : state === 'live'
                    ? 'bg-teal-bright text-navy shadow-[0_0_80px_-10px_rgba(94,234,212,0.8)] hover:scale-[1.02] active:scale-95'
                    : state === 'speaking'
                      ? 'bg-teal-bright/70 text-navy ring-2 ring-white/20 hover:scale-[1.02] active:scale-95'
                      : 'bg-white/[0.06] text-white/40 ring-1 ring-white/10'
              }`}
              aria-label={
                state === 'listening'
                  ? 'Click to send'
                  : state === 'speaking'
                    ? 'Click to interrupt'
                    : 'Click to talk'
              }
            >
              {state === 'thinking' ? (
                <Loader2 className="h-10 w-10 animate-spin" />
              ) : (
                <Mic className="h-10 w-10" strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center justify-center gap-3">
          {state === 'idle' ? (
            <button
              onClick={startCall}
              className="inline-flex items-center gap-2 rounded-full bg-teal-bright px-6 py-3 text-[14px] font-semibold text-navy shadow-[0_10px_30px_-8px_rgba(94,234,212,0.7)] transition-shadow hover:shadow-[0_14px_40px_-8px_rgba(94,234,212,0.95)]"
            >
              <Phone className="h-4 w-4" />
              Call agent
            </button>
          ) : state === 'starting' ? (
            <button
              disabled
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 text-[14px] font-medium text-white/60"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Connecting…
            </button>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <p className="text-[12px] text-white/60">
                {state === 'live'
                  ? 'Click the mic to start speaking'
                  : state === 'listening'
                    ? 'Listening… click again when you’re done'
                    : state === 'thinking'
                      ? 'Hang on, working on it…'
                      : state === 'speaking'
                        ? 'Agent is replying — click mic to interrupt'
                        : ''}
              </p>
              <button
                onClick={endCall}
                className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-5 py-2.5 text-[13px] font-medium text-white/80 ring-1 ring-white/10 transition-colors hover:bg-white/[0.1]"
              >
                <PhoneOff className="h-3.5 w-3.5" />
                Hang up
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-6 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[12px] text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" strokeWidth={2} />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-white/10 pt-5 text-[11px] text-white/45">
          <Volume2 className="h-3 w-3" strokeWidth={2} />
          Powered by Groq Whisper + Llama 3.3 · ~1-2s round-trip per turn
        </div>
      </div>

      {/* ─── Right: live transcript + tool log ───────────────────────── */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <p className="mf-eyebrow text-ink-muted">Live transcript</p>
          <span className="text-[11px] text-ink-faint">
            {transcript.length} {transcript.length === 1 ? 'turn' : 'turns'}
          </span>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5 min-h-[420px] max-h-[600px]">
          {transcript.length === 0 && state !== 'live' && state !== 'starting' && (
            <div className="flex h-full flex-col items-center justify-center py-20 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-wash text-teal">
                <Mic className="h-5 w-5" strokeWidth={1.5} />
              </div>
              <p className="mt-4 text-[13px] font-medium text-ink">
                Press <span className="text-teal">Call agent</span> to begin
              </p>
              <p className="mt-1 text-[12px] text-ink-muted">
                Transcript will stream here as you speak
              </p>
            </div>
          )}

          {transcript.map((m, i) => (
            <motion.div
              key={`${m.ts}-${i}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
                  m.role === 'user'
                    ? 'rounded-br-sm bg-navy text-white'
                    : 'rounded-bl-sm bg-canvas text-ink ring-1 ring-hairline'
                }`}
              >
                {m.content}
              </div>
            </motion.div>
          ))}

          {toolEvents.length > 0 && (
            <div className="mt-6 border-t border-hairline pt-4">
              <p className="mf-eyebrow mb-2 text-ink-muted">Tool calls</p>
              <div className="space-y-1.5">
                {toolEvents.map((t, i) => (
                  <div
                    key={`${t.ts}-${i}`}
                    className="flex items-center gap-2 rounded-md bg-teal-wash px-2.5 py-1.5 text-[11px] text-teal"
                  >
                    <span className="font-mono font-medium">{t.name}</span>
                    <span className="text-teal/60 truncate">
                      {JSON.stringify(t.args).slice(0, 60)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ label, tone }: { label: string; tone: string }) {
  const dotCls =
    tone === 'live'
      ? 'bg-emerald-400'
      : tone === 'listening'
        ? 'bg-rose-400'
        : tone === 'thinking'
          ? 'bg-amber-300 animate-pulse'
          : tone === 'speaking'
            ? 'bg-teal-bright'
            : tone === 'pending'
              ? 'bg-amber-300 animate-pulse'
              : 'bg-white/40'
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium text-white/70">
      <span className="relative flex h-1.5 w-1.5">
        {tone === 'live' && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotCls}`} />
      </span>
      {label}
    </div>
  )
}
