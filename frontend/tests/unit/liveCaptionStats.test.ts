/**
 * CTO-41: the caption-delay arithmetic behind the reported p50/p95.
 *
 * The percentile definition is pinned deliberately: nearest rank, no
 * interpolation, so a reported figure is always a delay that really happened
 * and the numbers in the walkthrough mean exactly what they say.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_STATS,
  isMeasurable,
  percentile,
  summarize,
  type LatencySample,
} from '@/lib/liveCaptionStats'

const sample = (over: Partial<LatencySample> = {}): LatencySample => ({
  seq: 0,
  firstWordMs: 2_500,
  roundTripMs: 500,
  measurable: true,
  ...over,
})

const meta = { dropped: 0, excluded: 0, segmentMs: 2_000, throttled: false }

describe('percentile: nearest rank, index = ceil(p/100 * n) - 1', () => {
  it('has no answer for no samples', () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([], 95)).toBeNull()
  })

  it('a single sample is both p50 and p95', () => {
    expect(percentile([1_234], 50)).toBe(1_234)
    expect(percentile([1_234], 95)).toBe(1_234)
  })

  it('with two samples p95 is the larger', () => {
    expect(percentile([100, 900], 50)).toBe(100)
    expect(percentile([100, 900], 95)).toBe(900)
  })

  it('100..2000 in twenty steps gives p50 1000 (index 9) and p95 1900 (index 18)', () => {
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 100)
    expect(percentile(values, 50)).toBe(1_000)
    expect(percentile(values, 95)).toBe(1_900)
  })

  it('does not care about input order, and tolerates duplicates', () => {
    const values = [1_900, 100, 1_000, 100, 1_000]
    expect(percentile(values, 50)).toBe(
      percentile(
        [...values].sort((a, b) => a - b),
        50
      )
    )
    expect(percentile(values, 95)).toBe(1_900)
  })

  it('never interpolates: every answer is a value that occurred', () => {
    const values = [10, 20, 30]
    for (const p of [1, 25, 50, 75, 95, 99, 100]) {
      expect(values).toContain(percentile(values, p))
    }
  })
})

describe('summarize', () => {
  it('reports nothing from no samples', () => {
    const stats = summarize([], meta)
    expect(stats).toMatchObject({ samples: 0, firstWord: null, roundTrip: null })
  })

  it('reports both series and carries the counts through', () => {
    const stats = summarize(
      [
        sample({ seq: 0, firstWordMs: 2_500, roundTripMs: 500 }),
        sample({ seq: 1, firstWordMs: 3_000, roundTripMs: 1_000 }),
      ],
      { dropped: 3, excluded: 1, segmentMs: 2_500, throttled: true }
    )
    expect(stats.samples).toBe(2)
    expect(stats.roundTrip).toEqual({ p50: 500, p95: 1_000 })
    expect(stats.firstWord).toEqual({ p50: 2_500, p95: 3_000 })
    expect(stats.dropped).toBe(3)
    expect(stats.excluded).toBe(1)
    expect(stats.segmentMs).toBe(2_500)
    expect(stats.throttled).toBe(true)
  })

  it('keeps an unmeasurable sample out of firstWord but still counts its round-trip', () => {
    const stats = summarize(
      [
        sample({ seq: 0, firstWordMs: 2_500, roundTripMs: 500 }),
        // The short final segment: its round-trip is real, its first-word is not.
        sample({ seq: 1, firstWordMs: 600, roundTripMs: 400, measurable: false }),
      ],
      meta
    )
    expect(stats.samples).toBe(2)
    expect(stats.roundTrip).toEqual({ p50: 400, p95: 500 })
    expect(stats.firstWord).toEqual({ p50: 2_500, p95: 2_500 })
  })

  it('EMPTY_STATS reports nothing rather than zero', () => {
    expect(EMPTY_STATS.firstWord).toBeNull()
    expect(EMPTY_STATS.roundTrip).toBeNull()
    expect(EMPTY_STATS.samples).toBe(0)
  })
})

describe('isMeasurable', () => {
  const target = 3_000
  const s = (segmentDurationMs: number, over = {}) => ({
    firstWordMs: 3_500,
    roundTripMs: 500,
    segmentDurationMs,
    ...over,
  })

  it('accepts a segment of about the intended length', () => {
    expect(isMeasurable(s(3_000), target)).toBe(true)
    expect(isMeasurable(s(1_500), target)).toBe(true)
    expect(isMeasurable(s(6_000), target)).toBe(true)
  })

  it('rejects the short final segment, which would flatter the figure', () => {
    expect(isMeasurable(s(1_200), target)).toBe(false)
    expect(isMeasurable(s(800), target)).toBe(false)
  })

  it('rejects a clamped segment from a backgrounded tab, which would poison p95', () => {
    expect(isMeasurable(s(7_500), target)).toBe(false)
    expect(isMeasurable(s(60_000), target)).toBe(false)
  })

  it('rejects impossible numbers rather than reporting them', () => {
    expect(isMeasurable(s(3_000, { roundTripMs: -5 }), target)).toBe(false)
    expect(isMeasurable(s(3_000, { firstWordMs: Number.NaN }), target)).toBe(false)
    expect(isMeasurable(s(Number.POSITIVE_INFINITY), target)).toBe(false)
  })
})
