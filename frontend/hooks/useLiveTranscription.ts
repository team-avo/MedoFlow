'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Live captions while a consultation is recorded (demo feedback WS2).
 *
 * The main recorder (useAudioRecorder) keeps one continuous recording for the
 * clinical transcript. This hook taps the same microphone stream with a
 * second MediaRecorder that is stopped and restarted every few seconds, so
 * each segment is a complete, decodable file. Segments go to the server one
 * by one (at most `maxInFlight` at a time) and the text comes back as caption
 * lines. If the server falls behind, the oldest waiting segments are dropped
 * and `delayed` is set: captions should stay close to "now".
 *
 * Everything is kept in memory and gone when the component unmounts; the
 * captions are a preview, not the record.
 */
export interface LiveLine {
  seq: number
  /** Seconds since captions started. */
  at: number
  text: string
}

export interface UseLiveTranscriptionOptions {
  stream: MediaStream | null
  enabled: boolean
  transcribe: (segment: Blob, seq: number) => Promise<string>
  segmentMs?: number
  maxInFlight?: number
  /** Waiting segments kept before the oldest are dropped. */
  maxQueued?: number
}

export interface UseLiveTranscriptionReturn {
  lines: LiveLine[]
  /** Segments were dropped because the server fell behind. */
  delayed: boolean
  /** The last failure, if captions are currently failing. */
  error: string | null
  /** Captions are running (stream present and enabled). */
  active: boolean
}

function segmentMimeType(): string {
  for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(mime)) return mime
  }
  return 'audio/webm'
}

export function useLiveTranscription({
  stream,
  enabled,
  transcribe,
  segmentMs = 6000,
  maxInFlight = 2,
  maxQueued = 3,
}: UseLiveTranscriptionOptions): UseLiveTranscriptionReturn {
  const [lines, setLines] = useState<LiveLine[]>([])
  const [delayed, setDelayed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const transcribeRef = useRef(transcribe)
  transcribeRef.current = transcribe
  // Each capture run has a generation; results from an older run (a previous
  // recording) are ignored once a new one starts.
  const generation = useRef(0)
  const active = !!stream && enabled

  useEffect(() => {
    if (!stream || !enabled || typeof MediaRecorder === 'undefined') return
    const gen = ++generation.current
    const isCurrent = () => gen === generation.current
    let stopped = false
    let seq = 0
    let inFlight = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let current: MediaRecorder | null = null
    const firstStart = Date.now()
    const waiting: { seq: number; at: number; blob: Blob }[] = []
    const mimeType = segmentMimeType()

    const pump = () => {
      while (inFlight < maxInFlight && waiting.length > 0) {
        const item = waiting.shift()!
        inFlight += 1
        transcribeRef
          .current(item.blob, item.seq)
          .then((text) => {
            if (!isCurrent()) return
            setError(null)
            const clean = text.trim()
            if (!clean) return
            setLines((prev) =>
              [...prev, { seq: item.seq, at: item.at, text: clean }].sort((a, b) => a.seq - b.seq)
            )
          })
          .catch((err: unknown) => {
            if (!isCurrent()) return
            const message =
              (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
              'Live captions are unavailable right now'
            setError(message)
          })
          .finally(() => {
            inFlight -= 1
            if (isCurrent() && waiting.length === 0 && inFlight === 0) setDelayed(false)
            pump()
          })
      }
    }

    const enqueue = (item: { seq: number; at: number; blob: Blob }) => {
      waiting.push(item)
      while (waiting.length > maxQueued) {
        waiting.shift()
        if (isCurrent()) setDelayed(true)
      }
      pump()
    }

    const startSegment = () => {
      if (stopped) return
      let recorder: MediaRecorder
      try {
        recorder = new MediaRecorder(stream, { mimeType })
      } catch {
        setError('Live captions are not supported in this browser')
        return
      }
      const chunks: Blob[] = []
      const mySeq = seq++
      const at = Math.round((Date.now() - firstStart) / 1000)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType })
        if (blob.size > 0) enqueue({ seq: mySeq, at, blob })
        startSegment()
      }
      current = recorder
      recorder.start()
      timer = setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop()
      }, segmentMs)
    }

    startSegment()
    return () => {
      // The last, partial segment is still sent (onstop runs after this) and
      // its caption still shows, until a new recording starts.
      stopped = true
      if (timer) clearTimeout(timer)
      if (current && current.state !== 'inactive') current.stop()
    }
  }, [stream, enabled, segmentMs, maxInFlight, maxQueued])

  // A new recording starts with a clean caption panel.
  useEffect(() => {
    if (stream) {
      setLines([])
      setDelayed(false)
      setError(null)
    }
  }, [stream])

  return { lines, delayed, error, active }
}
