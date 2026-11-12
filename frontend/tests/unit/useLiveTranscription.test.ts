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
