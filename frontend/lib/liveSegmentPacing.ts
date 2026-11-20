/**
 * Adaptive caption segment length (CTO-41).
 *
 * Captions lag by roughly the segment length plus the provider's round-trip,
 * so shortening segments is the main lever on perceived delay. But shorter
 * segments mean more requests a minute, and the speech-to-text vendor's own
 * rate limit is the real ceiling (Groq's free Whisper tier allows 20/minute,
 * which a 2 s cadence would exceed). So the client shortens while the server
 * keeps up and backs off when it does not.
 *
 * The server owns the bounds (via the scribe capabilities payload); this owns
 * the policy. Pure and synchronous so the arithmetic can be tested without a
 * MediaRecorder.
 */

export interface PacingConfig {
  minMs: number
  maxMs: number
  stepMs: number
  /** Round-trips below this are "the server is keeping up easily". */
  fastMs: number
  /** A round-trip above this means back off now. */
  slowMs: number
  /** Consecutive fast samples required before shortening. */
  window: number
}

export interface PacingState {
  segmentMs: number
  /** Recent round-trips, newest last, at most `window` of them. */
  recent: number[]
  /** Samples to ignore before adapting again, so it cannot ping-pong. */
  cooldown: number
  throttled: boolean
  /**
   * Sticky lower bound. Once a rate limit is hit, the cadence that caused it is
   * never returned to for the rest of the recording — otherwise the controller
   * is an oscillator: shorten, get throttled, back off, shorten, get throttled.
   */
  floorMs: number
  ceilMs: number
  cfg: PacingConfig
}

export const DEFAULT_PACING: PacingConfig = {
  minMs: 2_000,
  maxMs: 6_000,
  stepMs: 500,
  fastMs: 1_200,
  slowMs: 2_500,
  window: 3,
}

const COOLDOWN_AFTER_ADAPT = 2
const COOLDOWN_AFTER_THROTTLE = 4

/**
 * The starting length is honoured as given, and the bounds are widened to
 * include it, so an unusual server default (or a test) is never silently
 * clamped into a different cadence.
 */
export function initPacing(startMs: number, over: Partial<PacingConfig> = {}): PacingState {
  const cfg = { ...DEFAULT_PACING, ...over }
  return {
    segmentMs: startMs,
    recent: [],
    cooldown: 0,
    throttled: false,
    floorMs: Math.min(cfg.minMs, startMs),
    ceilMs: Math.max(cfg.maxMs, startMs),
    cfg,
  }
}

const shorter = (s: PacingState): PacingState => ({
  ...s,
  segmentMs: Math.max(s.floorMs, s.segmentMs - s.cfg.stepMs),
  recent: [],
  cooldown: COOLDOWN_AFTER_ADAPT,
})

const longer = (s: PacingState): PacingState => ({
  ...s,
  segmentMs: Math.min(s.ceilMs, s.segmentMs + s.cfg.stepMs),
  recent: [],
  cooldown: COOLDOWN_AFTER_ADAPT,
})

/**
 * Feeds one round-trip in. Moves the segment length by at most one step.
 *
 * The gap between `fastMs` and `slowMs` is what stops oscillation: a mixture
 * of fast and slow answers never satisfies "every recent sample is fast" and
 * never trips the slow threshold, so the length stays put.
 */
export function onRoundTrip(state: PacingState, roundTripMs: number): PacingState {
  if (!Number.isFinite(roundTripMs) || roundTripMs < 0) return state

  const recent = [...state.recent, roundTripMs].slice(-state.cfg.window)
  const next: PacingState = {
    ...state,
    recent,
    cooldown: Math.max(0, state.cooldown - 1),
  }
  if (next.cooldown > 0) return next

  if (roundTripMs > state.cfg.slowMs) return longer(next)
  if (recent.length === state.cfg.window && recent.every((ms) => ms < state.cfg.fastMs)) {
    return shorter(next)
  }
  return next
}

/** Our limiter or the AI vendor's said slow down: go to the ceiling and stay above it. */
export function onThrottled(state: PacingState): PacingState {
  return {
    ...state,
    segmentMs: state.ceilMs,
    floorMs: Math.max(state.floorMs, state.ceilMs),
    recent: [],
    cooldown: COOLDOWN_AFTER_THROTTLE,
    throttled: true,
  }
}

/**
 * A segment was dropped because the queue overflowed. The latency series
 * cannot see this (a dropped segment never becomes a caption), so it is fed in
 * here as the equivalent of a slow answer.
 */
export function onDropped(state: PacingState): PacingState {
  const next: PacingState = { ...state, recent: [], cooldown: Math.max(0, state.cooldown - 1) }
  return next.cooldown > 0 ? next : longer(next)
}
