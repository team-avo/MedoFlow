'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiErrorOf } from '@/lib/apiError'
import {
  EMPTY_STATS,
  isMeasurable,
  MAX_SAMPLES,
  nowMs,
  summarize,
  type CaptionLatencyStats,
  type LatencySample,
} from '@/lib/liveCaptionStats'
import {
  initPacing,
  onDropped,
  onRoundTrip,
  onThrottled,
  type PacingState,
} from '@/lib/liveSegmentPacing'

/**
 * Live captions while a consultation is recorded (demo feedback WS2, refined
 * by CTO-41).
 *
 * The main recorder (useAudioRecorder) keeps one continuous recording for the
 * clinical transcript. This hook taps the same microphone stream with a
 * second MediaRecorder that is stopped and restarted every few seconds, so
 * each segment is a complete, decodable file. Segments go to the server one
 * by one (at most `maxInFlight` at a time) and the text comes back as caption
 * lines. If the server falls behind, the oldest waiting segments are dropped
 * and `delayed` is set: captions should stay close to "now".
 *
 * CTO-41 adds two things:
 *
 *  - **Measurement.** Every caption yields a first-word delay (from when the
 *    segment started recording) and a round-trip (from when it stopped), and
 *    `stats` reports p50/p95 of both, with the dropped and excluded counts
 *    beside them so the figures cannot flatter themselves.
 *  - **Adaptive cadence.** The segment length starts at the server's default
 *    and shortens while the server keeps up, backing off when it does not.
 *    The speech-to-text vendor's rate limit is the real ceiling, so a throttle
 *    sets a floor that is never crossed again (lib/liveSegmentPacing.ts).
 *
 * Everything is kept in memory and gone when the component unmounts; the
 * captions are a preview, not the record, and nothing here is logged.
 */

export type LiveSpeaker = 'PROVIDER' | 'PATIENT'

export interface LiveTurn {
  /** null when the provider could not tell, or cannot label at all. */
  speaker: LiveSpeaker | null
  text: string
}

export interface LiveSegmentResult {
  text: string
  turns?: LiveTurn[]
}

export interface LiveLine {
  seq: number
  /** Seconds since captions started. */
  at: number
  text: string
  /** Speaker-split text, when the provider labelled it. */
  turns?: LiveTurn[]
}

export interface UseLiveTranscriptionOptions {
  stream: MediaStream | null
  enabled: boolean
  /** A plain string is accepted for older callers; turns are preferred. */
  transcribe: (segment: Blob, seq: number) => Promise<string | LiveSegmentResult>
  /** Starting segment length. The hook adapts from here unless `adaptive` is false. */
  segmentMs?: number
  /** Bounds the cadence may move between, normally from the server. */
  minSegmentMs?: number
  maxSegmentMs?: number
  /** Set false to hold the segment length fixed (tests, debugging). */
  adaptive?: boolean
  maxInFlight?: number
  /** Waiting segments kept before the oldest are dropped. Defaults by backlog. */
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
  /** Measured caption delay, for the on-screen readout (CTO-41). */
  stats: CaptionLatencyStats
}

/** How much un-sent audio to hold before dropping the oldest, in milliseconds. */
const BACKLOG_BUDGET_MS = 8_000

const THROTTLED_MESSAGE = 'Captions are catching up…'

function segmentMimeType(): string {
  for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(mime)) return mime
  }
  return 'audio/webm'
}

const isHidden = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden'

/** Accepts the older plain-string answer as one unlabelled turn. */
function asResult(answer: string | LiveSegmentResult): LiveSegmentResult {
  return typeof answer === 'string' ? { text: answer } : answer
}

/**
 * Keeps lines ordered by `seq` without re-sorting the whole list on every
 * caption: answers almost always arrive in order, so this is an append, and
 * an out-of-order one is a binary-search splice. On a long consult the list
 * runs to hundreds of lines, and the cost of touching all of them would land
 * straight in the delay figure this hook reports.
 */
export function insertLine(prev: LiveLine[], line: LiveLine): LiveLine[] {
  if (prev.length === 0 || prev[prev.length - 1]!.seq < line.seq) return [...prev, line]
  let lo = 0
  let hi = prev.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (prev[mid]!.seq < line.seq) lo = mid + 1
    else hi = mid
  }
  const next = [...prev]
  next.splice(lo, 0, line)
  return next
}

interface PendingSample {
  seq: number
  /** Monotonic marks; see lib/liveCaptionStats.ts for what each means. */
  startedAt: number
  endedAt: number
  /** The length this segment was meant to be, for the measurability check. */
  intendedMs: number
  /** The tab was backgrounded, so the browser clamped our timers. */
  hidden: boolean
}

export function useLiveTranscription({
  stream,
  enabled,
  transcribe,
  segmentMs = 3_000,
  minSegmentMs,
  maxSegmentMs,
  adaptive = true,
  maxInFlight = 3,
  maxQueued,
}: UseLiveTranscriptionOptions): UseLiveTranscriptionReturn {
  const [lines, setLines] = useState<LiveLine[]>([])
  const [delayed, setDelayed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<CaptionLatencyStats>(EMPTY_STATS)

  const transcribeRef = useRef(transcribe)
  transcribeRef.current = transcribe
  // Read at capture-start only, so changing a bound never restarts the recorder.
  const optionsRef = useRef({ segmentMs, minSegmentMs, maxSegmentMs, adaptive })
  optionsRef.current = { segmentMs, minSegmentMs, maxSegmentMs, adaptive }

  // The adapted cadence lives in a ref on purpose: as state it would be an
  // effect dependency, and every adaptation would tear the capture effect down,
  // restart the recorder and reset `seq` — colliding with the lines already on
  // screen.
  const pacingRef = useRef<PacingState>(initPacing(segmentMs))
  const samplesRef = useRef<LatencySample[]>([])
  const pendingRef = useRef<Map<number, PendingSample>>(new Map())
  const droppedRef = useRef(0)
  const excludedRef = useRef(0)

  // Each capture run has a generation; results from an older run (a previous
  // recording) are ignored once a new one starts.
  const generation = useRef(0)
  const active = !!stream && enabled

  const publishStats = useCallback(() => {
    setStats(
      summarize(samplesRef.current, {
        dropped: droppedRef.current,
        excluded: excludedRef.current,
        segmentMs: pacingRef.current.segmentMs,
        throttled: pacingRef.current.throttled,
      })
    )
  }, [])

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
    const mimeType = segmentMimeType()

    const opts = optionsRef.current
    pacingRef.current = initPacing(opts.segmentMs, {
      ...(opts.minSegmentMs !== undefined ? { minMs: opts.minSegmentMs } : {}),
      ...(opts.maxSegmentMs !== undefined ? { maxMs: opts.maxSegmentMs } : {}),
    })

    interface Waiting extends PendingSample {
      at: number
      blob: Blob
    }
    const waiting: Waiting[] = []

    const queueLimit = (): number =>
      maxQueued ?? Math.max(2, Math.ceil(BACKLOG_BUDGET_MS / pacingRef.current.segmentMs))

    const adapt = (next: PacingState): void => {
      if (opts.adaptive) pacingRef.current = next
    }

    const pump = () => {
      while (inFlight < maxInFlight && waiting.length > 0) {
        const item = waiting.shift()!
        inFlight += 1
        transcribeRef
          .current(item.blob, item.seq)
          .then((answer) => {
            if (!isCurrent()) return
            setError(null)
            const result = asResult(answer)
            const clean = (result.text ?? '').trim()
            // No words in this segment: no caption, and so no sample either.
            if (!clean) return
            const turns = result.turns?.length ? result.turns : undefined
            pendingRef.current.set(item.seq, item)
            setLines((prev) =>
              insertLine(prev, {
                seq: item.seq,
                at: item.at,
                text: clean,
                ...(turns ? { turns } : {}),
              })
            )
          })
          .catch((err: unknown) => {
            if (!isCurrent()) return
            const { status, code, message } = apiErrorOf(err)
            const rateLimited =
              status === 429 ||
              (status === 503 && (code === 'ai_rate_limited' || code === 'ai_timeout'))
            if (rateLimited) {
              // Our own limiter's 429 body carries no useful message, so the
              // copy is fixed here rather than taken from the response.
              adapt(onThrottled(pacingRef.current))
              setError(THROTTLED_MESSAGE)
              publishStats()
              return
            }
            setError(message || 'Live captions are unavailable right now')
          })
          .finally(() => {
            inFlight -= 1
            if (isCurrent() && waiting.length === 0 && inFlight === 0) setDelayed(false)
            pump()
          })
      }
    }

    const enqueue = (item: Waiting) => {
      waiting.push(item)
      while (waiting.length > queueLimit()) {
        waiting.shift()
        if (isCurrent()) {
          droppedRef.current += 1
          // The delay figures cannot see a dropped segment, so tell the pacer.
          adapt(onDropped(pacingRef.current))
          setDelayed(true)
          publishStats()
        }
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
      const startedAt = nowMs()
      const intendedMs = pacingRef.current.segmentMs
      const hiddenAtStart = isHidden()
      let endedAt: number | null = null
      // The last word of a segment was spoken when we asked the recorder to
      // stop; assembling the blob afterwards is our own overhead and has to
      // count against the measured round-trip, not be excluded from it.
      const markEnd = () => {
        if (endedAt === null) endedAt = nowMs()
      }

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = () => {
        markEnd()
        const blob = new Blob(chunks, { type: mimeType })
        if (blob.size > 0) {
          enqueue({
            seq: mySeq,
            at,
            blob,
            startedAt,
            endedAt: endedAt as number,
            intendedMs,
            hidden: hiddenAtStart || isHidden(),
          })
        }
        startSegment()
      }
      current = recorder
      recorder.start()
      timer = setTimeout(() => {
        markEnd()
        if (recorder.state !== 'inactive') recorder.stop()
      }, pacingRef.current.segmentMs)
    }

    startSegment()
    return () => {
      // The last, partial segment is still sent (onstop runs after this) and
      // its caption still shows, until a new recording starts.
      stopped = true
      if (timer) clearTimeout(timer)
      if (current && current.state !== 'inactive') current.stop()
    }
  }, [stream, enabled, maxInFlight, maxQueued, publishStats])

  /**
   * Caption delay is measured to the moment the line is on screen, not the
   * moment the response arrived, because that is what the provider sees. This
   * effect runs after the commit that added the line.
   */
  useEffect(() => {
    if (pendingRef.current.size === 0) return
    const rendered = nowMs()
    const present = new Set(lines.map((l) => l.seq))
    let changed = false

    for (const [seq, mark] of [...pendingRef.current]) {
      if (!present.has(seq)) continue
      pendingRef.current.delete(seq)
      changed = true

      const firstWordMs = rendered - mark.startedAt
      const roundTripMs = rendered - mark.endedAt
      const segmentDurationMs = mark.endedAt - mark.startedAt

      // A backgrounded tab has its timers clamped to seconds or minutes, so its
      // segments say nothing about how fast the server is.
      if (mark.hidden || isHidden()) {
        excludedRef.current += 1
        continue
      }
      const measurable = isMeasurable(
        { firstWordMs, roundTripMs, segmentDurationMs },
        mark.intendedMs
      )
      if (!measurable) excludedRef.current += 1
      samplesRef.current.push({ seq, firstWordMs, roundTripMs, measurable })
      if (samplesRef.current.length > MAX_SAMPLES) samplesRef.current.shift()
      // Only a normal-length segment is evidence about the server's speed.
      if (measurable && optionsRef.current.adaptive) {
        pacingRef.current = onRoundTrip(pacingRef.current, roundTripMs)
      }
    }
    if (changed) publishStats()
  }, [lines, publishStats])

  // A new recording starts with a clean caption panel and clean figures.
  useEffect(() => {
    if (stream) {
      setLines([])
      setDelayed(false)
      setError(null)
      samplesRef.current = []
      pendingRef.current.clear()
      droppedRef.current = 0
      excludedRef.current = 0
      pacingRef.current = initPacing(optionsRef.current.segmentMs)
      setStats(EMPTY_STATS)
    }
  }, [stream])

  return { lines, delayed, error, active, stats }
}
