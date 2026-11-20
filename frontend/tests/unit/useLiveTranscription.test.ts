/**
 * Demo feedback WS2: live captions: the segment recorder rotates every
 * `segmentMs`, each segment is sent once with its sequence number, lines stay
 * in order whatever order the answers arrive in, and a backlog is dropped
 * (with `delayed`) instead of growing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useLiveTranscription } from '@/hooks/useLiveTranscription'

class FakeRecorder {
  static instances: FakeRecorder[] = []
  static isTypeSupported = () => true
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(
    public stream: MediaStream,
    public options: { mimeType: string }
  ) {
    FakeRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['opus-bytes'], { type: this.options.mimeType }) })
    this.onstop?.()
  }
}

const stream = {} as MediaStream
const flush = () => act(async () => {})

beforeEach(() => {
  vi.useFakeTimers()
  FakeRecorder.instances = []
  vi.stubGlobal('MediaRecorder', FakeRecorder)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useLiveTranscription', () => {
  it('does nothing without a stream or when disabled', () => {
    const transcribe = vi.fn()
    renderHook(() => useLiveTranscription({ stream: null, enabled: true, transcribe }))
    renderHook(() => useLiveTranscription({ stream, enabled: false, transcribe }))
    expect(FakeRecorder.instances).toHaveLength(0)
  })

  it('rotates a fresh recorder every segment and sends each one with its number', async () => {
    const transcribe = vi.fn(async (_b: Blob, seq: number) => `line ${seq}`)
    const { result } = renderHook(() =>
      useLiveTranscription({ stream, enabled: true, transcribe, segmentMs: 6000 })
    )
    expect(result.current.active).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(6000)
    })
    await flush()
    await act(async () => {
      vi.advanceTimersByTime(6000)
    })
    await flush()
    expect(FakeRecorder.instances).toHaveLength(3) // two finished segments + the running one
    expect(transcribe.mock.calls.map((c) => c[1])).toEqual([0, 1])
    expect(transcribe.mock.calls[0]![0]).toBeInstanceOf(Blob)
    expect(result.current.lines.map((l) => l.text)).toEqual(['line 0', 'line 1'])
    expect(result.current.lines.map((l) => l.at)).toEqual([0, 6])
  })

  it('keeps lines in order when answers arrive out of order', async () => {
    const resolvers: ((t: string) => void)[] = []
    const transcribe = vi.fn(
      (_b: Blob, _seq: number) => new Promise<string>((r) => resolvers.push(r))
    )
    const { result } = renderHook(() =>
      useLiveTranscription({ stream, enabled: true, transcribe, segmentMs: 1000, maxInFlight: 2 })
    )
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(resolvers).toHaveLength(2)
    await act(async () => resolvers[1]!('second'))
    await act(async () => resolvers[0]!('first'))
    expect(result.current.lines.map((l) => l.text)).toEqual(['first', 'second'])
  })

  it('drops the oldest waiting segments when the server falls behind', async () => {
    const resolvers: ((t: string) => void)[] = []
    const transcribe = vi.fn(
      (_b: Blob, _seq: number) => new Promise<string>((r) => resolvers.push(r))
    )
    const { result } = renderHook(() =>
      useLiveTranscription({
        stream,
        enabled: true,
        transcribe,
        segmentMs: 1000,
        maxInFlight: 1,
        maxQueued: 2,
        // This test is about the queue, not the cadence: a fixed segment length
        // keeps the arithmetic below exact (CTO-41 adaptation is tested apart).
        adaptive: false,
      })
    )
    // 5 segments finish while the first request hangs: 1 in flight, 2 kept, 2 dropped.
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.delayed).toBe(true)
    // Drain: the first answer, then the two newest waiting segments (3 and 4).
    for (let i = 0; i < 3; i++) {
      await act(async () => resolvers[i]!(`text ${i}`))
    }
    expect(transcribe.mock.calls.map((c) => c[1])).toEqual([0, 3, 4])
    expect(result.current.delayed).toBe(false)
  })

  it('reports a failure without stopping, and clears it on the next success', async () => {
    let fail = true
    const transcribe = vi.fn(async () => {
      if (fail) throw { response: { data: { message: 'The AI service is busy' } } }
      return 'back again'
    })
    const { result } = renderHook(() =>
      useLiveTranscription({ stream, enabled: true, transcribe, segmentMs: 1000 })
    )
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await flush()
    expect(result.current.error).toBe('The AI service is busy')
    fail = false
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await flush()
    expect(result.current.error).toBeNull()
    expect(result.current.lines.map((l) => l.text)).toEqual(['back again'])
  })

  it('stopping sends the last partial segment', async () => {
    const transcribe = vi.fn(async () => 'goodbye')
    const { rerender, result } = renderHook(
      ({ on }) => useLiveTranscription({ stream, enabled: on, transcribe, segmentMs: 6000 }),
      { initialProps: { on: true } }
    )
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    rerender({ on: false })
    await flush()
    expect(transcribe).toHaveBeenCalledOnce()
    expect(result.current.lines.map((l) => l.text)).toEqual(['goodbye'])
    expect(result.current.active).toBe(false)
  })
})

/**
 * CTO-41. Fake timers fake `performance.now()` too, so these delays are exact
 * rather than approximate — but only if `transcribe` itself awaits a timer:
 * a promise that resolves in a microtask does so with the clock still frozen,
 * which would measure every round-trip as 0 ms.
 */
describe('useLiveTranscription: caption delay (CTO-41)', () => {
  /** Answers segment i after `delays[i]` ms of fake time. */
  const delayedTranscribe = (delays: number[]) =>
    vi.fn(
      (_b: Blob, seq: number) =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve(`line ${seq}`), delays[seq] ?? delays[delays.length - 1] ?? 0)
        })
    )

  /**
   * Advances fake time in small steps, flushing microtasks each step.
   * `advanceTimersByTime` runs every timer in its window synchronously and only
   * then lets the promise callbacks run, so one big jump would stamp every
   * caption with the clock at the end of the jump. Stepping keeps the measured
   * delay within `stepMs` of the truth.
   */
  const tick = async (totalMs: number, stepMs = 100) => {
    for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
      await act(async () => {
        vi.advanceTimersByTime(stepMs)
      })
    }
    await flush()
  }

  it('reports p50 and p95 of both delays, measured to the rendered caption', async () => {
    const SEGMENT = 2000
    const DELAY = 500
    const transcribe = delayedTranscribe([DELAY])
    const { result } = renderHook(() =>
      useLiveTranscription({
        stream,
        enabled: true,
        transcribe,
        segmentMs: SEGMENT,
        adaptive: false,
      })
    )
    await tick(SEGMENT * 6)

    const { stats } = result.current
    expect(stats.samples).toBeGreaterThanOrEqual(4)
    expect(stats.dropped).toBe(0)

    // Round-trip is the answer's own delay, to within one stepping interval.
    expect(stats.roundTrip!.p50).toBeGreaterThanOrEqual(DELAY)
    expect(stats.roundTrip!.p50).toBeLessThanOrEqual(DELAY + 100)
    expect(stats.roundTrip!.p95).toBeGreaterThanOrEqual(stats.roundTrip!.p50)

    // First word additionally carries the wait for the segment to close, which
    // is why it is the headline figure and the round-trip alone is not.
    expect(stats.firstWord!.p50).toBeGreaterThanOrEqual(SEGMENT + DELAY)
    expect(stats.firstWord!.p50).toBeLessThanOrEqual(SEGMENT + DELAY + 100)
  })

  it('a slow segment raises p95 above p50', async () => {
    const transcribe = vi.fn(
      (_b: Blob, seq: number) =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve(`line ${seq}`), seq === 3 ? 2000 : 300)
        })
    )
    const { result } = renderHook(() =>
      useLiveTranscription({
        stream,
        enabled: true,
        transcribe,
        segmentMs: 2000,
        adaptive: false,
      })
    )
    await tick(2000 * 8)

    const { roundTrip } = result.current.stats
    expect(roundTrip!.p95).toBeGreaterThan(roundTrip!.p50)
    expect(roundTrip!.p95).toBeGreaterThanOrEqual(2000)
  })

  it('shortens the segment while answers are fast, without restarting capture', async () => {
    const transcribe = delayedTranscribe([300])
    const { result } = renderHook(() =>
      useLiveTranscription({
        stream,
        enabled: true,
        transcribe,
        segmentMs: 3000,
        minSegmentMs: 2000,
        maxSegmentMs: 6000,
      })
    )
    await tick(30_000)

    expect(result.current.stats.segmentMs).toBe(2000)
    // The capture effect must not have torn down: sequence numbers keep
    // climbing from 0 and never restart (which would duplicate React keys).
    const seqs = transcribe.mock.calls.map((c) => c[1])
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(seqs[0]).toBe(0)
  })

  it('backs off and stays backed off when the AI provider rate-limits us', async () => {
    const transcribe = vi.fn(async () => {
      throw { response: { status: 503, data: { code: 'ai_rate_limited', message: 'busy' } } }
    })
    const { result } = renderHook(() =>
      useLiveTranscription({ stream, enabled: true, transcribe, segmentMs: 2000 })
    )
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await flush()

    expect(result.current.stats.throttled).toBe(true)
    expect(result.current.stats.segmentMs).toBe(6000)
    expect(result.current.error).toMatch(/catching up/i)
  })

  it('treats our own 429 as a slow-down, not a failure', async () => {
    // The limiter's body carries no usable message, so the copy is fixed.
    const transcribe = vi.fn(async () => {
      throw { response: { status: 429, data: { success: false, error: 'Too many' } } }
    })
    const { result } = renderHook(() =>
      useLiveTranscription({ stream, enabled: true, transcribe, segmentMs: 2000 })
    )
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await flush()
    expect(result.current.stats.throttled).toBe(true)
    expect(result.current.error).toMatch(/catching up/i)
  })

  it('passes speaker turns through and keeps the verbatim text', async () => {
    const transcribe = vi.fn(async () => ({
      text: 'Provider: Any pain? Patient: A little.',
      turns: [
        { speaker: 'PROVIDER' as const, text: 'Any pain?' },
        { speaker: 'PATIENT' as const, text: 'A little.' },
      ],
    }))
    const { result } = renderHook(() =>
      useLiveTranscription({ stream, enabled: true, transcribe, segmentMs: 2000 })
    )
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await flush()

    const [line] = result.current.lines
    expect(line!.text).toBe('Provider: Any pain? Patient: A little.')
    expect(line!.turns).toEqual([
      { speaker: 'PROVIDER', text: 'Any pain?' },
      { speaker: 'PATIENT', text: 'A little.' },
    ])
  })

  it('an answer with no turns leaves the line unlabelled, exactly as before', async () => {
    const transcribe = vi.fn(async () => ({ text: 'just words' }))
    const { result } = renderHook(() =>
      useLiveTranscription({ stream, enabled: true, transcribe, segmentMs: 2000 })
    )
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await flush()
    expect(result.current.lines[0]!.text).toBe('just words')
    expect(result.current.lines[0]!.turns).toBeUndefined()
  })

  it('empty, failed and dropped segments never become delay samples', async () => {
    const transcribe = vi.fn(async (_b: Blob, seq: number) => {
      if (seq % 2 === 0) return ''
      throw new Error('nope')
    })
    const { result } = renderHook(() =>
      useLiveTranscription({ stream, enabled: true, transcribe, segmentMs: 1000, adaptive: false })
    )
    await act(async () => {
      vi.advanceTimersByTime(20_000)
    })
    await flush()

    expect(transcribe.mock.calls.length).toBeGreaterThan(5)
    expect(result.current.lines).toHaveLength(0)
    expect(result.current.stats.samples).toBe(0)
    expect(result.current.stats.roundTrip).toBeNull()
  })

  it('a new recording starts from clean figures', async () => {
    const transcribe = delayedTranscribe([400])
    const { rerender, result } = renderHook(
      ({ on }) =>
        useLiveTranscription({
          stream: on ? stream : null,
          enabled: on,
          transcribe,
          segmentMs: 2000,
          adaptive: false,
        }),
      { initialProps: { on: true } }
    )
    await tick(2000 * 3)
    expect(result.current.stats.samples).toBeGreaterThan(0)

    rerender({ on: false })
    await flush()
    rerender({ on: true })
    await flush()
    expect(result.current.stats.samples).toBe(0)
    expect(result.current.stats.roundTrip).toBeNull()
    expect(result.current.lines).toHaveLength(0)
  })

  it('leaves the short final segment out of the first-word figure', async () => {
    const transcribe = delayedTranscribe([400])
    const { rerender, result } = renderHook(
      ({ on }) =>
        useLiveTranscription({
          stream: on ? stream : null,
          enabled: on,
          transcribe,
          segmentMs: 3000,
          adaptive: false,
        }),
      { initialProps: { on: true } }
    )
    // Stop 800 ms in: the caption still shows, but 800 ms is far short of the
    // 3 s segment it was meant to be, so its first-word delay is meaningless.
    await act(async () => {
      vi.advanceTimersByTime(800)
    })
    rerender({ on: false })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await flush()

    expect(result.current.lines).toHaveLength(1)
    expect(result.current.stats.excluded).toBe(1)
    expect(result.current.stats.firstWord).toBeNull()
  })
})
