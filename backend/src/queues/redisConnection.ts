/**
 * One place for the BullMQ Redis connection and the worker settings that
 * decide how many Redis commands an idle worker spends.
 *
 * Why the worker settings matter: with BullMQ's defaults an idle worker
 * blocks on BZPOPMIN for 5 s, then runs a moveToActive script, forever, plus
 * a stalled-job script every 30 s. That is ~37k commands a day per worker
 * with no jobs at all, which used up a 500k/month Upstash free tier.
 *
 * A long drainDelay costs no pickup latency: adding a job writes the queue's
 * marker key, which wakes the blocked BZPOPMIN at once. Worker.close() also
 * drops the blocking connection immediately, so shutdown stays fast.
 */

import type { ConnectionOptions, WorkerOptions } from 'bullmq'

/** Seconds an idle worker blocks before asking again (BullMQ default: 5). */
export const DEFAULT_DRAIN_DELAY_SECONDS = 300
/** How often stalled (crashed mid-job) jobs are swept back (BullMQ default: 30 s). */
export const DEFAULT_STALLED_INTERVAL_MS = 300_000

const MIN_DRAIN_DELAY_SECONDS = 5
const MIN_STALLED_INTERVAL_MS = 30_000

/** Read a numeric env var; a missing or bad value falls back, and a small one is raised to the floor. */
function envNumber(name: string, fallback: number, floor: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(n, floor)
}

/** Parse redis:// or rediss:// (TLS in transit, B0.6.2) into ioredis options. */
export function parseRedisUrl(url: string): ConnectionOptions {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: parseInt(u.port || '6379', 10),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    ...(u.protocol === 'rediss:' ? { tls: { servername: u.hostname } } : {}),
  }
}

/** REDIS_URL when set, otherwise REDIS_HOST / REDIS_PORT / REDIS_PASSWORD (local dev). */
export function getRedisConnection(): ConnectionOptions {
  const fallback: ConnectionOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  }
  if (!process.env.REDIS_URL) return fallback
  try {
    return parseRedisUrl(process.env.REDIS_URL)
  } catch {
    return fallback
  }
}

/**
 * Settings every BullMQ Worker must use so idle polling stays cheap.
 * Override with BULLMQ_DRAIN_DELAY_SECONDS / BULLMQ_STALLED_INTERVAL_MS.
 */
export function idleWorkerOptions(): Pick<WorkerOptions, 'drainDelay' | 'stalledInterval'> {
  return {
    drainDelay: envNumber(
      'BULLMQ_DRAIN_DELAY_SECONDS',
      DEFAULT_DRAIN_DELAY_SECONDS,
      MIN_DRAIN_DELAY_SECONDS
    ),
    stalledInterval: envNumber(
      'BULLMQ_STALLED_INTERVAL_MS',
      DEFAULT_STALLED_INTERVAL_MS,
      MIN_STALLED_INTERVAL_MS
    ),
  }
}
