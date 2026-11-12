/**
 * The clinic's address goes live when it publishes its website (CTO-26).
 *
 *  - Publish asks for a launch: a SiteLaunch row (PENDING) and a job that
 *    deploys the front door to Cloudflare Pages branch <label>.
 *  - The job retries (3 attempts, exponential backoff) on the BullMQ queue
 *    when Redis is available, and runs in-process otherwise.
 *  - LIVE once Cloudflare accepts the deployment; FAILED after the last
 *    attempt, with a short safe reason for the owner, an e-mail to the
 *    platform team, and a Retry button.
 *  - Idempotent: a clinic already LIVE on the same label is not redeployed.
 *  - Off-boarding removes the address (removeLaunch).
 *
 * Without CF_PAGES_API_TOKEN / CF_ACCOUNT_ID (local development) the status
 * is NOT_CONFIGURED and nothing is called.
 */
import { Queue, Worker, type Job } from 'bullmq'
import prisma from '../../config/prisma'
import { withTenantBypass } from '../../config/tenantContext'
import { RESERVED_SITE_LABELS } from '../config'
import { getPagesClient } from '../frontDoor/pagesClient'
import * as auditService from '../../services/auditService'
import { sendSiteLaunchFailedEmail } from '../../services/emailService'
import { platformReviewRecipients } from '../../config/clinicReview'

export const SITE_LAUNCH_ATTEMPTS = 3
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/
export const QUEUE_NAME = 'site-launch'

export type LaunchStatus = 'PENDING' | 'LIVE' | 'FAILED' | 'REMOVED' | 'NOT_CONFIGURED' | 'NONE'

/** Same rules as front-door.yml (and the backend's own, wider, reserved list). */
export const isLaunchableLabel = (label: string) =>
  LABEL_RE.test(label) && !RESERVED_SITE_LABELS.has(label)

async function labelFor(clinicId: string): Promise<string | null> {
  const [domain, clinic] = await Promise.all([
    prisma.siteDomain.findFirst({
      where: { clinicId, kind: 'SUBDOMAIN' },
      orderBy: { createdAt: 'asc' },
      select: { hostname: true },
    }),
    prisma.clinic.findFirst({ where: { id: clinicId }, select: { slug: true } }),
  ])
  const label = (domain?.hostname ?? clinic?.slug ?? '').split('.')[0]!.toLowerCase()
  return label && isLaunchableLabel(label) ? label : null
}

// ─── Queue (Redis) or in-process ────────────────────────────────────────────

let queue: Pick<Queue, 'add'> | null | undefined
function getQueue(): Pick<Queue, 'add'> | null {
  if (queue !== undefined) return queue
  if (!process.env.REDIS_URL) return (queue = null)
  const u = new URL(process.env.REDIS_URL)
  queue = new Queue(QUEUE_NAME, {
    connection: {
      host: u.hostname,
      port: Number(u.port || 6379),
      username: u.username || undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      ...(u.protocol === 'rediss:' ? { tls: { servername: u.hostname } } : {}),
    },
    defaultJobOptions: {
      attempts: SITE_LAUNCH_ATTEMPTS,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 100,
      removeOnFail: { age: 7 * 24 * 3600, count: 500 },
    },
  })
  return queue
}

/** Tests: run jobs in-process (null), or capture them. */
export function setSiteLaunchQueueForTests(q: Pick<Queue, 'add'> | null | undefined) {
  queue = q
}

export function createSiteLaunchWorker() {
  if (!process.env.REDIS_URL) return null
  const u = new URL(process.env.REDIS_URL)
  return new Worker(
    QUEUE_NAME,
    (job: Job<{ clinicId: string }>) =>
      runLaunch(job.data.clinicId, {
        attempt: job.attemptsMade + 1,
        final: job.attemptsMade + 1 >= SITE_LAUNCH_ATTEMPTS,
      }),
    {
      connection: {
        host: u.hostname,
        port: Number(u.port || 6379),
        username: u.username || undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
        ...(u.protocol === 'rediss:' ? { tls: { servername: u.hostname } } : {}),
      },
    }
  )
}

// ─── The job ────────────────────────────────────────────────────────────────

/**
 * One attempt. Throws on failure so the queue retries; on the final attempt
 * the row is FAILED and the platform team is told.
 */
export async function runLaunch(clinicId: string, opts: { attempt: number; final: boolean }) {
  return withTenantBypass('site-launch:job', async () => {
    const launch = await prisma.siteLaunch.findUnique({ where: { clinicId } })
    if (!launch || launch.status === 'LIVE' || launch.status === 'REMOVED') return launch
    const client = getPagesClient()
    if (!client) return launch
    await prisma.siteLaunch.update({
      where: { clinicId },
      data: { attempts: { increment: 1 }, status: 'PENDING' },
    })
    try {
      const deployed = await client.deployBranch(launch.label)
      const live = await prisma.siteLaunch.update({
        where: { clinicId },
        data: {
          status: 'LIVE',
          deploymentId: deployed.id,
          url: deployed.url,
          liveAt: new Date(),
          lastError: null,
        },
      })
      await auditService.logAudit({
        clinicId,
        entityType: 'SiteLaunch',
        entityId: live.id,
        action: 'SITE_ADDRESS_LIVE',
        newValue: { label: launch.label, attempt: opts.attempt },
        performedById: null,
      })
      return live
    } catch (err) {
      const reason = (err as Error).message.slice(0, 200) || 'Cloudflare could not be reached'
      if (!opts.final) {
        await prisma.siteLaunch.update({ where: { clinicId }, data: { lastError: reason } })
        throw err
      }
      const failed = await prisma.siteLaunch.update({
        where: { clinicId },
        data: { status: 'FAILED', lastError: reason },
      })
      await auditService.logAudit({
        clinicId,
        entityType: 'SiteLaunch',
        entityId: failed.id,
        action: 'SITE_ADDRESS_FAILED',
        newValue: { label: launch.label, attempts: failed.attempts },
        severity: 'warning',
        performedById: null,
      })
      await alertPlatform(clinicId, launch.label, reason)
      return failed
    }
  })
}

async function alertPlatform(clinicId: string, label: string, reason: string) {
  try {
    const clinic = await prisma.clinic.findFirst({
      where: { id: clinicId },
      select: { name: true },
    })
    let to = platformReviewRecipients()
    if (!to) {
      const admins = await prisma.user.findMany({
        where: { role: 'PLATFORM_ADMIN', isActive: true },
        select: { email: true },
        take: 20,
      })
      to = admins.map((a) => a.email)
    }
    for (const address of to) {
      await sendSiteLaunchFailedEmail({
        to: address,
        clinicName: clinic?.name ?? clinicId,
        label,
        reason,
      })
    }
  } catch (err) {
    console.warn('[site-launch] alert not sent:', (err as Error).message)
  }
  console.error(`[site-launch] ${label} failed after retries: ${reason}`)
}

/** In-process fallback: the same retries, one after another. */
async function runInline(clinicId: string) {
  for (let attempt = 1; attempt <= SITE_LAUNCH_ATTEMPTS; attempt++) {
    try {
      await runLaunch(clinicId, { attempt, final: attempt === SITE_LAUNCH_ATTEMPTS })
      return
    } catch {
      // retried below
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Called by Publish (and Retry). Idempotent: LIVE on the same label stays as
 * it is; otherwise the row is (re)set to PENDING and one job is queued.
 */
export async function requestLaunch(
  clinicId: string,
  opts: { force?: boolean; performedById?: string | null } = {}
): Promise<{ status: LaunchStatus }> {
  if (!getPagesClient()) return { status: 'NOT_CONFIGURED' }
  const label = await labelFor(clinicId)
  if (!label) return { status: 'NONE' }
  const existing = await prisma.siteLaunch.findUnique({ where: { clinicId } })
  if (existing?.status === 'LIVE' && existing.label === label && !opts.force)
    return { status: 'LIVE' }
  if (existing?.status === 'PENDING' && existing.label === label && !opts.force)
    return { status: 'PENDING' }
  await prisma.siteLaunch.upsert({
    where: { clinicId },
    create: { clinicId, label, status: 'PENDING' },
    update: { label, status: 'PENDING', lastError: null, attempts: 0 },
  })
  const q = getQueue()
  if (q) await q.add('launch', { clinicId }, { jobId: `site-launch-${clinicId}-${Date.now()}` })
  else void runInline(clinicId)
  return { status: 'PENDING' }
}

export async function launchStatus(clinicId: string) {
  if (!getPagesClient()) return { status: 'NOT_CONFIGURED' as LaunchStatus }
  const row = await prisma.siteLaunch.findUnique({
    where: { clinicId },
    select: { status: true, label: true, url: true, lastError: true, attempts: true, liveAt: true },
  })
  return row ? { ...row, status: row.status as LaunchStatus } : { status: 'NONE' as LaunchStatus }
}

/** Off-boarding: take the clinic's address down. Best effort, never throws. */
export async function removeLaunch(clinicId: string) {
  try {
    const row = await prisma.siteLaunch.findUnique({ where: { clinicId } })
    const client = getPagesClient()
    if (!row || !client) return 0
    const removed = await client.deleteBranch(row.label)
    await prisma.siteLaunch.update({ where: { clinicId }, data: { status: 'REMOVED' } })
    return removed
  } catch (err) {
    console.warn('[site-launch] address not removed:', (err as Error).message)
    return 0
  }
}
