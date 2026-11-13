/**
 * Auto-end an idle video call (CTO-35), kept pure so it is unit tested.
 *
 * Once everyone else has left (someone joined, then the room emptied), and
 * nobody has interacted or spoken for `aloneMs` (default 60 s), the remaining
 * participant is asked "Are you still there?" with a `promptMs` countdown
 * (default 30 s). Any interaction or audio resets both. No answer ends the
 * call for them. Thresholds come from props or NEXT_PUBLIC_VIDEO_ALONE_SECONDS
 * / NEXT_PUBLIC_VIDEO_PROMPT_SECONDS.
 */
export type IdleCallPhase = 'ok' | 'prompt' | 'end'

export interface IdleCallState {
  /** When the room became empty apart from us; null while others are in it. */
  aloneSince: number | null
  /** Last pointer, key or audio activity in this call. */
  lastActivity: number
}

const envSeconds = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n * 1000 : fallback
}

export const DEFAULT_ALONE_MS = envSeconds(process.env.NEXT_PUBLIC_VIDEO_ALONE_SECONDS, 60_000)
export const DEFAULT_PROMPT_MS = envSeconds(process.env.NEXT_PUBLIC_VIDEO_PROMPT_SECONDS, 30_000)

export function idleCallPhase(
  now: number,
  s: IdleCallState,
  aloneMs = DEFAULT_ALONE_MS,
  promptMs = DEFAULT_PROMPT_MS
): IdleCallPhase {
  if (s.aloneSince === null) return 'ok'
  const quietFor = now - Math.max(s.aloneSince, s.lastActivity)
  if (quietFor >= aloneMs + promptMs) return 'end'
  if (quietFor >= aloneMs) return 'prompt'
  return 'ok'
}

/** Seconds left on the "still there?" countdown. */
export function promptSecondsLeft(
  now: number,
  s: IdleCallState,
  aloneMs = DEFAULT_ALONE_MS,
  promptMs = DEFAULT_PROMPT_MS
): number {
  if (s.aloneSince === null) return Math.ceil(promptMs / 1000)
  const quietFor = now - Math.max(s.aloneSince, s.lastActivity)
  return Math.max(0, Math.ceil((aloneMs + promptMs - quietFor) / 1000))
}

/** Audio louder than this (Jitsi's 0..1 level) counts as someone speaking. */
export const SPEAKING_LEVEL = 0.05
