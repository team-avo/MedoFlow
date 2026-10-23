/**
 * The section library (B8.4). Each section type has a strict settings schema
 * and a fixed set of layout variants. The frontend registry
 * (frontend/lib/site/sections.ts) defines the same types, fields and
 * variants; shared/validation-cases/site-sections.json holds both to the
 * same accept/reject cases.
 */
import crypto from 'crypto'
import { z } from 'zod'
import {
  ctaSchema,
  entityId,
  externalHref,
  imageRefSchema,
  longText,
  markdownText,
  shortText,
} from './primitives'

const ids = (max: number) => z.array(entityId).max(max).default([])
const count = (min: number, max: number, dflt: number) =>
  z.number().int().min(min).max(max).default(dflt)

/** YouTube / Vimeo only; anything else is refused, so no arbitrary iframes. */
export const VIDEO_URL_RE =
  /^https:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]{6,20}|youtu\.be\/[\w-]{6,20}|vimeo\.com\/\d{4,12})$/

export const SECTION_SETTINGS = {
  hero: {
    variants: ['centered', 'split', 'image'],
    settings: z
      .object({
        eyebrow: shortText(60),
        headline: z.string().trim().min(1).max(120),
        subheadline: longText(400),
        primaryCta: ctaSchema.nullable().default(null),
        secondaryCta: ctaSchema.nullable().default(null),
        image: imageRefSchema.nullable().default(null),
      })
      .strict(),
  },
  'trust-bar': {
    variants: ['stats', 'logos'],
    settings: z
      .object({
        heading: shortText(),
        stats: z
          .array(z.object({ value: z.string().max(20), label: z.string().max(60) }).strict())
          .max(6)
          .default([]),
        logos: z.array(imageRefSchema).max(8).default([]),
      })
      .strict(),
  },
  'service-grid': {
    variants: ['cards', 'list', 'featured'],
    settings: z
      .object({
        heading: shortText(),
        intro: longText(600),
        serviceIds: ids(24),
        maxItems: count(1, 24, 6),
        showPrices: z.boolean().default(true),
        showDuration: z.boolean().default(true),
      })
      .strict(),
  },
  'provider-bios': {
    variants: ['grid', 'carousel'],
    settings: z
      .object({
        heading: shortText(),
        intro: longText(600),
        providerIds: ids(24),
        maxItems: count(1, 24, 6),
        showBio: z.boolean().default(true),
      })
      .strict(),
  },
  'image-with-text': {
    variants: ['image-left', 'image-right'],
    settings: z
      .object({
        heading: shortText(),
        body: markdownText(4000),
        image: imageRefSchema.nullable().default(null),
        cta: ctaSchema.nullable().default(null),
      })
      .strict(),
  },
  gallery: {
    variants: ['grid', 'strip'],
    settings: z
      .object({ heading: shortText(), images: z.array(imageRefSchema).max(12).default([]) })
      .strict(),
  },
  testimonials: {
    variants: ['cards', 'quote'],
    settings: z
      .object({
        heading: shortText(),
        items: z
          .array(
            z
              .object({
                quote: z.string().trim().min(1).max(500),
                author: z.string().max(80).default(''),
                detail: z.string().max(80).default(''),
              })
              .strict()
          )
          .max(12)
          .default([]),
      })
      .strict(),
  },
  faq: {
    variants: ['accordion', 'two-column'],
    settings: z
      .object({
        heading: shortText(),
        items: z
          .array(
            z
              .object({
                question: z.string().trim().min(1).max(200),
                answer: markdownText(2000),
              })
              .strict()
          )
          .max(30)
          .default([]),
      })
      .strict(),
  },
  pricing: {
    variants: ['packages', 'memberships', 'both'],
    settings: z
      .object({ heading: shortText(), intro: longText(600), maxItems: count(1, 12, 6) })
      .strict(),
  },
  'featured-products': {
    variants: ['grid', 'row'],
    settings: z
      .object({
        heading: shortText(),
        intro: longText(600),
        productIds: ids(24),
        maxItems: count(1, 24, 4),
      })
      .strict(),
  },
  'locations-hours': {
    variants: ['cards', 'split'],
    settings: z
      .object({
        heading: shortText(),
        locationIds: ids(20),
        hours: z
          .array(z.object({ label: z.string().max(40), value: z.string().max(60) }).strict())
          .max(10)
          .default([]),
        showMapLink: z.boolean().default(true),
      })
      .strict(),
  },
  'contact-form': {
    variants: ['simple', 'split'],
    settings: z
      .object({
        heading: shortText(),
        intro: longText(600),
        submitLabel: z.string().max(40).default('Send message'),
        successMessage: z.string().max(300).default('Thanks — we will be in touch shortly.'),
        askPhone: z.boolean().default(true),
        consentText: longText(400),
      })
      .strict(),
  },
  'booking-cta': {
    variants: ['banner', 'split'],
    settings: z
      .object({
        heading: z.string().trim().min(1).max(120),
        text: longText(400),
        cta: ctaSchema.nullable().default(null),
        image: imageRefSchema.nullable().default(null),
      })
      .strict(),
  },
  video: {
    variants: ['contained', 'wide'],
    settings: z
      .object({
        heading: shortText(),
        url: externalHref.refine((u) => VIDEO_URL_RE.test(u), 'Use a YouTube or Vimeo link'),
        caption: shortText(200),
      })
      .strict(),
  },
  'rich-text': {
    variants: ['left', 'center'],
    settings: z.object({ heading: shortText(), body: markdownText(10000) }).strict(),
  },
  steps: {
    variants: ['numbered', 'cards'],
    settings: z
      .object({
        heading: shortText(),
        items: z
          .array(
            z.object({ title: z.string().trim().min(1).max(80), text: longText(300) }).strict()
          )
          .max(6)
          .default([]),
      })
      .strict(),
  },
  spacer: {
    variants: ['small', 'medium', 'large'],
    settings: z.object({ divider: z.boolean().default(false) }).strict(),
  },
} as const

export type SectionType = keyof typeof SECTION_SETTINGS
export const SECTION_TYPES = Object.keys(SECTION_SETTINGS) as SectionType[]

export const SECTION_ID_RE = /^s_[a-z0-9]{4,24}$/
export const MAX_SECTIONS_PER_PAGE = 40

export interface Section {
  id: string
  type: SectionType
  variant: string
  hidden: boolean
  settings: Record<string, unknown>
}

const sectionEnvelope = z
  .object({
    id: z.string().regex(SECTION_ID_RE, 'Invalid section id'),
    type: z.string(),
    variant: z.string().optional(),
    hidden: z.boolean().default(false),
    settings: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export class SectionValidationError extends Error {
  statusCode = 422
  code = 'site_invalid_section'
}

/** Validates one section strictly; throws SectionValidationError with a readable path. */
export function parseSection(raw: unknown, index = 0): Section {
  const env = sectionEnvelope.safeParse(raw)
  if (!env.success) {
    throw new SectionValidationError(`Section ${index + 1}: ${env.error.issues[0]?.message}`)
  }
  const def = SECTION_SETTINGS[env.data.type as SectionType]
  if (!def)
    throw new SectionValidationError(`Section ${index + 1}: unknown type "${env.data.type}"`)
  const variants = def.variants as readonly string[]
  const variant = env.data.variant ?? variants[0]!
  if (!variants.includes(variant)) {
    throw new SectionValidationError(
      `Section ${index + 1} (${env.data.type}): unknown variant "${variant}"`
    )
  }
  const settings = def.settings.safeParse(env.data.settings)
  if (!settings.success) {
    const issue = settings.error.issues[0]
    const where = issue?.path.length ? ` ${issue.path.join('.')}` : ''
    throw new SectionValidationError(
      `Section ${index + 1} (${env.data.type})${where}: ${issue?.message}`
    )
  }
  return {
    id: env.data.id,
    type: env.data.type as SectionType,
    variant,
    hidden: env.data.hidden,
    settings: settings.data as Record<string, unknown>,
  }
}

/** Validates a whole page body: at most 40 sections, unique ids. */
export function parseSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) throw new SectionValidationError('sections must be an array')
  if (raw.length > MAX_SECTIONS_PER_PAGE) {
    throw new SectionValidationError(`A page can have at most ${MAX_SECTIONS_PER_PAGE} sections`)
  }
  const out = raw.map((s, i) => parseSection(s, i))
  const seen = new Set<string>()
  for (const s of out) {
    if (seen.has(s.id)) throw new SectionValidationError(`Duplicate section id "${s.id}"`)
    seen.add(s.id)
  }
  return out
}

export function newSectionId(): string {
  return `s_${crypto.randomBytes(5).toString('hex')}`
}
