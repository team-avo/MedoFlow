/**
 * Guardrail: every BullMQ Worker must poll Redis slowly when idle.
 *
 * With BullMQ defaults (drainDelay 5 s, stalledInterval 30 s) one idle worker
 * spends ~37k Redis commands a day, which exhausted the 500k/month Upstash
 * free tier. These tests fail if a worker ships with the defaults again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as BullMQ from 'bullmq'

const workerOpts: Record<string, Record<string, unknown>> = {}

vi.mock('bullmq', async (importOriginal) => {
  const actual = await importOriginal<typeof BullMQ>()
  class FakeWorker {
    constructor(name: string, _processor: unknown, opts: Record<string, unknown>) {
      workerOpts[name] = opts
    }
    on() {
      return this
    }
  }
  class FakeQueue {
    add() {
      return Promise.resolve()
    }
  }
  return { ...actual, Worker: FakeWorker, Queue: FakeQueue }
})

import {
  DEFAULT_DRAIN_DELAY_SECONDS,
  DEFAULT_STALLED_INTERVAL_MS,
  getRedisConnection,
  idleWorkerOptions,
  parseRedisUrl,
} from '../queues/redisConnection'
import { createAiScribeWorker } from '../queues/aiScribeQueue'
import { createSiteLaunchWorker } from '../site/services/siteLaunchService'

const ENV_KEYS = ['REDIS_URL', 'BULLMQ_DRAIN_DELAY_SECONDS', 'BULLMQ_STALLED_INTERVAL_MS'] as const
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  delete process.env.BULLMQ_DRAIN_DELAY_SECONDS
  delete process.env.BULLMQ_STALLED_INTERVAL_MS
  process.env.REDIS_URL = 'rediss://default:p%40ss@example.upstash.io:6380'
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('idleWorkerOptions', () => {
  it('defaults to slow idle polling, far above the BullMQ defaults', () => {
    expect(idleWorkerOptions()).toEqual({
      drainDelay: DEFAULT_DRAIN_DELAY_SECONDS,
      stalledInterval: DEFAULT_STALLED_INTERVAL_MS,
    })
    expect(DEFAULT_DRAIN_DELAY_SECONDS).toBeGreaterThanOrEqual(60)
    expect(DEFAULT_STALLED_INTERVAL_MS).toBeGreaterThanOrEqual(120_000)
  })

  it('takes overrides from the environment', () => {
    process.env.BULLMQ_DRAIN_DELAY_SECONDS = '120'
    process.env.BULLMQ_STALLED_INTERVAL_MS = '600000'
    expect(idleWorkerOptions()).toEqual({ drainDelay: 120, stalledInterval: 600_000 })
  })

  it('never goes below the BullMQ defaults and ignores junk', () => {
    process.env.BULLMQ_DRAIN_DELAY_SECONDS = '1'
    process.env.BULLMQ_STALLED_INTERVAL_MS = '1000'
    expect(idleWorkerOptions()).toEqual({ drainDelay: 5, stalledInterval: 30_000 })

    process.env.BULLMQ_DRAIN_DELAY_SECONDS = 'soon'
    process.env.BULLMQ_STALLED_INTERVAL_MS = ''
    expect(idleWorkerOptions()).toEqual({
      drainDelay: DEFAULT_DRAIN_DELAY_SECONDS,
      stalledInterval: DEFAULT_STALLED_INTERVAL_MS,
    })
  })
})

describe('Redis connection', () => {
  it('parses rediss:// with TLS and a URL-encoded password', () => {
    expect(parseRedisUrl('rediss://default:p%40ss@example.upstash.io:6380')).toEqual({
      host: 'example.upstash.io',
      port: 6380,
      username: 'default',
      password: 'p@ss',
      tls: { servername: 'example.upstash.io' },
    })
  })

  it('falls back to REDIS_HOST/localhost without REDIS_URL', () => {
    delete process.env.REDIS_URL
    expect(getRedisConnection()).toMatchObject({ host: process.env.REDIS_HOST || 'localhost' })
  })
})

describe('every worker uses the idle tuning', () => {
  it.each([
    ['ai-scribe-processing', () => createAiScribeWorker()],
    ['site-launch', () => createSiteLaunchWorker()],
  ])('%s', (queueName, create) => {
    expect(create()).not.toBeNull()
    const opts = workerOpts[queueName]
    expect(opts).toBeDefined()
    expect(opts!.drainDelay).toBeGreaterThanOrEqual(60)
    expect(opts!.stalledInterval).toBeGreaterThanOrEqual(120_000)
    expect(opts!.connection).toMatchObject({ host: 'example.upstash.io', port: 6380 })
  })
})
