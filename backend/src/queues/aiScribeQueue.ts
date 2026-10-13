/**
 * BullMQ queue for AI Scribe processing.
 * Queue name: ai-scribe-processing
 * Worker steps: transcribe (Whisper) -> generate SOAP (GPT) -> update session.
 * Visit note versions are only created during explicit provider approval.
 */

import { Queue, Worker, Job } from 'bullmq'
import prisma from '../config/prisma'
import * as aiScribeService from '../services/aiScribeService'
import * as storageService from '../services/storageService'
import * as aiProviderService from '../services/aiProviderService'
import { withTenantBypass } from '../config/tenantContext'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import os from 'os'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const AI_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b'

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

let _aiScribeQueue: Queue | null = null

export function getAiScribeQueue(): Queue {
  if (!_aiScribeQueue) {
    _aiScribeQueue = new Queue(AI_SCRIBE_QUEUE_NAME, {
      connection: redisConfig,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
      },
    })
  }
  return _aiScribeQueue
}

/**
 * Lazy-initialized queue export. Calling .add() etc. will create the Redis
 * connection on first use instead of at import time, preventing crash loops
 * when Redis is unavailable at startup.
 */
export const aiScribeQueue = new Proxy({} as Queue, {
  get(_target, prop) {
    const queue = getAiScribeQueue()
    const value = (queue as any)[prop]
    return typeof value === 'function' ? value.bind(queue) : value
  },
})

export interface AiScribeJobData {
  sessionId: string
  /** When true, skip Whisper and regenerate SOAP from existing transcript only */
  regenerateSoapOnly?: boolean
}

function logStructured(event: string, data: Record<string, string | number | undefined>) {
  const parts = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  console.log(`[AI Scribe] ${event} ${parts}`)
}

async function fetchAudioBuffer(audioRef: string): Promise<Buffer> {
  if (audioRef.startsWith('s3:') || audioRef.startsWith('local:')) {
    return storageService.getAudioBufferFromRef(audioRef)
  }
  if (audioRef.startsWith('/uploads/') || audioRef.startsWith('uploads/')) {
    const normalized = audioRef.startsWith('/') ? audioRef.slice(1) : audioRef
    const fullPath = path.join(process.cwd(), normalized)
    return fs.readFileSync(fullPath)
  }
  if (audioRef.startsWith('http')) {
    return new Promise((resolve, reject) => {
      const client = audioRef.startsWith('https') ? https : http
      client
        .get(audioRef, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => resolve(Buffer.concat(chunks)))
          res.on('error', reject)
        })
        .on('error', reject)
    })
  }
  throw new Error('Invalid audio reference')
}

async function transcribeWithWhisper(buffer: Buffer, mimeType: string): Promise<string> {
  return aiProviderService.transcribeAudio(buffer, mimeType)
}

function cleanTranscript(transcript: string): string {
  const fillerPhrases = [
    /\bhello doctor\b/gi,
    /\bgood morning\b/gi,
    /\bgood afternoon\b/gi,
    /\bgood evening\b/gi,
    /\bthank you\b/gi,
    /\bthanks\b/gi,
    /\bokay\b/gi,
    /\bok\b/gi,
    /\buh\b/gi,
    /\bum\b/gi,
    /\buhm\b/gi,
  ]
  let cleaned = transcript
  for (const pattern of fillerPhrases) {
    cleaned = cleaned.replace(pattern, ' ')
  }
  return cleaned.replace(/\s+/g, ' ').trim()
}

export interface ClinicalTimeline {
  symptoms: string[]
  duration: string | null
  assessment: string | null
  plan: string[]
}

export interface ClinicalAnalysisResult {
  timeline: ClinicalTimeline
  soap: aiScribeService.SoapDraft
}

async function resolveScribePrompt(
  providerId: string,
  tone: 'CONCISE' | 'DETAILED'
): Promise<string> {
  const fallbackPrompt = `Convert this medical conversation into a clinical timeline and a structured SOAP note.
Return valid JSON only, no markdown or extra text:
{"timeline": {"symptoms": [], "duration": "", "assessment": "", "plan": []}, "soap": {"subjective": "", "objective": "", "assessment": "", "plan": ""}}`

  try {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        scribeTemplate: { select: { systemPrompt: true, isActive: true } },
      },
    })
    const tpl = provider?.scribeTemplate
    if (tpl?.isActive && tpl.systemPrompt) {
      const toneNote =
        tone === 'DETAILED'
          ? '\n\nWrite a thorough, complete note. Preserve clinically relevant detail.'
          : '\n\nWrite a concise, scannable note. One or two crisp sentences per section unless complexity demands more.'
      return tpl.systemPrompt + toneNote
    }

    // No per-provider template — fall back to the platform GENERIC default.
    const generic = await prisma.scribeTemplate.findFirst({
      where: { clinicId: null, specialty: 'GENERIC', isActive: true },
      select: { systemPrompt: true },
    })
    if (generic?.systemPrompt) return generic.systemPrompt
  } catch (e) {
    console.warn('[scribeQueue] could not resolve template, falling back', e)
  }
  return fallbackPrompt
}

async function generateClinicalAnalysis(
  transcript: string,
  providerId: string,
  tone: 'CONCISE' | 'DETAILED'
): Promise<ClinicalAnalysisResult> {
  const cleaned = cleanTranscript(transcript)
  const systemPrompt = await resolveScribePrompt(providerId, tone)

  const text = await aiProviderService.chatCompletion({
    systemPrompt,
    userMessage: cleaned,
    jsonMode: true,
  })

  let parsed: any = {}
  try {
    // Try to find a JSON object in the text if it contains markdown or extra conversational text
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0])
    } else {
      parsed = JSON.parse(text)
    }
  } catch (err) {
    console.error('Failed to parse LLM JSON response:', err)
    parsed = {}
  }

  // --- Resilient parsing: deep search for keywords if structure is unexpected ---
  function findKeyAcross(obj: any, keys: string[]): any {
    if (!obj || typeof obj !== 'object') return undefined

    for (const key of keys) {
      // Direct match (case-insensitive)
      const exactMatch = Object.keys(obj).find((k) => k.toLowerCase() === key.toLowerCase())
      if (exactMatch && obj[exactMatch] !== undefined) return obj[exactMatch]
    }

    // Recursive search
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object') {
        const found = findKeyAcross(val, keys)
        if (found !== undefined) return found
      }
    }
    return undefined
  }

  // Try standard path first, fallback to deep search
  const soapSource = parsed.soap || parsed.aiDraft || parsed
  const timelineSource = parsed.timeline || parsed

  const timeline = {
    symptoms: findKeyAcross(timelineSource, ['symptom', 'symptoms']) || [],
    duration: findKeyAcross(timelineSource, ['duration', 'time']) || null,
    assessment:
      findKeyAcross(timelineSource, ['assessment', 'timelineAssessment', 'impression']) || null,
    plan: findKeyAcross(timelineSource, ['plan', 'timelinePlan', 'steps']) || [],
  }

  const soap = {
    subjective: String(findKeyAcross(soapSource, ['subjective', 's']) || ''),
    objective: String(findKeyAcross(soapSource, ['objective', 'o']) || ''),
    assessment: String(findKeyAcross(soapSource, ['assessment', 'a', 'impression']) || ''),
    plan: String(findKeyAcross(soapSource, ['plan', 'p', 'treatment']) || ''),
  }

  return {
    timeline: {
      symptoms: Array.isArray(timeline.symptoms) ? timeline.symptoms.map(String) : [],
      duration: timeline.duration != null ? String(timeline.duration) : null,
      assessment: timeline.assessment != null ? String(timeline.assessment) : null,
      plan: Array.isArray(timeline.plan) ? timeline.plan.map(String) : [],
    },
    soap,
  }
}

async function processAiScribeJob(job: Job<AiScribeJobData>) {
  const { sessionId, regenerateSoapOnly } = job.data
  const startTime = Date.now()

  const session = await prisma.aIScribeSession.findUnique({
    where: { id: sessionId },
    include: { provider: { select: { userId: true, scribeTone: true } } },
  })
  if (!session) {
    throw new Error('Session not found')
  }
  if (!regenerateSoapOnly && !session.audioUrl) {
    throw new Error('Session or audio not found')
  }

  if (session.status === 'APPROVED') {
    throw new Error('This session has already been finalized.')
  }

  const visitRecordId = session.visitRecordId
  const providerId = session.providerId

  try {
    await prisma.aIScribeSession.update({
      where: { id: sessionId },
      data: { processingStartedAt: new Date(), errorMessage: null },
    })
  } catch (err) {
    logStructured('Processing Start Failed', {
      sessionId,
      visitRecordId,
      providerId,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  await job.updateProgress(10)

  let transcript: string

  if (regenerateSoapOnly && session.transcript) {
    transcript = session.transcript
    try {
      await prisma.aIScribeSession.update({
        where: { id: sessionId },
        data: { status: 'TRANSCRIBING' },
      })
    } catch {
      // non-fatal
    }
    await job.updateProgress(40)
  } else {
    try {
      await prisma.aIScribeSession.update({
        where: { id: sessionId },
        data: { status: 'TRANSCRIBING' },
      })
    } catch {
      // non-fatal
    }

    const buffer = await fetchAudioBuffer(session.audioUrl!)
    const mimeType = 'audio/webm'
    await job.updateProgress(30)

    transcript = await transcribeWithWhisper(buffer, mimeType)
    await prisma.aIScribeSession.update({
      where: { id: sessionId },
      data: { transcript },
    })
    await job.updateProgress(50)
  }

  let finalTranscriptText = transcript

  try {
    const diarizationPrompt = `You are an expert medical transcriptionist. You have been given a messy block of text that represents a raw audio transcript of a patient consultation.
There are two speakers: a Provider (doctor) and a Patient.
Your job is to read the text, use context clues to figure out who is speaking, and rewrite the transcript as a clean dialogue.
Format your output exactly like this:
Provider: [text]
Patient: [text]
Output ONLY the dialogue, nothing else. Do not summarize, keep the exact words if possible.`

    const diarizedText = await aiProviderService.chatCompletion({
      systemPrompt: diarizationPrompt,
      userMessage: transcript,
      jsonMode: false,
    })

    if (diarizedText && diarizedText.length > 50) {
      finalTranscriptText = diarizedText
      await prisma.aIScribeSession.update({
        where: { id: sessionId },
        data: { transcript: finalTranscriptText },
      })
    }
  } catch (e) {
    console.warn('Pseudo-diarization failed, falling back to raw transcript', e)
  }

  const tone = session.provider?.scribeTone ?? 'CONCISE'
  const { timeline, soap: soapDraft } = await generateClinicalAnalysis(
    finalTranscriptText,
    providerId,
    tone
  )
  await prisma.aIScribeSession.update({
    where: { id: sessionId },
    data: {
      timeline: timeline as object,
      aiDraft: soapDraft as object,
      status: 'DRAFT_GENERATED',
      processingCompletedAt: new Date(),
      aiModel: AI_MODEL,
      errorMessage: null,
    },
  })
  await job.updateProgress(80)

  await job.updateProgress(100)

  const duration = Math.round((Date.now() - startTime) / 1000)
  logStructured('Processing Completed', {
    sessionId,
    visitRecordId,
    providerId,
    duration: `${duration}s`,
    model: AI_MODEL,
  })
}

export function createAiScribeWorker(): Worker<AiScribeJobData> {
  const worker = new Worker<AiScribeJobData>(
    AI_SCRIBE_QUEUE_NAME,
    async (job) => {
      // BullMQ jobs run outside any HTTP request, so there's no protect()
      // chain to populate tenant context. Wrap the whole job in a named
      // bypass — the job data carries sessionId which itself is scoped
      // (look it up via clinicScoped findFirst rather than findUnique to
      // avoid laundering it across tenants if a bug ever lets cross-tenant
      // sessionIds enter the queue).
      return withTenantBypass('ai-scribe-worker', async () => {
        const { sessionId } = job.data
        const JOB_TIMEOUT_MS = 600000 // 10 minutes for local AI processing
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('AI processing timeout')), JOB_TIMEOUT_MS)
        })
        try {
          await Promise.race([processAiScribeJob(job), timeoutPromise])
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          const session = await prisma.aIScribeSession.findUnique({
            where: { id: sessionId },
            select: { visitRecordId: true, providerId: true },
          })
          await prisma.aIScribeSession.update({
            where: { id: sessionId },
            data: {
              status: 'FAILED',
              errorMessage,
            },
          })
          logStructured('Processing Failed', {
            sessionId,
            visitRecordId: session?.visitRecordId,
            providerId: session?.providerId,
            error: errorMessage,
          })
          throw err
        }
      })
    },
    {
      connection: redisConfig,
      concurrency: 2,
    }
  )

  worker.on('completed', (job) => {
    logStructured('Job Completed', {
      jobId: job.id,
      sessionId: job.data.sessionId,
    })
  })

  worker.on('failed', (job, err) => {
    logStructured('Job Failed', {
      jobId: job?.id,
      sessionId: job?.data.sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
  })

  return worker
}
