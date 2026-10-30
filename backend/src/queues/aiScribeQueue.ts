/**
 * BullMQ queue for AI Scribe processing.
 * Queue name: ai-scribe-processing
 * Worker steps: transcribe → label speakers → draft (SOAP + timeline + orders
 * + continuity + patient summary) → map orders to the catalog.
 * The AI is whatever AI_SCRIBE_* configures (services/ai/registry.ts).
 * Visit note versions are only created during explicit provider approval.
 *
 * PHI (B2.6): job data holds ids only; failures are stored, logged and kept
 * as BullMQ failure reasons as safe codes (services/ai/errors.ts) — never
 * model input, model output or provider error text.
 */

import type { Job } from 'bullmq'
import { Queue, UnrecoverableError, Worker } from 'bullmq'
import prisma from '../config/prisma'
import * as storageService from '../services/storageService'
import * as rxCartService from '../services/rxCartService'
import * as auditService from '../services/auditService'
import { buildPriorDigest } from '../services/longitudinalService'
import { generateAnalysis, labelSpeakers, resolveBasePrompt } from '../services/scribeAnalysis'
import { getScribeAi, getScribeAiConfig, provenance } from '../services/ai/registry'
import { isAiError, safeFailureMessage } from '../services/ai/errors'
import { withTenantBypass } from '../config/tenantContext'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
}

function parseRedisUrl(url: string) {
  try {
    const u = new URL(url)
    return {
      host: u.hostname,
      port: parseInt(u.port || '6379', 10),
      username: u.username || undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      // rediss:// → TLS in transit (B0.6.2)
      ...(u.protocol === 'rediss:' ? { tls: { servername: u.hostname } } : {}),
    }
  } catch {
    return connection
  }
}

const redisConfig = process.env.REDIS_URL ? parseRedisUrl(REDIS_URL) : connection

export const AI_SCRIBE_QUEUE_NAME = 'ai-scribe-processing'
export const AI_SCRIBE_JOB_ATTEMPTS = 3
/** Whole-job ceiling; each provider call also has AI_SCRIBE_TIMEOUT_MS. */
const JOB_TIMEOUT_MS = 10 * 60_000

let _aiScribeQueue: Queue | null = null

export function getAiScribeQueue(): Queue {
  if (!_aiScribeQueue) {
    _aiScribeQueue = new Queue(AI_SCRIBE_QUEUE_NAME, {
      connection: redisConfig,
      defaultJobOptions: {
        attempts: AI_SCRIBE_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        // Failure reasons are safe codes, but keep the history bounded anyway.
        removeOnFail: { age: 7 * 24 * 3600, count: 500 },
      },
    })
  }
  return _aiScribeQueue
}

/** Tests only: route `aiScribeQueue` to a stand-in (no Redis). Pass null to restore. */
export function setAiScribeQueueForTests(queue: Pick<Queue, 'add'> | null): void {
  _aiScribeQueue = queue as Queue | null
}

/**
 * Lazy-initialized queue export. Calling .add() etc. will create the Redis
 * connection on first use instead of at import time, preventing crash loops
 * when Redis is unavailable at startup.
 */
export const aiScribeQueue = new Proxy({} as Queue, {
  get(_target, prop) {
    const queue = getAiScribeQueue()
    const value: unknown = Reflect.get(queue, prop)
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(queue) : value
  },
})

export interface AiScribeJobData {
  sessionId: string
  /** The session's clinic: the worker looks the session up scoped to it. */
  clinicId?: string
  /** When true, skip transcription and regenerate the draft from the stored transcript. */
  regenerateSoapOnly?: boolean
}

/** The parts of a BullMQ job the processor uses (tests pass a plain object). */
export interface ScribeJob {
  data: AiScribeJobData
  attemptsMade: number
  opts: { attempts?: number }
  updateProgress(progress: number): Promise<unknown>
}

function logStructured(event: string, data: Record<string, string | number | undefined>) {
  const parts = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  console.warn(`[AI Scribe] ${event} ${parts}`)
}

const MIME_BY_EXTENSION: Record<string, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  flac: 'audio/flac',
}

/** The audio's MIME type from its storage reference ("…/audio.wav" → audio/wav). */
export function mimeTypeForRef(ref: string): string {
  const ext = ref.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[ext] ?? 'audio/webm'
}

/**
 * Runs one scribe job. Exported for tests. Throws on failure; the worker
 * decides whether that failure is final (see `runScribeJob`).
 */
export async function processAiScribeJob(job: ScribeJob, signal?: AbortSignal): Promise<void> {
  const { sessionId, clinicId, regenerateSoapOnly } = job.data
  const ai = getScribeAi()

  const session = await prisma.aIScribeSession.findFirst({
    where: { id: sessionId, ...(clinicId ? { clinicId } : {}) },
    include: {
      provider: { select: { userId: true, scribeTone: true } },
      visitRecord: { select: { patientId: true } },
    },
  })
  if (!session) throw new UnrecoverableError('session_not_found')
  // Approved notes are final: a late or duplicate job is a no-op.
  if (session.status === 'APPROVED') return
  if (!regenerateSoapOnly && !session.audioUrl && !session.transcript) {
    throw new UnrecoverableError('audio_missing')
  }

  const scope = { id: sessionId, clinicId: session.clinicId }
  await prisma.aIScribeSession.update({
    where: scope,
    data: { processingStartedAt: new Date(), errorMessage: null, status: 'TRANSCRIBING' },
  })
  await job.updateProgress(10)

  // 1. Transcript. Reused when it already exists (regenerate, or a retry after
  //    transcription succeeded); uploading new audio clears it.
  let transcript = session.transcript
  let sttModel = session.sttModel
  if (!transcript) {
    const audio = await storageService.getAudioBufferFromRef(session.audioUrl!)
    await job.updateProgress(30)
    const result = await ai.stt.transcribe(
      {
        audio,
        mimeType: mimeTypeForRef(session.audioUrl!),
        language: getScribeAiConfig().language,
      },
      { signal }
    )
    transcript = result.text
    sttModel = result.model
    await prisma.aIScribeSession.update({ where: scope, data: { transcript, sttModel } })
  }
  await job.updateProgress(50)

  // 2. Speaker labels. Best effort and idempotent; the raw transcript stands
  //    when labelling fails for a reason a retry would not fix.
  try {
    const labelled = await labelSpeakers(ai.llm, transcript, { signal })
    if (labelled !== transcript) {
      transcript = labelled
      await prisma.aIScribeSession.update({ where: scope, data: { transcript } })
    }
  } catch (e) {
    if (isAiError(e) && e.retryable) throw e
    logStructured('Speaker labelling skipped', { sessionId, code: safeFailureMessage(e).code })
  }
  await job.updateProgress(60)

  // 3. Draft, with the patient's prior approved visits for continuity (FR-7).
  const tone = session.provider?.scribeTone ?? 'CONCISE'
  const [basePrompt, priorDigest] = await Promise.all([
    resolveBasePrompt(session.providerId, tone),
    buildPriorDigest(session.visitRecord.patientId, session.clinicId, session.visitRecordId),
  ])
  const { analysis, model } = await generateAnalysis(
    ai.llm,
    { basePrompt, transcript, priorDigest },
    { signal }
  )
  const llm = ai.llm.describe()

  // 4. B5.1: map detected products to the clinic catalog for provider review,
  //    before the draft is marked ready: the review screen loads the products
  //    as soon as it sees DRAFT_GENERATED, so they must already be current.
  //    Never fails the note: a mapping error only means no chips are shown.
  try {
    await rxCartService.upsertProposalForSession(sessionId, session.clinicId, analysis.orders)
  } catch (err) {
    logStructured('Rx proposal failed', { sessionId, code: safeFailureMessage(err).code })
  }

  await prisma.aIScribeSession.update({
    where: scope,
    data: {
      timeline: { ...analysis.timeline, continuity: analysis.continuity } as object,
      aiDraft: analysis.soap as object,
      // A draft for the provider to review and edit; patients only ever see it
      // once it is approved and published (B2.4).
      patientSummary: analysis.patientSummary as object,
      patientSummaryPublished: false,
      status: 'DRAFT_GENERATED',
      processingCompletedAt: new Date(),
      aiModel: model,
      aiProvider: provenance(llm),
      errorMessage: null,
    },
  })
  await job.updateProgress(80)

  // A consultation that fed this session now has its transcript.
  await prisma.consultationSession.updateMany({
    where: { aiScribeSessionId: sessionId, clinicId: session.clinicId, status: 'PROCESSING' },
    data: { status: 'TRANSCRIPT_READY', transcriptStatus: 'READY', errorMessage: null },
  })

  await auditService.logAudit({
    clinicId: session.clinicId,
    entityType: 'AIScribeSession',
    entityId: sessionId,
    action: regenerateSoapOnly ? 'AI_DRAFT_REGENERATED' : 'AI_DRAFT_GENERATED',
    // Provenance only — never content (FR-15).
    newValue: { aiProvider: provenance(llm), aiModel: model, sttModel },
    performedById: session.provider?.userId ?? null,
  })

  await job.updateProgress(100)
}

/**
 * Runs a job with a cancelling timeout and records the outcome. A session is
 * marked FAILED only when no retry is left (or the error cannot be fixed by
 * retrying), so the provider never sees FAILED while BullMQ is still trying.
 */
export async function runScribeJob(job: ScribeJob): Promise<void> {
  const { sessionId, clinicId } = job.data
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), JOB_TIMEOUT_MS)
  const startTime = Date.now()
  try {
    await processAiScribeJob(job, controller.signal)
    logStructured('Processing Completed', {
      sessionId,
      duration: `${Math.round((Date.now() - startTime) / 1000)}s`,
    })
  } catch (err) {
    const safe = controller.signal.aborted
      ? { code: 'ai_timeout', message: 'Processing took too long. Try again.' }
      : safeFailureMessage(err)
    const retryable =
      !(err instanceof UnrecoverableError) &&
      (controller.signal.aborted || (isAiError(err) ? err.retryable : true))
    const attempts = job.opts.attempts ?? 1
    const final = !retryable || job.attemptsMade + 1 >= attempts
    if (final) {
      await prisma.aIScribeSession.updateMany({
        where: { id: sessionId, ...(clinicId ? { clinicId } : {}), status: { not: 'APPROVED' } },
        data: { status: 'FAILED', errorMessage: safe.message },
      })
      await prisma.consultationSession.updateMany({
        where: {
          aiScribeSessionId: sessionId,
          ...(clinicId ? { clinicId } : {}),
          status: 'PROCESSING',
        },
        data: { status: 'FAILED', transcriptStatus: 'FAILED', errorMessage: safe.message },
      })
    }
    logStructured(final ? 'Processing Failed' : 'Processing attempt failed, retrying', {
      sessionId,
      code: safe.code,
      attempt: job.attemptsMade + 1,
    })
    // The failure reason BullMQ keeps in Redis is the code only.
    if (final && !(err instanceof UnrecoverableError)) throw new UnrecoverableError(safe.code)
    throw err instanceof UnrecoverableError ? err : new Error(safe.code)
  } finally {
    clearTimeout(timer)
  }
}

export function createAiScribeWorker(): Worker<AiScribeJobData> {
  const worker = new Worker<AiScribeJobData>(
    AI_SCRIBE_QUEUE_NAME,
    // BullMQ jobs run outside any HTTP request, so there's no protect() chain
    // to populate tenant context. The job is a named bypass; every lookup is
    // still scoped by the job's sessionId + clinicId.
    async (job) => withTenantBypass('ai-scribe-worker', () => runScribeJob(job as Job & ScribeJob)),
    {
      connection: redisConfig,
      concurrency: 2,
    }
  )

  worker.on('completed', (job) => {
    logStructured('Job Completed', { jobId: job.id, sessionId: job.data.sessionId })
  })

  worker.on('failed', (job, err) => {
    // err.message is a safe code (runScribeJob), never provider text.
    logStructured('Job Failed', {
      jobId: job?.id,
      sessionId: job?.data.sessionId,
      code: err.message,
    })
  })

  return worker
}
