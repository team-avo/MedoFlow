/**
 * Idle-logoff timing (F0.2.1), kept pure so it is unit tested.
 *
 * The server revokes a session after SESSION_IDLE_TIMEOUT_MINUTES without an
 * authenticated request (B0.2.3). The client mirrors that window from local
 * input: it warns shortly before the end, then signs out and clears the
 * screen. While the user is genuinely active (typing a long note makes no
 * API calls) it sends a heartbeat so the server session stays alive; an
 * untouched screen sends nothing, so both sides expire together.
 */

export const ACTIVITY_STORAGE_KEY = 'medoflow:last-activity'

export type IdlePhase = 'active' | 'warning' | 'expired'

export interface IdleWindow {
  timeoutMs: number
  warningMs: number
  heartbeatMs: number
}

export function idleWindow(timeoutMinutes: number, warningSeconds = 60): IdleWindow {
  const timeoutMs = Math.max(1, timeoutMinutes) * 60_000
  return {
    timeoutMs,
    // Never warn for more than half the window.
    warningMs: Math.min(warningSeconds * 1000, timeoutMs / 2),
    // Ping at least three times per window while active, at most every 5 min.
    heartbeatMs: Math.min(5 * 60_000, Math.floor(timeoutMs / 3)),
  }
}

export function idlePhase(now: number, lastActivity: number, w: IdleWindow): IdlePhase {
  const idle = now - lastActivity
  if (idle >= w.timeoutMs) return 'expired'
  if (idle >= w.timeoutMs - w.warningMs) return 'warning'
  return 'active'
}

export function secondsLeft(now: number, lastActivity: number, w: IdleWindow): number {
  return Math.max(0, Math.ceil((w.timeoutMs - (now - lastActivity)) / 1000))
}

/** A heartbeat is due when there was activity since the last one and the interval has passed. */
export function heartbeatDue(
  now: number,
  lastActivity: number,
  lastHeartbeat: number,
  w: IdleWindow
): boolean {
  return lastActivity > lastHeartbeat && now - lastHeartbeat >= w.heartbeatMs
}
