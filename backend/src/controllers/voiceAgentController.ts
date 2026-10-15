import type { Request, Response } from 'express'
import * as voiceAgentService from '../services/voiceAgentService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'
import type { ApiError } from '../types/errors'
import { z } from 'zod'

const clinicScope = (req: Request): string => {
  const clinicId = req.user!.clinicId
  if (!clinicId) {
    const err = new Error('Clinic context required') as ApiError
    err.statusCode = 400
    throw err
  }
  return clinicId
}

// ─────────────────────────── Config ──────────────────────────────────

export const getConfig = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = clinicScope(req)
  const config = await voiceAgentService.getOrCreateConfig(clinicId)
  successResponse(res, 200, 'Voice agent config', config)
})

const updateConfigSchema = z.object({
  enabled: z.boolean().optional(),
  greeting: z.string().min(10).max(800).optional(),
  persona: z.enum(['WARM', 'PROFESSIONAL', 'UPBEAT']).optional(),
  voice: z.enum(['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']).optional(),
  businessHours: z.record(z.string(), z.any()).nullable().optional(),
  afterHoursMessage: z.string().max(800).optional(),
  escalationPhone: z.string().nullable().optional(),
  capabilities: z.record(z.string(), z.boolean()).optional(),
  systemPromptExtra: z.string().nullable().optional(),
})

export const updateConfig = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = clinicScope(req)
  const patch = updateConfigSchema.parse(req.body)
  const updated = await voiceAgentService.updateConfig(clinicId, patch as never)
  successResponse(res, 200, 'Voice agent config updated', updated)
})

// ─────────────────────────── Realtime session ────────────────────────

export const createSession = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = clinicScope(req)
  const session = await voiceAgentService.createBrowserSession(clinicId)
  successResponse(res, 200, 'Realtime session ready', session)
})

// ─────────────────────────── Calls ────────────────────────────────────

export const startCall = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = clinicScope(req)
  const call = await voiceAgentService.startCall(clinicId, 'BROWSER')
  successResponse(res, 200, 'Call started', call)
})

const endCallSchema = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'FAILED', 'TRANSFERRED', 'ABANDONED']).optional(),
  outcome: z
    .enum([
      'APPOINTMENT_BOOKED',
      'APPOINTMENT_RESCHEDULED',
      'APPOINTMENT_CANCELLED',
      'MESSAGE_TAKEN',
      'REFILL_REQUESTED',
      'INFO_PROVIDED',
      'TRANSFERRED_TO_HUMAN',
      'NO_ACTION',
    ])
    .optional(),
  transcript: z.array(z.any()).optional(),
  durationSec: z.number().int().nonnegative().optional(),
  callerName: z.string().optional(),
  patientId: z.string().optional(),
})

export const endCall = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = clinicScope(req)
  const callId = String(req.params.id ?? '')
  const patch = endCallSchema.parse(req.body)
  const updated = await voiceAgentService.endCall(callId, clinicId, patch)
  successResponse(res, 200, 'Call ended', updated)
})

export const listCalls = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = clinicScope(req)
  const limit = req.query.limit ? Number(req.query.limit) : 30
  const calls = await voiceAgentService.listCalls(clinicId, { limit })
  successResponse(res, 200, 'Calls', calls)
})

export const getCall = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = clinicScope(req)
  const call = await voiceAgentService.getCall(String(req.params.id ?? ''), clinicId)
  successResponse(res, 200, 'Call', call)
})

export const summarizeCall = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = clinicScope(req)
  const call = await voiceAgentService.summarizeCall(String(req.params.id ?? ''), clinicId)
  successResponse(res, 200, 'Call summarized', call)
})

// ─────────────────────────── Tool execution ──────────────────────────

const toolSchema = z.object({
  callId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.any()).default({}),
})

export const executeTool = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = clinicScope(req)
  const { callId, toolName, args } = toolSchema.parse(req.body)
  const result = await voiceAgentService.executeTool({
    callId,
    clinicId,
    toolName,
    args,
  })
  successResponse(res, 200, 'Tool result', { result })
})

// ─────────────────────────── Groq turn (push-to-talk) ────────────────

export const runTurn = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = clinicScope(req)
  const callId = String((req.body as { callId?: string | number | null }).callId ?? '')
  if (!callId) {
    const err = new Error('callId required') as ApiError
    err.statusCode = 400
    throw err
  }
  const file = (req as Request & { file?: { buffer: Buffer; mimetype: string } }).file
  if (!file?.buffer) {
    const err = new Error('audio file required') as ApiError
    err.statusCode = 400
    throw err
  }
  const result = await voiceAgentService.runTurn(
    callId,
    clinicId,
    file.buffer,
    file.mimetype || 'audio/webm'
  )
  successResponse(res, 200, 'Turn complete', result)
})

export const getGreeting = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = clinicScope(req)
  const greeting = await voiceAgentService.getGreeting(clinicId)
  const tts = await voiceAgentService.speak(clinicId, greeting)
  const audioBase64 = 'audioBase64' in tts ? tts.audioBase64 : undefined
  const audioMime = 'audioBase64' in tts ? tts.mime : undefined
  const ttsError = 'error' in tts ? tts.error : undefined
  successResponse(res, 200, 'Greeting', {
    greeting,
    audioBase64,
    audioMime,
    ttsError,
  })
})

const speakSchema = z.object({ text: z.string().min(1).max(2000) })

export const speakText = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = clinicScope(req)
  const { text } = speakSchema.parse(req.body)
  const tts = await voiceAgentService.speak(clinicId, text)
  if ('error' in tts) {
    const err = new Error(tts.error) as ApiError
    err.statusCode = 503
    throw err
  }
  successResponse(res, 200, 'Synthesized', {
    audioBase64: tts.audioBase64,
    audioMime: tts.mime,
  })
})
