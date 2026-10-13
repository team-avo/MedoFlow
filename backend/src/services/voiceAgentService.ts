/**
 * Voice Agent service — the AI Front Desk.
 *
 * Two halves:
 *   1. Session lifecycle: create ephemeral OpenAI Realtime sessions for
 *      the browser, record calls, generate summaries.
 *   2. Tool execution: every "intent" the agent can act on (book, lookup,
 *      take message) is a tool defined here and executed server-side
 *      with full tenant scoping. The browser never touches Prisma directly.
 */

import prisma from '../config/prisma'
import { ApiError } from '../types/errors'
import { VoiceCallChannel, VoiceCallStatus, VoiceCallOutcome, Prisma } from '@prisma/client'
import * as aiProviderService from './aiProviderService'
import * as availabilityService from './availabilityService'
import * as appointmentService from './appointmentService'
import * as groqService from './groqService'
import * as tts from './ttsService'
import type { ChatMessage, ChatTool, ChatToolCall } from './groqService'

const REALTIME_MODEL = 'gpt-realtime'

// ─────────────────────────── Tool definitions ────────────────────────
// Surface the agent's capabilities to OpenAI. Names + JSON schemas match
// what the model receives. Keep these tight — fewer tools = less drift.

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'lookup_patient',
    description:
      'Look up an existing patient by full name (and optionally date of birth). Use this at the start of every call to identify the caller. If multiple matches, ask the caller for their date of birth or email.',
    parameters: {
      type: 'object',
      properties: {
        fullName: { type: 'string', description: 'Full name as given' },
        email: { type: 'string', description: 'Email if offered, for disambiguation' },
      },
      required: ['fullName'],
    },
  },
  {
    type: 'function',
    name: 'check_availability',
    description: 'Find open appointment slots. Returns up to 10 slots matching the criteria.',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD). If omitted, today.',
        },
        providerName: {
          type: 'string',
          description: 'Provider name if patient asks for a specific one.',
        },
        serviceName: {
          type: 'string',
          description: 'Service or visit type.',
        },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'book_appointment',
    description:
      'Book a confirmed appointment. CRITICAL: pass the LITERAL patient id string from a prior successful lookup_patient result (looks like "cmoppo3lw000wxme0nh1kcuoa") and the LITERAL slot id string from a prior check_availability result (looks like "<providerId>::<serviceId>::<startISO>::<endISO>"). Do NOT pass placeholder text like "result_of_lookup_patient" — that will fail.',
    parameters: {
      type: 'object',
      properties: {
        patientId: {
          type: 'string',
          description: 'Exact patient id string from lookup_patient.patient.id',
        },
        slotId: {
          type: 'string',
          description:
            'Exact slot id string from check_availability.slots[N].id (contains :: separators)',
        },
        notes: { type: 'string', description: 'Brief reason or context.' },
      },
      required: ['patientId', 'slotId'],
    },
  },
  {
    type: 'function',
    name: 'take_message',
    description:
      'Queue a message for clinic staff to follow up. Use when caller has a non-bookable request, complaint, or detailed clinical question.',
    parameters: {
      type: 'object',
      properties: {
        callerName: { type: 'string' },
        callerPhone: { type: 'string' },
        message: { type: 'string' },
        urgency: {
          type: 'string',
          enum: ['routine', 'urgent', 'emergency'],
        },
      },
      required: ['message'],
    },
  },
  {
    type: 'function',
    name: 'request_refill',
    description: 'Queue a medication refill request for provider review.',
    parameters: {
      type: 'object',
      properties: {
        patientId: { type: 'string' },
        medication: { type: 'string' },
        pharmacy: { type: 'string' },
      },
      required: ['patientId', 'medication'],
    },
  },
  {
    type: 'function',
    name: 'transfer_to_human',
    description:
      'Transfer the call to a human staff member. Use only when the caller explicitly asks, is upset, or the request is outside your capabilities.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
      required: ['reason'],
    },
  },
  {
    type: 'function',
    name: 'get_clinic_info',
    description:
      'Answer questions about the clinic: hours, location, services offered, providers, parking, accepted insurance, etc.',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: ['hours', 'location', 'services', 'providers', 'insurance', 'pricing'],
        },
      },
      required: ['topic'],
    },
  },
]

// ─────────────────────────── Config ──────────────────────────────────

export const getOrCreateConfig = async (clinicId: string) => {
  let config = await prisma.voiceAgentConfig.findUnique({
    where: { clinicId },
  })
  if (!config) {
    config = await prisma.voiceAgentConfig.create({
      data: { clinicId },
    })
  }
  return config
}

export const updateConfig = async (clinicId: string, patch: Prisma.VoiceAgentConfigUpdateInput) => {
  await getOrCreateConfig(clinicId)
  return prisma.voiceAgentConfig.update({
    where: { clinicId },
    data: patch,
  })
}

// ─────────────────────────── Session creation ─────────────────────────

interface RealtimeClientSecretResponse {
  value: string
  expires_at: number
  session?: {
    id?: string
    model?: string
  }
}

/**
 * Build the system prompt from the clinic's config + a few generic guardrails.
 */
const buildSystemPrompt = async (clinicId: string): Promise<string> => {
  const [clinic, config] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { name: true },
    }),
    getOrCreateConfig(clinicId),
  ])

  const clinicName = clinic?.name ?? 'the clinic'
  const persona =
    config.persona === 'PROFESSIONAL'
      ? 'professional, calm, and concise'
      : config.persona === 'UPBEAT'
        ? 'warm, energetic, and upbeat'
        : 'warm, friendly, and conversational'

  return [
    `You are the AI front desk receptionist for ${clinicName}.`,
    `Your tone is ${persona}.`,
    '',
    'CRITICAL RULES:',
    '- This is a phone conversation. Keep every reply to ONE short sentence.',
    '- NEVER narrate that you are about to use a tool. Do not say "let me check", "one moment", "I will look that up". Just call the tool silently.',
    '- NEVER emit tool calls as text or XML inside your reply. Use the native tool_calls field exclusively.',
    '- After a tool returns, immediately respond to the caller with the result in a natural sentence.',
    '- Identify yourself as an AI assistant only in the very first turn — not on every reply.',
    "- Before booking, call lookup_patient with the caller's name. Do NOT invent an email — only pass an email if the caller said one. Call lookup_patient at most ONCE per turn.",
    '- Before calling check_availability, you need a date. If the caller says "tomorrow" pass tomorrow\'s ISO date (YYYY-MM-DD). Today is ' +
      new Date().toISOString().slice(0, 10) +
      '.',
    '- Never invent slots, providers, or clinical advice.',
    '- For clinical questions, decline medical advice and offer to take a message or transfer.',
    '- If the caller asks for a human, becomes upset, or the request is outside your capabilities, call transfer_to_human.',
    '- ALWAYS read the caller back the proposed date+time before calling book_appointment. Wait for them to confirm.',
    '',
    config.systemPromptExtra ?? '',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Create an OpenAI Realtime ephemeral session that the browser can use to
 * open a direct WebRTC connection. The browser never sees our API key.
 *
 * Per OpenAI's docs, we POST to /v1/realtime/sessions and receive a
 * client_secret that's short-lived (1 minute). The browser uses that to
 * connect.
 */
export const createBrowserSession = async (
  clinicId: string
): Promise<{
  sessionId: string
  clientSecret: string
  expiresAt: number
  model: string
  tools: typeof TOOL_DEFINITIONS
  systemPrompt: string
  voice: string
}> => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY not configured') as ApiError
    err.statusCode = 503
    err.code = 'openai_not_configured'
    throw err
  }

  const config = await getOrCreateConfig(clinicId)
  if (!config.enabled) {
    // Allow even when disabled — admin needs to test before flipping enabled.
    // The dashboard's "enabled" flag gates real PHONE calls, not browser tests.
  }

  const systemPrompt = await buildSystemPrompt(clinicId)

  // GA Realtime API (2025+) — endpoint is /v1/realtime/client_secrets and the
  // session config is nested under "session".
  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: REALTIME_MODEL,
        instructions: systemPrompt,
        audio: {
          input: {
            transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              silence_duration_ms: 700,
            },
          },
          output: {
            voice: config.voice,
          },
        },
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    console.error('[voiceAgent] OpenAI session creation failed:', text)
    const err = new Error(`OpenAI Realtime session failed: ${text}`) as ApiError
    err.statusCode = 502
    err.code = 'realtime_session_failed'
    throw err
  }

  const data = (await response.json()) as RealtimeClientSecretResponse

  return {
    sessionId: data.session?.id ?? 'unknown',
    clientSecret: data.value,
    expiresAt: data.expires_at,
    model: data.session?.model ?? REALTIME_MODEL,
    tools: TOOL_DEFINITIONS,
    systemPrompt,
    voice: config.voice,
  }
}

// ─────────────────────────── Call lifecycle ──────────────────────────

export const startCall = async (
  clinicId: string,
  channel: VoiceCallChannel = 'BROWSER',
  callerPhone?: string
) => {
  return prisma.voiceCall.create({
    data: {
      clinicId,
      channel,
      callerPhone,
      status: 'IN_PROGRESS',
    },
  })
}

export const endCall = async (
  callId: string,
  clinicId: string,
  patch: {
    status?: VoiceCallStatus
    outcome?: VoiceCallOutcome
    transcript?: unknown
    durationSec?: number
    callerName?: string
    patientId?: string
  }
) => {
  const call = await prisma.voiceCall.findFirst({
    where: { id: callId, clinicId },
  })
  if (!call) {
    const err = new Error('Call not found') as ApiError
    err.statusCode = 404
    throw err
  }
  return prisma.voiceCall.update({
    where: { id: callId, clinicId },
    data: {
      status: patch.status ?? 'COMPLETED',
      outcome: patch.outcome,
      transcript: patch.transcript as Prisma.InputJsonValue | undefined,
      durationSec: patch.durationSec,
      callerName: patch.callerName,
      patientId: patch.patientId,
      endedAt: new Date(),
    },
  })
}

export const listCalls = async (
  clinicId: string,
  opts: { limit?: number; cursor?: string } = {}
) => {
  return prisma.voiceCall.findMany({
    where: { clinicId },
    orderBy: { startedAt: 'desc' },
    take: opts.limit ?? 30,
    include: {
      events: { orderBy: { ts: 'asc' } },
    },
  })
}

export const getCall = async (callId: string, clinicId: string) => {
  const call = await prisma.voiceCall.findFirst({
    where: { id: callId, clinicId },
    include: { events: { orderBy: { ts: 'asc' } } },
  })
  if (!call) {
    const err = new Error('Call not found') as ApiError
    err.statusCode = 404
    throw err
  }
  return call
}

/**
 * Summarize a finished call. Uses the LLM to produce a one-paragraph
 * summary + 1-3 follow-up actions. Stored back on the call record.
 */
export const summarizeCall = async (callId: string, clinicId: string) => {
  const call = await getCall(callId, clinicId)
  const transcript = (call.transcript as Array<{ role: string; content: string }>) ?? []
  if (transcript.length === 0) return call

  const flat = transcript.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')

  const groqResp = await groqService.chatWithTools(
    [
      {
        role: 'system',
        content:
          'You summarize phone calls handled by an AI clinic receptionist. Output a single short paragraph (50-80 words) of what happened, then 1-3 bullet follow-up actions for clinic staff if any.',
      },
      { role: 'user', content: flat },
    ],
    [],
    { temperature: 0.2 }
  )
  const summary = (groqResp.content ?? '').trim()

  return prisma.voiceCall.update({
    where: { id: callId, clinicId },
    data: { summary },
  })
}

// ─────────────────────────── Tool execution ──────────────────────────
// Tools the agent invokes mid-call. Every one is tenant-scoped via clinicId.

const recordEvent = async (
  callId: string,
  type: string,
  toolName: string,
  argsJson: unknown,
  resultJson: unknown,
  errorMessage?: string
) => {
  await prisma.voiceCallEvent.create({
    data: {
      callId,
      type,
      toolName,
      argsJson: argsJson as Prisma.InputJsonValue,
      resultJson: resultJson as Prisma.InputJsonValue,
      errorMessage,
    },
  })
}

export interface ToolCallInput {
  callId: string
  clinicId: string
  toolName: string
  args: Record<string, unknown>
}

/**
 * Llama sometimes passes placeholder strings ("result_of_lookup_patient")
 * instead of the real ids returned by prior tool calls. Before executing,
 * scan the call's prior events and substitute real values when we detect a
 * placeholder. This makes the agent robust against the model's failure to
 * carry IDs across turns.
 */
const resolvePlaceholders = async (
  callId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const looksLikePlaceholder = (v: unknown): boolean =>
    typeof v === 'string' &&
    (/^result_of_/i.test(v) ||
      /^<.+>$/.test(v) ||
      /^(patient|slot)[_-]?(id)?$/i.test(v) ||
      v.trim() === '' ||
      v === 'unknown')

  // Only worth doing for book_appointment which is the chain-break point.
  if (toolName !== 'book_appointment') return args

  const needsPatient = looksLikePlaceholder(args.patientId)
  const needsSlot = looksLikePlaceholder(args.slotId)
  if (!needsPatient && !needsSlot) return args

  const events = await prisma.voiceCallEvent.findMany({
    where: { callId, type: 'tool_call' },
    orderBy: { ts: 'desc' },
    take: 12,
  })

  const out = { ...args }
  if (needsPatient) {
    for (const ev of events) {
      if (ev.toolName !== 'lookup_patient') continue
      const r = ev.resultJson as { patient?: { id?: string } } | null
      if (r?.patient?.id) {
        out.patientId = r.patient.id
        break
      }
    }
  }
  if (needsSlot) {
    for (const ev of events) {
      if (ev.toolName !== 'check_availability') continue
      const r = ev.resultJson as { slots?: Array<{ id: string }> } | null
      if (r?.slots && r.slots.length > 0) {
        out.slotId = r.slots[0]!.id
        break
      }
    }
  }
  return out
}

export const executeTool = async ({
  callId,
  clinicId,
  toolName,
  args,
}: ToolCallInput): Promise<unknown> => {
  try {
    const resolvedArgs = await resolvePlaceholders(callId, toolName, args)
    const result = await dispatchTool(clinicId, toolName, resolvedArgs)
    await recordEvent(callId, 'tool_call', toolName, resolvedArgs, result)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await recordEvent(callId, 'tool_error', toolName, args, null, message)
    return { ok: false, error: message }
  }
}

const dispatchTool = async (
  clinicId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> => {
  switch (toolName) {
    case 'lookup_patient':
      return lookupPatient(clinicId, String(args.fullName ?? ''), args.email as string | undefined)
    case 'check_availability':
      return checkAvailability(clinicId, args)
    case 'book_appointment':
      return bookAppointment(clinicId, args)
    case 'take_message':
      return takeMessage(clinicId, args)
    case 'request_refill':
      return requestRefill(clinicId, args)
    case 'transfer_to_human':
      return { ok: true, action: 'transfer', reason: String(args.reason ?? '') }
    case 'get_clinic_info':
      return getClinicInfo(clinicId, String(args.topic ?? ''))
    default:
      return { ok: false, error: `Unknown tool: ${toolName}` }
  }
}

const lookupPatient = async (clinicId: string, fullName: string, email?: string) => {
  if (!fullName.trim() && !email) {
    return { ok: false, error: 'Need at least a name to look up.' }
  }
  const matches = await prisma.user.findMany({
    where: {
      clinicId,
      role: 'PATIENT',
      isActive: true,
      ...(email
        ? { email: { equals: email, mode: 'insensitive' } }
        : { name: { contains: fullName.trim(), mode: 'insensitive' } }),
    },
    select: { id: true, name: true, email: true },
    take: 5,
  })

  if (matches.length === 0) {
    return {
      ok: true,
      found: false,
      message:
        'No patient found. Offer to register a new patient (collect name + email) or take a message for staff.',
    }
  }
  if (matches.length > 1) {
    return {
      ok: true,
      found: true,
      ambiguous: true,
      candidates: matches,
      message: 'Multiple matches. Ask the caller for their email to disambiguate.',
    }
  }
  return { ok: true, found: true, patient: matches[0] }
}

const checkAvailability = async (clinicId: string, args: Record<string, unknown>) => {
  const date = (args.date as string | undefined) ?? new Date().toISOString().slice(0, 10)
  const providerName = args.providerName as string | undefined
  const serviceName = args.serviceName as string | undefined

  // Resolve a service — required by getAvailableSlots. If the caller named one,
  // fuzzy-match. Otherwise pick the clinic's most common service as a fallback.
  let service = serviceName
    ? await prisma.service.findFirst({
        where: {
          clinicId,
          isActive: true,
          name: { contains: serviceName, mode: 'insensitive' },
        },
        select: { id: true, name: true, duration: true },
      })
    : null
  if (!service) {
    service = await prisma.service.findFirst({
      where: { clinicId, isActive: true },
      select: { id: true, name: true, duration: true },
      orderBy: { createdAt: 'asc' },
    })
  }
  if (!service) {
    return {
      ok: false,
      error: 'Clinic has no active services configured. Cannot suggest slots.',
    }
  }

  // Provider filter: strip "Dr." prefix; fall back to last-name match.
  let providers: Array<{
    id: string
    user: { name: string | null } | null
  }>
  if (providerName) {
    const cleaned = providerName.replace(/^\s*(?:Dr\.?|Doctor)\s+/i, '').trim()
    const tokens = cleaned.split(/\s+/)
    const lastName = tokens[tokens.length - 1] ?? cleaned
    providers = await prisma.provider.findMany({
      where: {
        clinicId,
        isActive: true,
        user: {
          OR: [
            { name: { contains: cleaned, mode: 'insensitive' } },
            { name: { contains: lastName, mode: 'insensitive' } },
          ],
        },
      },
      include: { user: { select: { name: true } } },
      take: 3,
    })
    // If still nothing, just fall through to sampling all providers.
    if (providers.length === 0) {
      providers = await prisma.provider.findMany({
        where: { clinicId, isActive: true },
        include: { user: { select: { name: true } } },
        take: 3,
      })
    }
  } else {
    providers = await prisma.provider.findMany({
      where: { clinicId, isActive: true },
      include: { user: { select: { name: true } } },
      take: 3,
    })
  }

  const slots: Array<{
    id: string
    providerName: string
    serviceName: string
    start: string
    end: string
  }> = []

  for (const provider of providers) {
    try {
      const open = await availabilityService.getAvailableSlots({
        providerId: provider.id,
        clinicId,
        serviceId: service.id,
        serviceDurationMinutes: service.duration,
        date,
      })
      for (const slot of open.slice(0, 4)) {
        slots.push({
          // slotId = providerId::serviceId::start::end — everything book needs.
          id: `${provider.id}::${service.id}::${slot.start}::${slot.end}`,
          providerName: provider.user?.name ?? 'Provider',
          serviceName: service.name,
          start: slot.start,
          end: slot.end,
        })
      }
    } catch {
      // Skip providers with config errors silently.
    }
  }

  if (slots.length === 0) {
    return {
      ok: true,
      found: false,
      message: 'No open slots for that day. Offer the next available day or take a message.',
    }
  }
  return { ok: true, found: true, service: service.name, slots: slots.slice(0, 10) }
}

const bookAppointment = async (clinicId: string, args: Record<string, unknown>) => {
  const patientId = String(args.patientId ?? '')
  const slotId = String(args.slotId ?? '')
  if (!patientId || !slotId) {
    return { ok: false, error: 'patientId and slotId required' }
  }
  const parts = slotId.split('::')
  if (parts.length !== 4 || parts.some((p) => !p)) {
    return { ok: false, error: 'Invalid slotId — use one returned from check_availability.' }
  }
  const providerId = parts[0]!
  const serviceId = parts[1]!
  const startTime = parts[2]!
  const endTime = parts[3]!
  try {
    const result = await appointmentService.createAppointment(
      {
        providerId,
        serviceId,
        patientId,
        startTime,
        endTime,
      },
      clinicId,
      { bookingSource: 'PUBLIC' }
    )
    // createAppointment returns { appointment, ... } in most cases.
    const wrapper = result as unknown as { appointment?: { id: string; startTime: Date } }
    const direct = result as unknown as { id?: string; startTime?: Date }
    const appt =
      wrapper.appointment ??
      (direct.id ? { id: direct.id, startTime: direct.startTime! } : undefined)
    if (!appt) {
      return { ok: false, error: 'Unexpected booking response shape.' }
    }
    return {
      ok: true,
      booked: true,
      appointment: {
        id: appt.id,
        startTime: appt.startTime,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Booking failed',
    }
  }
}

const takeMessage = async (clinicId: string, args: Record<string, unknown>) => {
  // Persist as a note on the call event log; staff review via the call list.
  return {
    ok: true,
    queued: true,
    message: 'Message recorded. Clinic staff will see this in the call log within a few minutes.',
    payload: {
      callerName: args.callerName,
      callerPhone: args.callerPhone,
      content: args.message,
      urgency: args.urgency ?? 'routine',
      clinicId,
    },
  }
}

const requestRefill = async (clinicId: string, args: Record<string, unknown>) => {
  return {
    ok: true,
    queued: true,
    message: 'Refill request queued for provider review.',
    payload: {
      patientId: args.patientId,
      medication: args.medication,
      pharmacy: args.pharmacy ?? null,
      clinicId,
    },
  }
}

const getClinicInfo = async (clinicId: string, topic: string) => {
  switch (topic) {
    case 'hours': {
      const cfg = await getOrCreateConfig(clinicId)
      return { ok: true, topic, businessHours: cfg.businessHours }
    }
    case 'location': {
      const loc = await prisma.location.findFirst({
        where: { clinicId },
        select: {
          name: true,
          addressLine1: true,
          city: true,
          state: true,
          postalCode: true,
          phone: true,
        },
      })
      return { ok: true, topic, location: loc }
    }
    case 'services': {
      const services = await prisma.service.findMany({
        where: { clinicId, isActive: true },
        select: { name: true, duration: true, defaultPrice: true },
        take: 12,
      })
      return { ok: true, topic, services }
    }
    case 'providers': {
      const providers = await prisma.provider.findMany({
        where: { clinicId, isActive: true },
        include: {
          user: { select: { name: true } },
          disciplines: { include: { discipline: { select: { name: true } } } },
        },
        take: 12,
      })
      return {
        ok: true,
        topic,
        providers: providers.map((p) => ({
          name: p.user?.name,
          disciplines: p.disciplines.map((d) => d.discipline?.name),
        })),
      }
    }
    case 'pricing': {
      const services = await prisma.service.findMany({
        where: { clinicId, isActive: true },
        select: { name: true, defaultPrice: true },
        take: 8,
      })
      return { ok: true, topic, pricing: services }
    }
    case 'insurance':
      return {
        ok: true,
        topic,
        message:
          'Tell the caller we accept most major insurance plans and recommend they call their insurer to confirm coverage. Offer to take a message if they want a callback.',
      }
    default:
      return { ok: false, error: `Unknown topic: ${topic}` }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Groq-powered turn pipeline (Phase 1, push-to-talk)
// ────────────────────────────────────────────────────────────────────────
// Each browser turn = one HTTP POST with an audio chunk. Pipeline:
//   1. Whisper STT (Groq) → user text
//   2. Load prior transcript from VoiceCall
//   3. Llama with tools (Groq) → assistant text + tool calls
//   4. Execute tool calls server-side (tenant-scoped)
//   5. Llama again with tool results → final assistant text
//   6. Persist updated transcript on the call row
// ────────────────────────────────────────────────────────────────────────

// OpenAI-Realtime tool defs use a flat shape; Groq/OpenAI Chat want a wrapped one.
const toGroqTools = (): ChatTool[] =>
  TOOL_DEFINITIONS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))

/**
 * Llama 3.x sometimes emits tool calls as `<function=name>{args}</function>`
 * inside content text instead of using native tool_calls. Parse them as a
 * fallback so we don't have to rely solely on the model behaving well.
 */
const parseTextFormattedToolCalls = (
  content: string | null
): { cleanedContent: string; extracted: ChatToolCall[] } => {
  if (!content) return { cleanedContent: '', extracted: [] }
  const re = /<function\s*=\s*([a-z_][a-z0-9_]*)\s*>([\s\S]*?)<\/function>/gi
  const extracted: ChatToolCall[] = []
  let cleaned = content
  let m: RegExpExecArray | null
  let idx = 0
  while ((m = re.exec(content)) !== null) {
    const [match, name, rawArgs] = m
    extracted.push({
      id: `text_${Date.now()}_${idx++}`,
      type: 'function',
      function: { name: name!, arguments: (rawArgs ?? '').trim() || '{}' },
    })
    cleaned = cleaned.replace(match, '').trim()
  }
  return { cleanedContent: cleaned, extracted }
}

export interface TurnResult {
  userText: string
  assistantText: string
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>
  transcript: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>
  audioBase64?: string
  audioMime?: string
  ttsError?: string
}

/**
 * Speak text using Google Cloud TTS, mapped to the clinic's configured
 * persona. Returns base64 audio that the browser can play inline.
 * Soft-fails: returns null + error message if TTS isn't configured.
 */
export const speak = async (
  clinicId: string,
  text: string
): Promise<{ audioBase64: string; mime: string } | { error: string }> => {
  const config = await getOrCreateConfig(clinicId)
  try {
    const result = await tts.synthesize(text, { persona: config.persona })
    return { audioBase64: result.audioBase64, mime: result.mimeType }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'TTS failed' }
  }
}

export const runTurn = async (
  callId: string,
  clinicId: string,
  audio: Buffer,
  mimeType: string
): Promise<TurnResult> => {
  const { text: userText } = await groqService.transcribe(audio, mimeType)
  if (!userText) {
    return {
      userText: '',
      assistantText: "Sorry, I didn't catch that. Could you say it again?",
      toolCalls: [],
      transcript: [],
    }
  }
  return runTurnWithText(callId, clinicId, userText)
}

/**
 * Run a turn with pre-transcribed text. Used by the audio path (after STT)
 * and by scripted tests / future text-chat mode.
 */
export const runTurnWithText = async (
  callId: string,
  clinicId: string,
  userText: string
): Promise<TurnResult> => {
  // 2. Load history + system prompt.
  const call = await prisma.voiceCall.findFirst({
    where: { id: callId, clinicId },
    select: { transcript: true },
  })
  if (!call) {
    const err = new Error('Call not found') as ApiError
    err.statusCode = 404
    throw err
  }
  const historyRaw =
    (call.transcript as unknown as Array<{
      role: 'user' | 'assistant'
      content: string
      ts: number
    }>) ?? []
  const systemPrompt = await buildSystemPrompt(clinicId)

  // Trim to last 12 messages (6 turns) to stay under Groq's per-minute token cap.
  const trimmedHistory = historyRaw.slice(-12)
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory.map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content,
    })),
    { role: 'user', content: userText },
  ]

  // 3. First LLM pass — may emit tool calls.
  const tools = toGroqTools()
  let response = await groqService.chatWithTools(messages, tools)
  const toolEvents: TurnResult['toolCalls'] = []

  // Patch: if the model emitted tool calls as text (`<function=...>...</function>`),
  // promote them to native tool_calls. Llama 3.x does this occasionally.
  if (response.toolCalls.length === 0 && response.content) {
    const { cleanedContent, extracted } = parseTextFormattedToolCalls(response.content)
    if (extracted.length > 0) {
      response = { ...response, content: cleanedContent || null, toolCalls: extracted }
    }
  }

  // 4. Execute up to 3 tool-call rounds (chain-of-thought safety cap).
  let rounds = 0
  while (response.toolCalls.length > 0 && rounds < 3) {
    // Append the assistant message that requested the tool calls.
    messages.push({
      role: 'assistant',
      content: response.content ?? '',
      tool_calls: response.toolCalls,
    })

    // Execute each tool call sequentially and feed results back.
    for (const tc of response.toolCalls) {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = JSON.parse(tc.function.arguments || '{}')
      } catch {
        parsedArgs = {}
      }
      const result = await executeTool({
        callId,
        clinicId,
        toolName: tc.function.name,
        args: parsedArgs,
      })
      toolEvents.push({ name: tc.function.name, args: parsedArgs, result })
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      })
    }

    rounds += 1
    response = await groqService.chatWithTools(messages, tools)
    // Apply the same text-tool-call salvage on follow-up rounds.
    if (response.toolCalls.length === 0 && response.content) {
      const { cleanedContent, extracted } = parseTextFormattedToolCalls(response.content)
      if (extracted.length > 0) {
        response = { ...response, content: cleanedContent || null, toolCalls: extracted }
      }
    }
  }

  const assistantText =
    (response.content ?? '').trim() || 'Let me transfer you to a human staff member.'

  // 5. Persist updated transcript.
  const now = Date.now()
  const newTranscript = [
    ...historyRaw,
    { role: 'user' as const, content: userText, ts: now },
    { role: 'assistant' as const, content: assistantText, ts: now + 1 },
  ]
  await prisma.voiceCall.update({
    where: { id: callId, clinicId },
    data: { transcript: newTranscript as unknown as Prisma.InputJsonValue },
  })

  // 6. Synthesize the reply via Google TTS. Soft-fails if disabled.
  const ttsResult = await speak(clinicId, assistantText)
  const audioBase64 = 'audioBase64' in ttsResult ? ttsResult.audioBase64 : undefined
  const audioMime = 'audioBase64' in ttsResult ? ttsResult.mime : undefined
  const ttsError = 'error' in ttsResult ? ttsResult.error : undefined

  return {
    userText,
    assistantText,
    toolCalls: toolEvents,
    transcript: newTranscript,
    audioBase64,
    audioMime,
    ttsError,
  }
}

// Static greeting — Groq path doesn't open with a stream, so the UI greets first.
export const getGreeting = async (clinicId: string): Promise<string> => {
  const config = await getOrCreateConfig(clinicId)
  return config.greeting
}
