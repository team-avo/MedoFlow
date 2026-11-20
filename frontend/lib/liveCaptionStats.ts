/**
 * Caption-delay measurement for live consult captions (CTO-41).
 *
 * Two numbers, both measured in the browser because only the browser knows
 * when the words were spoken and when they reached the screen:
 *
 *   firstWordMs  caption rendered − segment recording STARTED
 *                The headline: a word spoken at the start of a segment waits
 *                for that segment to close before anything is uploaded, so
 *                this is what the provider actually feels. Target p95 < 4 s.
 *
 *   roundTripMs  caption rendered − segment recording ENDED
 *                Upload + speech-to-text + render. Target p95 < 1.5 s.
 *
 * Pure and in-memory: captions and their timings are never stored, logged or
 * sent anywhere (AC3). Nothing here holds caption text at all.
 */

export interface LatencySeries {
  p50: number
  p95: number
}

export interface LatencySample {
  seq: number
  firstWordMs: number
  roundTripMs: number
  /** Whether firstWordMs reflects a normal-length segment (see isMeasurable). */
  measurable: boolean
}

export interface CaptionLatencyStats {
  /** Captions that produced a usable round-trip sample. */
  samples: number
  /** Segments discarded because the server fell behind: no caption at all. */
  dropped: number
  /** Samples left out of firstWord because the segment was an odd length. */
  excluded: number
  firstWord: LatencySeries | null
  roundTrip: LatencySeries | null
  /** The segment length currently in use, after adaptation. */
  segmentMs: number
  /** The provider or our own limiter asked us to slow down. */
  throttled: boolean
}

/** Keeps memory flat on a long consult; 1000 × 2 s is far longer than any. */
export const MAX_SAMPLES = 1000

export const EMPTY_STATS: CaptionLatencyStats = {
  samples: 0,
  dropped: 0,
  excluded: 0,
  firstWord: null,
  roundTrip: null,
  segmentMs: 0,
  throttled: false,
}

/** Monotonic clock: immune to NTP steps and lid-close jumps, and fake-timer friendly. */
export function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

/**
 * Nearest-rank percentile, deliberately without interpolation so a measured
 * value is always a value that actually occurred.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, i))]!
}

const isFiniteDelay = (n: number): boolean => Number.isFinite(n) && n >= 0

/**
 * Whether a sample's first-word figure is meaningful.
 *
 * A segment much shorter than intended (the final partial one when recording
 * stops) would flatter the number; one much longer (a backgrounded tab, where
 * the browser clamps timers to seconds or minutes) would poison p95 for the
 * rest of the consult. Both are excluded and counted, and an excluded sample
 * must never reach the pacing controller: a clamped timer is not evidence that
 * the server is slow.
 */
export function isMeasurable(
  sample: { firstWordMs: number; roundTripMs: number; segmentDurationMs: number },
  targetSegmentMs: number
): boolean {
  if (!isFiniteDelay(sample.firstWordMs) || !isFiniteDelay(sample.roundTripMs)) return false
  if (!isFiniteDelay(sample.segmentDurationMs)) return false
  return (
    sample.segmentDurationMs >= targetSegmentMs * 0.5 &&
    sample.segmentDurationMs <= targetSegmentMs * 2
  )
}

/**
 * Rolls samples up into the reported figures. Does no filtering of its own:
 * the caller decides what is measurable and passes the counts through, so this
 * stays a pure function of its arguments.
 */
export function summarize(
  samples: LatencySample[],
  meta: { dropped: number; excluded: number; segmentMs: number; throttled: boolean }
): CaptionLatencyStats {
  const roundTrips = samples.filter((s) => isFiniteDelay(s.roundTripMs)).map((s) => s.roundTripMs)
  const firstWords = samples.filter((s) => s.measurable).map((s) => s.firstWordMs)
  const series = (xs: number[]): LatencySeries | null => {
    const p50 = percentile(xs, 50)
    const p95 = percentile(xs, 95)
    return p50 === null || p95 === null ? null : { p50, p95 }
  }
  return {
    samples: roundTrips.length,
    dropped: meta.dropped,
    excluded: meta.excluded,
    firstWord: series(firstWords),
    roundTrip: series(roundTrips),
    segmentMs: meta.segmentMs,
    throttled: meta.throttled,
  }
}
