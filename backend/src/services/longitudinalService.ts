/**
 * Longitudinal record (FR-7, B2.8): each visit builds on the previous ones.
 *
 * Two uses, both built only from notes a provider already approved:
 *  - `buildPriorDigest` — a minimum-necessary digest (dates + assessment +
 *    plan, truncated, no names) added to the scribe prompt so the draft can
 *    say what changed since the last visit. The provider reviews that text
 *    like any other part of the draft.
 *  - `getLongitudinalRecord` — the "record over time" panel on the review
 *    screen, straight from the database (no AI).
 * Same clinic only: another clinic's notes about the same patient never cross.
 */
import prisma from '../config/prisma'

export const PRIOR_VISIT_LIMIT = 3
const DIGEST_FIELD_CHARS = 600

export interface LongitudinalEntry {
  visitRecordId: string
  date: Date
  assessment: string | null
  plan: string | null
  products: Array<{ name: string; dose: string | null; quantity: number }>
}

const clip = (text: string | null | undefined, max: number): string | null => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

async function priorVisits(
  patientId: string,
  clinicId: string,
  excludeVisitRecordId: string,
  take: number
) {
  return prisma.visitRecord.findMany({
    where: {
      patientId,
      clinicId,
      isFinalized: true,
      id: { not: excludeVisitRecordId },
    },
    orderBy: { appointment: { startTime: 'desc' } },
    take,
    select: {
      id: true,
      assessment: true,
      plan: true,
      appointment: { select: { startTime: true } },
    },
  })
}

/**
 * The prompt section for prior visits, or null when this is the first
 * approved visit. Format (most recent first):
 *   - 2026-09-14 · Assessment: … · Plan: …
 */
export async function buildPriorDigest(
  patientId: string,
  clinicId: string,
  excludeVisitRecordId: string
): Promise<string | null> {
  const visits = await priorVisits(patientId, clinicId, excludeVisitRecordId, PRIOR_VISIT_LIMIT)
  const lines = visits
    .map((v) => {
      const assessment = clip(v.assessment, DIGEST_FIELD_CHARS)
      const plan = clip(v.plan, DIGEST_FIELD_CHARS)
      if (!assessment && !plan) return null
      const date = v.appointment.startTime.toISOString().slice(0, 10)
      return `- ${date} · Assessment: ${assessment ?? 'none recorded'} · Plan: ${plan ?? 'none recorded'}`
    })
    .filter((l): l is string => l !== null)
  return lines.length ? lines.join('\n') : null
}

/** Prior approved visits for the review screen, with the products that were sent. */
export async function getLongitudinalRecord(
  patientId: string,
  clinicId: string,
  excludeVisitRecordId: string,
  take = 10
): Promise<LongitudinalEntry[]> {
  const visits = await priorVisits(patientId, clinicId, excludeVisitRecordId, take)
  if (!visits.length) return []
  const proposals = await prisma.rxOrderProposal.findMany({
    where: { clinicId, status: 'CONFIRMED', visitRecordId: { in: visits.map((v) => v.id) } },
    select: {
      visitRecordId: true,
      lines: {
        where: { decision: 'CONFIRMED' },
        orderBy: { position: 'asc' },
        select: {
          rawText: true,
          dose: true,
          quantity: true,
          matchedProduct: { select: { name: true } },
        },
      },
    },
  })
  const productsByVisit = new Map(
    proposals.map((p) => [
      p.visitRecordId,
      p.lines.map((l) => ({
        name: l.matchedProduct?.name ?? l.rawText,
        dose: l.dose,
        quantity: l.quantity,
      })),
    ])
  )
  return visits.map((v) => ({
    visitRecordId: v.id,
    date: v.appointment.startTime,
    assessment: v.assessment,
    plan: v.plan,
    products: productsByVisit.get(v.id) ?? [],
  }))
}
