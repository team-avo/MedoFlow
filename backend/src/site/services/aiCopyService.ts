/**
 * AI copywriting for a clinic's home page (B8.3). Rewrites the hero and the
 * closing call-to-action of the HOME page draft in the clinic's voice.
 *
 * Inputs are business facts only — the clinic name, service names and
 * discipline names. No patient data can reach the prompt (unit-tested).
 * Any model failure leaves the template copy untouched.
 */
import prisma from '../../config/prisma'
import { getScribeAi } from '../../services/ai/registry'
import { notFound } from '../errors'
import type { SiteActor } from '../actor'
import { upgradeSections } from '../content/legacy'
import { updatePageDraft } from './pageService'

export interface CopyFacts {
  clinicName: string
  services: string[]
  disciplines: string[]
}

export function buildCopyPrompt(facts: CopyFacts): { systemPrompt: string; userMessage: string } {
  const list = (xs: string[]) => (xs.length ? xs.slice(0, 12).join(', ') : 'general care')
  return {
    systemPrompt:
      'You are an expert healthcare website copywriter. Output ONLY valid JSON. Never invent ' +
      'credentials, statistics, prices, insurance claims or patient stories.',
    userMessage: [
      `Write homepage copy for a clinic named "${facts.clinicName}".`,
      `Disciplines: ${list(facts.disciplines)}.`,
      `Services: ${list(facts.services)}.`,
      'Return JSON exactly like:',
      '{"eyebrow":"…","headline":"…","subheadline":"…","ctaHeading":"…","ctaText":"…"}',
      'Rules: eyebrow ≤ 6 words; headline 5–9 words, benefit-focused; subheadline 1–2 warm',
      'sentences; ctaHeading ≤ 7 words; ctaText one short sentence. Plain text, no emoji.',
    ].join('\n'),
  }
}

export interface GeneratedCopy {
  eyebrow: string
  headline: string
  subheadline: string
  ctaHeading: string
  ctaText: string
}

export function parseCopy(raw: string): GeneratedCopy | null {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    const s = (k: string, max: number) =>
      typeof j[k] === 'string' ? j[k].replace(/\s+/g, ' ').trim().slice(0, max) : ''
    const copy = {
      eyebrow: s('eyebrow', 60),
      headline: s('headline', 120),
      subheadline: s('subheadline', 400),
      ctaHeading: s('ctaHeading', 120),
      ctaText: s('ctaText', 400),
    }
    return copy.headline ? copy : null
  } catch {
    return null
  }
}

export async function clinicFacts(clinicId: string): Promise<CopyFacts> {
  const [clinic, services, disciplines] = await Promise.all([
    prisma.clinic.findFirst({ where: { id: clinicId }, select: { name: true } }),
    prisma.service.findMany({
      where: { clinicId, isActive: true, isArchived: false },
      select: { name: true },
      take: 20,
    }),
    prisma.discipline.findMany({
      where: { clinicId, isArchived: false },
      select: { name: true },
      take: 10,
    }),
  ])
  if (!clinic) throw notFound('Clinic')
  return {
    clinicName: clinic.name,
    services: services.map((s) => s.name),
    disciplines: disciplines.map((d) => d.name),
  }
}

/** Personalises the HOME draft; returns whether the model produced copy. */
export async function personaliseHomeCopy(actor: SiteActor) {
  const home = await prisma.sitePage.findFirst({
    where: { clinicId: actor.clinicId, kind: 'HOME' },
    select: { id: true, draftSectionsJson: true },
  })
  if (!home) throw notFound('Home page')
  let copy: GeneratedCopy | null = null
  try {
    // The configured AI_SCRIBE_LLM_* model: the prompt holds business facts only.
    const { systemPrompt, userMessage } = buildCopyPrompt(await clinicFacts(actor.clinicId))
    const res = await getScribeAi().llm.complete({
      system: systemPrompt,
      user: userMessage,
      json: true,
      temperature: 0.7,
    })
    copy = parseCopy(res.text)
  } catch (e) {
    console.warn(
      '[site-ai] copy generation unavailable — keeping template copy:',
      (e as Error).message
    )
  }
  if (!copy) return { generated: false, pageId: home.id }

  const sections = upgradeSections(home.draftSectionsJson).map((s) => {
    if (s.type === 'hero') {
      return {
        ...s,
        settings: {
          ...s.settings,
          eyebrow: copy.eyebrow || s.settings.eyebrow,
          headline: copy.headline,
          subheadline: copy.subheadline || s.settings.subheadline,
        },
      }
    }
    if (s.type === 'booking-cta' && copy.ctaHeading) {
      return {
        ...s,
        settings: {
          ...s.settings,
          heading: copy.ctaHeading,
          text: copy.ctaText || s.settings.text,
        },
      }
    }
    return s
  })
  await updatePageDraft(actor, home.id, { sections })
  return { generated: true, pageId: home.id }
}
