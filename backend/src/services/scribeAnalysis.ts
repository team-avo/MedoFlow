/**
 * The scribe's AI steps (FR-3 … FR-7, B2.2): label speakers, then draft the
 * SOAP note, timeline, detected orders (name + dose + quantity), the
 * "since last visit" line and the patient-facing summary — one call whose
 * output must match `ScribeAnalysisShape`. Invalid output gets one repair
 * pass, then fails as `ai_bad_output`; nothing half-parsed reaches a note.
 *
 * Nothing here logs model input or output: both are PHI.
 */
import { z } from 'zod'
import prisma from '../config/prisma'
import { AiError } from './ai/errors'
import { PRIOR_VISITS_MARKER } from './ai/mock'
import type { CallOptions, LlmProvider } from './ai/types'
import { MAX_ORDERS, parseScribeOrders, type ScribeOrder } from './rxMappingService'

export interface SoapDraft {
  subjective: string
  objective: string
  assessment: string
  plan: string
}

export interface PatientSummary {
  diagnosis: string
  treatmentPlan: string
  nextSteps: string
}

export interface ClinicalTimeline {
  symptoms: string[]
  duration: string | null
  assessment: string | null
  plan: string[]
  /** FR-7: what changed since the last approved visit; null on a first visit. */
  continuity?: string | null
}

export interface ScribeAnalysis {
  soap: SoapDraft
  timeline: ClinicalTimeline
  orders: ScribeOrder[]
  continuity: string | null
  patientSummary: PatientSummary
}

const MAX_SECTION = 20_000
const MAX_ITEM = 500

/** The JSON the model is asked for (also sent as the json_schema). */
export const ScribeAnalysisShape = z.object({
  soap: z.object({
    subjective: z.string(),
    objective: z.string(),
    assessment: z.string(),
    plan: z.string(),
  }),
  timeline: z.object({
    symptoms: z.array(z.string()),
    duration: z.string().nullable(),
    assessment: z.string().nullable(),
    plan: z.array(z.string()),
  }),
  orders: z.array(
    z.object({ name: z.string(), dose: z.string().nullable(), quantity: z.number().nullable() })
  ),
  continuity: z.string().nullable(),
  patientSummary: z.object({
    diagnosis: z.string(),
    treatmentPlan: z.string(),
    nextSteps: z.string(),
  }),
})

let jsonSchemaCache: Record<string, unknown> | null = null
export function scribeJsonSchema(): Record<string, unknown> {
  if (!jsonSchemaCache) {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(ScribeAnalysisShape) as Record<
      string,
      unknown
    >
    jsonSchemaCache = schema
  }
  return jsonSchemaCache
}

/** Appended to every scribe prompt (template or fallback). */
export const OUTPUT_CONTRACT = `

OUTPUT FORMAT — this replaces any output format described above. Return one JSON object only, no markdown, no commentary:
{"soap":{"subjective":"","objective":"","assessment":"","plan":""},"timeline":{"symptoms":[],"duration":null,"assessment":null,"plan":[]},"orders":[{"name":"","dose":null,"quantity":1}],"continuity":null,"patientSummary":{"diagnosis":"","treatmentPlan":"","nextSteps":""}}
Rules:
- soap: the clinical note, from what was said only. Never invent findings, vitals, results or doses. Write "Not discussed." for a section with no content.
- orders: every product, supplement, topical or medication the provider recommended or prescribed in this visit. "name" without strength; "dose" is the strength as spoken (e.g. "400 mg", "5000 IU") or null; "quantity" is the whole number of packs or units (default 1). Use [] when there are none. Never add an order that was not said.
- continuity: when ${PRIOR_VISITS_MARKER} are given, one or two sentences on what changed since the most recent one; otherwise null. Do not copy prior notes into this visit's soap.
- patientSummary: plain language for the patient, no jargon and no internal reasoning: what was found, what was recommended, what to do next.`

const FALLBACK_PROMPT =
  'Convert this medical conversation into a clinical timeline and a structured SOAP note. Be concise and clinically accurate.'

/** The provider's template (+ tone), else the platform GENERIC template, else a fallback. */
export async function resolveBasePrompt(
  providerId: string,
  tone: 'CONCISE' | 'DETAILED'
): Promise<string> {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { scribeTemplate: { select: { systemPrompt: true, isActive: true } } },
  })
  const tpl = provider?.scribeTemplate
  if (tpl?.isActive && tpl.systemPrompt) {
    const toneNote =
      tone === 'DETAILED'
        ? '\n\nWrite a thorough, complete note. Preserve clinically relevant detail.'
        : '\n\nWrite a concise, scannable note. One or two crisp sentences per section unless complexity demands more.'
    return tpl.systemPrompt + toneNote
  }
  const generic = await prisma.scribeTemplate.findFirst({
    where: { clinicId: null, specialty: 'GENERIC', isActive: true },
    select: { systemPrompt: true },
  })
  return generic?.systemPrompt || FALLBACK_PROMPT
}

export function buildAnalysisUserMessage(transcript: string, priorDigest: string | null): string {
  const parts = [`TRANSCRIPT:\n${transcript}`]
  if (priorDigest) {
    parts.push(
      `${PRIOR_VISITS_MARKER} (most recent first; context for continuity only):\n${priorDigest}`
    )
  }
  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// Normalising model output
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

/** The first JSON object in the text (models sometimes wrap it in prose or a fence). */
export function extractJsonObject(text: string): Json | null {
  const trimmed = text.trim()
  const candidates = [trimmed]
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1))
  for (const c of candidates) {
    try {
      const parsed: unknown = JSON.parse(c)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Json
    } catch {
      // try the next candidate
    }
  }
  return null
}

const field = (obj: Json, ...keys: string[]): unknown => {
  for (const key of keys) {
    const k = Object.keys(obj).find((x) => x.toLowerCase() === key.toLowerCase())
    if (k !== undefined && obj[k] !== undefined) return obj[k]
  }
  return undefined
}

/**
 * Text for a note section. Strings pass; numbers and string lists are
 * joined; objects are refused (null) — never "[object Object]".
 */
function asText(v: unknown, max = MAX_SECTION): string | null {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v.trim().slice(0, max)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
    return v.map(String).join('\n').trim().slice(0, max)
  }
  return null
}

const asNullableText = (v: unknown, max = MAX_ITEM): string | null => {
  const t = asText(v, max)
  return t ? t : null
}

const asTextList = (v: unknown): string[] => {
  if (typeof v === 'string') return v.trim() ? [v.trim().slice(0, MAX_ITEM)] : []
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x).trim() : ''))
    .filter(Boolean)
    .slice(0, 50)
    .map((x) => x.slice(0, MAX_ITEM))
}

/** Normalises parsed model output; null when the SOAP part is unusable. */
export function normalizeAnalysis(raw: Json): ScribeAnalysis | null {
  const soapSource = (field(raw, 'soap', 'soapNote', 'note') as Json | undefined) ?? raw
  if (!soapSource || typeof soapSource !== 'object') return null
  const soap = {
    subjective: asText(field(soapSource, 'subjective', 's')),
    objective: asText(field(soapSource, 'objective', 'o')),
    assessment: asText(field(soapSource, 'assessment', 'a')),
    plan: asText(field(soapSource, 'plan', 'p')),
  }
  if (Object.values(soap).some((v) => v === null)) return null
  if (Object.values(soap).every((v) => !v)) return null

  const tl = field(raw, 'timeline')
  const timelineSource: Json =
    tl && typeof tl === 'object' && !Array.isArray(tl) ? (tl as Json) : {}
  const summary = field(raw, 'patientSummary', 'patient_summary', 'summary')
  const summarySource: Json =
    summary && typeof summary === 'object' && !Array.isArray(summary) ? (summary as Json) : {}

  const analysis: ScribeAnalysis = {
    soap: soap as SoapDraft,
    timeline: {
      symptoms: asTextList(field(timelineSource, 'symptoms')),
      duration: asNullableText(field(timelineSource, 'duration')),
      assessment: asNullableText(field(timelineSource, 'assessment')),
      plan: asTextList(field(timelineSource, 'plan')),
    },
    orders: parseScribeOrders(field(raw, 'orders', 'products', 'prescriptions')).slice(
      0,
      MAX_ORDERS
    ),
    continuity: asNullableText(field(raw, 'continuity'), 2000),
    patientSummary: {
      diagnosis: asText(field(summarySource, 'diagnosis')) ?? '',
      treatmentPlan: asText(field(summarySource, 'treatmentPlan', 'treatment_plan')) ?? '',
      nextSteps: asText(field(summarySource, 'nextSteps', 'next_steps')) ?? '',
    },
  }
  // A final guard: the normalised result must match the contract exactly.
  const check = ScribeAnalysisShape.safeParse({
    ...analysis,
    orders: analysis.orders.map((o) => ({
      name: o.name,
      dose: o.dose ?? null,
      quantity: o.quantity ?? null,
    })),
  })
  return check.success ? analysis : null
}

// ---------------------------------------------------------------------------
// AI steps
// ---------------------------------------------------------------------------

/** One SOAP draft (+ timeline, orders, continuity, summary) for a transcript. */
export async function generateAnalysis(
  llm: LlmProvider,
  input: { basePrompt: string; transcript: string; priorDigest: string | null },
  opts: CallOptions = {}
): Promise<{ analysis: ScribeAnalysis; model: string }> {
  const jsonSchema = { name: 'scribe_analysis', schema: scribeJsonSchema() }
  const first = await llm.complete(
    {
      system: input.basePrompt + OUTPUT_CONTRACT,
      user: buildAnalysisUserMessage(input.transcript, input.priorDigest),
      jsonSchema,
      temperature: 0.2,
    },
    opts
  )
  const parsed = extractJsonObject(first.text)
  const analysis = parsed ? normalizeAnalysis(parsed) : null
  if (analysis) return { analysis, model: first.model }

  // One repair pass on the same provider; then give up cleanly.
  const repaired = await llm.complete(
    {
      system:
        'You repair JSON. Rewrite the text below as one JSON object that matches this JSON Schema exactly. ' +
        'Keep the content; do not add facts. Return only the JSON.\n\nSchema:\n' +
        JSON.stringify(jsonSchema.schema),
      user: first.text,
      jsonSchema,
      temperature: 0,
    },
    opts
  )
  const reparsed = extractJsonObject(repaired.text)
  const fixed = reparsed ? normalizeAnalysis(reparsed) : null
  if (!fixed) throw new AiError('ai_bad_output')
  return { analysis: fixed, model: repaired.model }
}

export const SPEAKER_LABELS = /^(provider|patient)\s*:/im

const LABEL_PROMPT = `You are an expert medical transcriptionist. The text is a raw transcript of a consultation between a Provider (clinician) and a Patient.
Rewrite it as a dialogue, one turn per line, using context to decide who is speaking:
Provider: [words]
Patient: [words]
Keep the exact words. Do not summarise, correct, omit or add anything. Output only the dialogue.`

/**
 * Labels speakers ("Provider:" / "Patient:"). Idempotent: an already
 * labelled transcript is returned unchanged, so a retried job never
 * relabels. A result that drops much of the text (a summary, not a
 * transcript) is discarded in favour of the raw text.
 */
export async function labelSpeakers(
  llm: LlmProvider,
  transcript: string,
  opts: CallOptions = {}
): Promise<string> {
  if (SPEAKER_LABELS.test(transcript) || transcript.trim().length < 40) return transcript
  const res = await llm.complete({ system: LABEL_PROMPT, user: transcript, temperature: 0 }, opts)
  const labelled = res.text.trim()
  if (!SPEAKER_LABELS.test(labelled)) return transcript
  if (labelled.length < transcript.trim().length * 0.6) return transcript
  return labelled
}
