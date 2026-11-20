/**
 * CTO-41: the adaptive caption cadence.
 *
 * Two properties matter more than the step arithmetic: it must not oscillate
 * on mixed round-trips, and once the speech-to-text vendor has rate-limited us
 * it must never return to the cadence that caused it.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PACING,
  initPacing,
  onDropped,
  onRoundTrip,
  onThrottled,
  type PacingState,
} from '@/lib/liveSegmentPacing'

const FAST = 800
const SLOW = 3_000
const feed = (s: PacingState, samples: number[]): PacingState =>
  samples.reduce((acc, ms) => onRoundTrip(acc, ms), s)

describe('initPacing', () => {
  it('starts at the server-supplied length', () => {
    expect(initPacing(3_000).segmentMs).toBe(3_000)
  })

  it('honours a start outside the usual bounds instead of clamping it', () => {
    const s = initPacing(6_000)
    expect(s.segmentMs).toBe(6_000)
    expect(s.ceilMs).toBeGreaterThanOrEqual(6_000)
  })

  it('a labelled-profile start of 3 s cannot be shortened below itself', () => {
    const s = initPacing(3_000, { minMs: 3_000 })
    expect(feed(s, Array(30).fill(FAST)).segmentMs).toBe(3_000)
  })
})

describe('shortening while the server keeps up', () => {
  it('needs a full window of fast answers, then moves one step', () => {
    let s = initPacing(3_000)
    s = feed(s, [FAST, FAST])
    expect(s.segmentMs).toBe(3_000)
    s = onRoundTrip(s, FAST)
    expect(s.segmentMs).toBe(2_500)
  })

  it('does not adapt again on the very next sample', () => {
    let s = feed(initPacing(3_000), [FAST, FAST, FAST])
    expect(s.segmentMs).toBe(2_500)
    s = onRoundTrip(s, FAST)
    expect(s.segmentMs).toBe(2_500)
  })

  it('settles at the floor and stays there', () => {
    const s = feed(initPacing(3_000), Array(40).fill(FAST))
    expect(s.segmentMs).toBe(DEFAULT_PACING.minMs)
  })
})

describe('backing off when the server is slow', () => {
  it('one slow answer lengthens immediately', () => {
    expect(onRoundTrip(initPacing(3_000), SLOW).segmentMs).toBe(3_500)
  })

  it('stops at the ceiling', () => {
    const s = feed(initPacing(3_000), Array(40).fill(SLOW))
    expect(s.segmentMs).toBe(DEFAULT_PACING.maxMs)
  })

  it('a dropped segment counts as slow, because the delay figures cannot see it', () => {
    expect(onDropped(initPacing(3_000)).segmentMs).toBe(3_500)
  })
})

describe('it does not oscillate', () => {
  it('alternating fast and slow answers leave the cadence alone', () => {
    const start = initPacing(3_000)
    // Inside the dead band: never a full fast window, never over the slow mark.
    const s = feed(
      start,
      Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 1_000 : 2_000))
    )
    expect(s.segmentMs).toBe(3_000)
  })

  it('one call never moves the cadence by more than a step', () => {
    let s = initPacing(4_000)
    for (const ms of [FAST, FAST, FAST, SLOW, FAST, SLOW, SLOW, FAST, FAST, FAST, FAST]) {
      const before = s.segmentMs
      s = onRoundTrip(s, ms)
      expect(Math.abs(s.segmentMs - before)).toBeLessThanOrEqual(DEFAULT_PACING.stepMs)
    }
  })

  it('ignores impossible round-trips rather than adapting on them', () => {
    const s = initPacing(3_000)
    expect(onRoundTrip(s, -1)).toBe(s)
    expect(onRoundTrip(s, Number.NaN)).toBe(s)
  })
})

describe('a rate limit sets a sticky floor', () => {
  it('goes to the ceiling and reports it', () => {
    const s = onThrottled(initPacing(2_000))
    expect(s.segmentMs).toBe(DEFAULT_PACING.maxMs)
    expect(s.throttled).toBe(true)
  })

  it('never returns to the cadence that got us throttled', () => {
    let s = feed(initPacing(3_000), Array(40).fill(FAST))
    expect(s.segmentMs).toBe(2_000)
    s = onThrottled(s)
    // However well it goes from here, 2 s a segment caused a 429 once already.
    s = feed(s, Array(40).fill(FAST))
    expect(s.segmentMs).toBe(DEFAULT_PACING.maxMs)
    expect(s.throttled).toBe(true)
  })

  it('pins the floor at the ceiling it backed off to', () => {
    const s = onThrottled(initPacing(3_000, { maxMs: 3_000 }))
    expect(s.segmentMs).toBe(3_000)
    expect(feed(s, Array(40).fill(FAST)).segmentMs).toBe(3_000)
  })
})
