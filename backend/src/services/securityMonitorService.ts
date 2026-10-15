/**
 * PHI-safe security monitoring + anomaly alerts (B0.6.5).
 *
 * Two detectors, both sliding-window counters kept in process memory:
 *  - failed-auth spike: failed logins / MFA challenges across the platform
 *    (and per client IP) within ALERT_WINDOW_MINUTES;
 *  - anomalous record access: distinct sensitive records (notes, transcripts,
 *    files) one user opens within the window — the "multi-record" pattern of
 *    a compromised or curious account.
 *
 * Alerts go to stderr ("[security-alert] …", picked up by the host's log
 * drain) and, when ALERT_WEBHOOK_URL is set, to a Slack-compatible webhook.
 * Payloads carry only ids, counts and the alert kind — never names, emails
 * or record contents — and are passed through scrubPhi before sending, so the
 * monitoring vendor never receives PHI (no BAA required for this channel).
 *
 * Counters are per instance. With more than one API instance each counts its
 * own share, so thresholds are effectively per instance; a Redis-backed
 * counter is the upgrade path if the backend scales out.
 */
import { scrubPhi } from '../utils/phiScrubber'

export type AlertKind = 'failed_auth_spike' | 'anomalous_record_access' | 'break_glass_activated'

export interface SecurityAlert {
  kind: AlertKind
  at: string
  summary: string
  details: Record<string, string | number | null>
}

const num = (name: string, fallback: number): number => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

const windowMs = () => num('ALERT_WINDOW_MINUTES', 5) * 60_000
const failedAuthGlobalThreshold = () => num('ALERT_FAILED_LOGIN_THRESHOLD', 25)
const failedAuthPerIpThreshold = () => num('ALERT_FAILED_LOGIN_PER_IP_THRESHOLD', 10)
const recordAccessThreshold = () => num('ALERT_RECORD_ACCESS_THRESHOLD', 50)

/** Timestamps (ms) per counter key, oldest first. */
const events = new Map<string, number[]>()
/** Last alert time per dedup key — one alert per key per window. */
const lastAlert = new Map<string, number>()
/** Distinct records per user: key → Map<recordKey, lastSeen>. */
const recordAccess = new Map<string, Map<string, number>>()

type Sink = (alert: SecurityAlert) => void | Promise<void>
const extraSinks: Sink[] = []

/** Test hook / extension point: receive every alert that fires. */
export function onSecurityAlert(sink: Sink): () => void {
  extraSinks.push(sink)
  return () => {
    const i = extraSinks.indexOf(sink)
    if (i >= 0) extraSinks.splice(i, 1)
  }
}

export function resetSecurityMonitor(): void {
  events.clear()
  lastAlert.clear()
  recordAccess.clear()
}

function bump(key: string, now: number): number {
  const cutoff = now - windowMs()
  const list = (events.get(key) ?? []).filter((t) => t > cutoff)
  list.push(now)
  events.set(key, list)
  return list.length
}

async function postWebhook(alert: SecurityAlert): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `:rotating_light: MedoFlow security alert — ${alert.kind}: ${alert.summary}`,
        alert,
      }),
    })
  } catch (err) {
    console.error('[security-alert] webhook delivery failed:', (err as Error).message)
  }
}

export function raiseAlert(
  kind: AlertKind,
  summary: string,
  details: SecurityAlert['details'],
  dedupKey: string = kind,
  now = Date.now()
): boolean {
  const last = lastAlert.get(dedupKey)
  if (last !== undefined && now - last < windowMs()) return false
  lastAlert.set(dedupKey, now)

  const alert = scrubPhi<SecurityAlert>({ kind, at: new Date(now).toISOString(), summary, details })
  console.error(`[security-alert] ${JSON.stringify(alert)}`)
  void postWebhook(alert)
  for (const sink of extraSinks) void sink(alert)
  return true
}

/** Call on every failed login or MFA challenge. `ip` may be null. */
export function recordFailedAuth(ip: string | null, now = Date.now()): void {
  const total = bump('auth:fail:all', now)
  if (total >= failedAuthGlobalThreshold()) {
    raiseAlert(
      'failed_auth_spike',
      `${total} failed sign-ins in the last ${windowMs() / 60_000} min across the platform`,
      { failedAttempts: total, windowMinutes: windowMs() / 60_000, scope: 'platform' },
      'failed_auth_spike:all',
      now
    )
  }
  if (ip) {
    const perIp = bump(`auth:fail:ip:${ip}`, now)
    if (perIp >= failedAuthPerIpThreshold()) {
      raiseAlert(
        'failed_auth_spike',
        `${perIp} failed sign-ins from one client IP in the last ${windowMs() / 60_000} min`,
        { failedAttempts: perIp, windowMinutes: windowMs() / 60_000, scope: 'ip', ip },
        `failed_auth_spike:ip:${ip}`,
        now
      )
    }
  }
}

/** Call on every audited sensitive read (auditService.logRead does this). */
export function recordRecordAccess(
  access: { userId: string; clinicId: string | null; entityType: string; entityId: string },
  now = Date.now()
): void {
  const cutoff = now - windowMs()
  const seen = recordAccess.get(access.userId) ?? new Map<string, number>()
  for (const [k, t] of seen) if (t <= cutoff) seen.delete(k)
  seen.set(`${access.entityType}:${access.entityId}`, now)
  recordAccess.set(access.userId, seen)

  if (seen.size >= recordAccessThreshold()) {
    raiseAlert(
      'anomalous_record_access',
      `one user opened ${seen.size} distinct sensitive records in ${windowMs() / 60_000} min`,
      {
        userId: access.userId,
        clinicId: access.clinicId,
        distinctRecords: seen.size,
        windowMinutes: windowMs() / 60_000,
      },
      `anomalous_record_access:${access.userId}`,
      now
    )
  }
}
