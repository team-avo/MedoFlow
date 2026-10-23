/**
 * The section library as the builder sees it: each type's label, layout
 * variants, editable fields and defaults. Validation is derived from the
 * same field definitions and matches backend/src/site/content/sections.ts —
 * both run shared/validation-cases/site-sections.json.
 *
 * Adding a section type = one entry here + one in the backend schema + one
 * renderer in components/site/sections (the parity test fails otherwise).
 */
import { z } from 'zod'
import type { Section, SectionType } from './types'
import { isSafeExternalHref } from './links'

/* ── field definitions (drive the editor form AND validation) ─────────── */

export type IdSource = 'services' | 'providers' | 'products' | 'locations'

export type FieldDef =
  | {
      kind: 'text'
      key: string
      label: string
      max: number
      required?: boolean
      default?: string
      placeholder?: string
    }
  | {
      kind: 'textarea'
      key: string
      label: string
      max: number
      required?: boolean
      default?: string
    }
  | { kind: 'markdown'; key: string; label: string; max: number; default?: string }
  | { kind: 'number'; key: string; label: string; min: number; max: number; default: number }
  | { kind: 'boolean'; key: string; label: string; default: boolean }
  | { kind: 'image'; key: string; label: string }
  | { kind: 'images'; key: string; label: string; max: number }
  | { kind: 'cta'; key: string; label: string }
  | { kind: 'video'; key: string; label: string }
  | { kind: 'ids'; key: string; label: string; source: IdSource; max: number; hint?: string }
  | { kind: 'list'; key: string; label: string; max: number; itemLabel: string; fields: FieldDef[] }

export interface SectionDef {
  type: SectionType
  label: string
  description: string
  /** Builder groups for the "Add section" picker. */
  group: 'Intro' | 'Your clinic' | 'Content' | 'Conversion' | 'Layout'
  variants: { value: string; label: string }[]
  fields: FieldDef[]
}

const heading = (label = 'Heading'): FieldDef => ({ kind: 'text', key: 'heading', label, max: 160 })
const intro: FieldDef = { kind: 'textarea', key: 'intro', label: 'Intro', max: 600 }

export const SECTION_DEFS: readonly SectionDef[] = [
  {
    type: 'hero',
    label: 'Hero',
    description: 'Big headline, short intro and your main buttons.',
    group: 'Intro',
    variants: [
      { value: 'centered', label: 'Centered' },
      { value: 'split', label: 'Text + image' },
      { value: 'image', label: 'Full image' },
    ],
    fields: [
      { kind: 'text', key: 'eyebrow', label: 'Eyebrow', max: 60 },
      {
        kind: 'text',
        key: 'headline',
        label: 'Headline',
        max: 120,
        required: true,
        default: 'Care that fits your life',
      },
      { kind: 'textarea', key: 'subheadline', label: 'Subheadline', max: 400 },
      { kind: 'cta', key: 'primaryCta', label: 'Main button' },
      { kind: 'cta', key: 'secondaryCta', label: 'Second button' },
      { kind: 'image', key: 'image', label: 'Image' },
    ],
  },
  {
    type: 'trust-bar',
    label: 'Trust bar',
    description: 'Key numbers or partner / insurer logos.',
    group: 'Intro',
    variants: [
      { value: 'stats', label: 'Numbers' },
      { value: 'logos', label: 'Logos' },
    ],
    fields: [
      heading(),
      {
        kind: 'list',
        key: 'stats',
        label: 'Numbers',
        max: 6,
        itemLabel: 'Number',
        fields: [
          { kind: 'text', key: 'value', label: 'Value', max: 20 },
          { kind: 'text', key: 'label', label: 'Label', max: 60 },
        ],
      },
      { kind: 'images', key: 'logos', label: 'Logos', max: 8 },
    ],
  },
  {
    type: 'service-grid',
    label: 'Services',
    description: 'Your bookable services, straight from your catalogue.',
    group: 'Your clinic',
    variants: [
      { value: 'cards', label: 'Cards' },
      { value: 'list', label: 'List' },
      { value: 'featured', label: 'Featured' },
    ],
    fields: [
      heading(),
      intro,
      {
        kind: 'ids',
        key: 'serviceIds',
        label: 'Show only these services',
        source: 'services',
        max: 24,
        hint: 'Leave empty to show all',
      },
      { kind: 'number', key: 'maxItems', label: 'How many', min: 1, max: 24, default: 6 },
      { kind: 'boolean', key: 'showPrices', label: 'Show prices', default: true },
      { kind: 'boolean', key: 'showDuration', label: 'Show duration', default: true },
    ],
  },
  {
    type: 'provider-bios',
    label: 'Team',
    description: 'Your clinicians with photos and bios.',
    group: 'Your clinic',
    variants: [
      { value: 'grid', label: 'Grid' },
      { value: 'carousel', label: 'Carousel' },
    ],
    fields: [
      heading(),
      intro,
      {
        kind: 'ids',
        key: 'providerIds',
        label: 'Show only these people',
        source: 'providers',
        max: 24,
        hint: 'Leave empty to show everyone',
      },
      { kind: 'number', key: 'maxItems', label: 'How many', min: 1, max: 24, default: 6 },
      { kind: 'boolean', key: 'showBio', label: 'Show bios', default: true },
    ],
  },
  {
    type: 'image-with-text',
    label: 'Image with text',
    description: 'A picture beside a paragraph and a button.',
    group: 'Content',
    variants: [
      { value: 'image-left', label: 'Image left' },
      { value: 'image-right', label: 'Image right' },
    ],
    fields: [
      heading(),
      { kind: 'markdown', key: 'body', label: 'Text', max: 4000 },
      { kind: 'image', key: 'image', label: 'Image' },
      { kind: 'cta', key: 'cta', label: 'Button' },
    ],
  },
  {
    type: 'gallery',
    label: 'Gallery',
    description: 'A grid or strip of photos.',
    group: 'Content',
    variants: [
      { value: 'grid', label: 'Grid' },
      { value: 'strip', label: 'Strip' },
    ],
    fields: [heading(), { kind: 'images', key: 'images', label: 'Photos', max: 12 }],
  },
  {
    type: 'testimonials',
    label: 'Testimonials',
    description: 'Reviews from patients (with their consent).',
    group: 'Content',
    variants: [
      { value: 'cards', label: 'Cards' },
      { value: 'quote', label: 'Single quote' },
    ],
    fields: [
      heading(),
      {
        kind: 'list',
        key: 'items',
        label: 'Reviews',
        max: 12,
        itemLabel: 'Review',
        fields: [
          { kind: 'textarea', key: 'quote', label: 'Quote', max: 500, required: true },
          { kind: 'text', key: 'author', label: 'Name', max: 80 },
          { kind: 'text', key: 'detail', label: 'Detail', max: 80 },
        ],
      },
    ],
  },
  {
    type: 'faq',
    label: 'FAQ',
    description: 'Questions and answers.',
    group: 'Content',
    variants: [
      { value: 'accordion', label: 'Accordion' },
      { value: 'two-column', label: 'Two columns' },
    ],
    fields: [
      heading(),
      {
        kind: 'list',
        key: 'items',
        label: 'Questions',
        max: 30,
        itemLabel: 'Question',
        fields: [
          { kind: 'text', key: 'question', label: 'Question', max: 200, required: true },
          { kind: 'markdown', key: 'answer', label: 'Answer', max: 2000 },
        ],
      },
    ],
  },
  {
    type: 'pricing',
    label: 'Pricing',
    description: 'Your packages and memberships.',
    group: 'Your clinic',
    variants: [
      { value: 'packages', label: 'Packages' },
      { value: 'memberships', label: 'Memberships' },
      { value: 'both', label: 'Both' },
    ],
    fields: [
      heading(),
      intro,
      { kind: 'number', key: 'maxItems', label: 'How many', min: 1, max: 12, default: 6 },
    ],
  },
  {
    type: 'featured-products',
    label: 'Products',
    description: 'Products from your store, with add-to-cart.',
    group: 'Your clinic',
    variants: [
      { value: 'grid', label: 'Grid' },
      { value: 'row', label: 'Row' },
    ],
    fields: [
      heading(),
      intro,
      {
        kind: 'ids',
        key: 'productIds',
        label: 'Show only these products',
        source: 'products',
        max: 24,
        hint: 'Leave empty to show newest',
      },
      { kind: 'number', key: 'maxItems', label: 'How many', min: 1, max: 24, default: 4 },
    ],
  },
  {
    type: 'locations-hours',
    label: 'Locations & hours',
    description: 'Addresses, phone numbers and opening hours.',
    group: 'Your clinic',
    variants: [
      { value: 'cards', label: 'Cards' },
      { value: 'split', label: 'Split' },
    ],
    fields: [
      heading(),
      {
        kind: 'ids',
        key: 'locationIds',
        label: 'Locations',
        source: 'locations',
        max: 20,
        hint: 'Leave empty to show all',
      },
      {
        kind: 'list',
        key: 'hours',
        label: 'Opening hours',
        max: 10,
        itemLabel: 'Row',
        fields: [
          { kind: 'text', key: 'label', label: 'Days', max: 40 },
          { kind: 'text', key: 'value', label: 'Hours', max: 60 },
        ],
      },
      { kind: 'boolean', key: 'showMapLink', label: 'Show map link', default: true },
    ],
  },
  {
    type: 'contact-form',
    label: 'Contact form',
    description: 'Visitors send you a message; it arrives in your Enquiries inbox.',
    group: 'Conversion',
    variants: [
      { value: 'simple', label: 'Simple' },
      { value: 'split', label: 'With details' },
    ],
    fields: [
      heading(),
      intro,
      { kind: 'text', key: 'submitLabel', label: 'Button label', max: 40, default: 'Send message' },
      {
        kind: 'textarea',
        key: 'successMessage',
        label: 'Thank-you message',
        max: 300,
        default: 'Thanks — we will be in touch shortly.',
      },
      { kind: 'boolean', key: 'askPhone', label: 'Ask for a phone number', default: true },
      { kind: 'textarea', key: 'consentText', label: 'Note under the form', max: 400 },
    ],
  },
  {
    type: 'booking-cta',
    label: 'Booking banner',
    description: 'A strong call to book.',
    group: 'Conversion',
    variants: [
      { value: 'banner', label: 'Banner' },
      { value: 'split', label: 'With image' },
    ],
    fields: [
      {
        kind: 'text',
        key: 'heading',
        label: 'Heading',
        max: 120,
        required: true,
        default: 'Ready when you are',
      },
      { kind: 'textarea', key: 'text', label: 'Text', max: 400 },
      { kind: 'cta', key: 'cta', label: 'Button' },
      { kind: 'image', key: 'image', label: 'Image' },
    ],
  },
  {
    type: 'video',
    label: 'Video',
    description: 'A YouTube or Vimeo video.',
    group: 'Content',
    variants: [
      { value: 'contained', label: 'Contained' },
      { value: 'wide', label: 'Wide' },
    ],
    fields: [
      heading(),
      { kind: 'video', key: 'url', label: 'YouTube or Vimeo link' },
      { kind: 'text', key: 'caption', label: 'Caption', max: 200 },
    ],
  },
  {
    type: 'rich-text',
    label: 'Text',
    description: 'Paragraphs, lists and links.',
    group: 'Content',
    variants: [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Centered' },
    ],
    fields: [heading(), { kind: 'markdown', key: 'body', label: 'Text', max: 10000 }],
  },
  {
    type: 'steps',
    label: 'Steps',
    description: '“How it works” in a few steps.',
    group: 'Content',
    variants: [
      { value: 'numbered', label: 'Numbered' },
      { value: 'cards', label: 'Cards' },
    ],
    fields: [
      heading(),
      {
        kind: 'list',
        key: 'items',
        label: 'Steps',
        max: 6,
        itemLabel: 'Step',
        fields: [
          { kind: 'text', key: 'title', label: 'Title', max: 80, required: true },
          { kind: 'textarea', key: 'text', label: 'Text', max: 300 },
        ],
      },
    ],
  },
  {
    type: 'spacer',
    label: 'Spacer',
    description: 'Breathing room, with an optional line.',
    group: 'Layout',
    variants: [
      { value: 'small', label: 'Small' },
      { value: 'medium', label: 'Medium' },
      { value: 'large', label: 'Large' },
    ],
    fields: [{ kind: 'boolean', key: 'divider', label: 'Show a line', default: false }],
  },
]

export const SECTION_BY_TYPE = new Map(SECTION_DEFS.map((d) => [d.type, d]))

/* ── validation derived from the field definitions ───────────────────── */

const entityId = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/)
const ROUTES = ['home', 'services', 'team', 'store', 'book', 'contact'] as const

export const siteLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), pageId: entityId }).strict(),
  z.object({ kind: z.literal('route'), route: z.enum(ROUTES) }).strict(),
  z.object({ kind: z.literal('service'), serviceId: entityId }).strict(),
  z.object({ kind: z.literal('provider'), providerId: entityId }).strict(),
  z.object({ kind: z.literal('product'), productId: entityId }).strict(),
  z.object({ kind: z.literal('booking'), serviceId: entityId.optional() }).strict(),
  z.object({ kind: z.literal('anchor'), sectionId: entityId }).strict(),
  z
    .object({
      kind: z.literal('external'),
      href: z
        .string()
        .max(2000)
        .refine(isSafeExternalHref, 'Links must start with https://, mailto: or tel:'),
    })
    .strict(),
])

export const ctaSchema = z
  .object({ label: z.string().trim().min(1).max(40), link: siteLinkSchema })
  .strict()

export const SAMPLE_IMAGE_RE = /^\/site-samples\/[a-z0-9-]+\.(svg|webp|jpg|png)$/
export const imageRefSchema = z
  .object({
    assetId: entityId.optional(),
    src: z.string().regex(SAMPLE_IMAGE_RE).optional(),
    alt: z.string().max(200).default(''),
  })
  .strict()
  .refine((v) => Boolean(v.assetId) !== Boolean(v.src), 'An image needs an upload or a sample')

export const VIDEO_URL_RE =
  /^https:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]{6,20}|youtu\.be\/[\w-]{6,20}|vimeo\.com\/\d{4,12})$/

function fieldSchema(f: FieldDef): z.ZodTypeAny {
  switch (f.kind) {
    case 'text':
    case 'textarea':
      return f.required
        ? z.string().trim().min(1).max(f.max)
        : z
            .string()
            .max(f.max)
            .default(f.default ?? '')
    case 'markdown':
      return z
        .string()
        .max(f.max)
        .default(f.default ?? '')
    case 'number':
      return z.number().int().min(f.min).max(f.max).default(f.default)
    case 'boolean':
      return z.boolean().default(f.default)
    case 'image':
      return imageRefSchema.nullable().default(null)
    case 'images':
      return z.array(imageRefSchema).max(f.max).default([])
    case 'cta':
      return ctaSchema.nullable().default(null)
    case 'video':
      return z
        .string()
        .max(2000)
        .refine((u) => isSafeExternalHref(u) && VIDEO_URL_RE.test(u), 'Use a YouTube or Vimeo link')
    case 'ids':
      return z.array(entityId).max(f.max).default([])
    case 'list':
      return z
        .array(z.object(Object.fromEntries(f.fields.map((x) => [x.key, fieldSchema(x)]))).strict())
        .max(f.max)
        .default([])
  }
}

const settingsSchemas = new Map(
  SECTION_DEFS.map((d) => [
    d.type,
    z.object(Object.fromEntries(d.fields.map((f) => [f.key, fieldSchema(f)]))).strict(),
  ])
)

export const SECTION_ID_RE = /^s_[a-z0-9]{4,24}$/

export type SectionCheck = { ok: true; section: Section } | { ok: false; error: string }

/** Same accept/reject rules as the backend's parseSection. */
export function validateSection(raw: unknown): SectionCheck {
  const env = z
    .object({
      id: z.string().regex(SECTION_ID_RE),
      type: z.string(),
      variant: z.string().optional(),
      hidden: z.boolean().default(false),
      settings: z.record(z.string(), z.unknown()).default({}),
    })
    .strict()
    .safeParse(raw)
  if (!env.success) return { ok: false, error: env.error.issues[0]?.message ?? 'Invalid section' }
  const def = SECTION_BY_TYPE.get(env.data.type as SectionType)
  if (!def) return { ok: false, error: `Unknown section type "${env.data.type}"` }
  const variant = env.data.variant ?? def.variants[0]!.value
  if (!def.variants.some((v) => v.value === variant))
    return { ok: false, error: `Unknown variant "${variant}"` }
  const settings = settingsSchemas.get(def.type)!.safeParse(env.data.settings)
  if (!settings.success) {
    const issue = settings.error.issues[0]
    return { ok: false, error: `${issue?.path.join('.') || def.label}: ${issue?.message}` }
  }
  return {
    ok: true,
    section: {
      id: env.data.id,
      type: def.type,
      variant,
      hidden: env.data.hidden,
      settings: settings.data,
    },
  }
}

/* ── creating sections in the builder ────────────────────────────────── */

export function newSectionId(): string {
  const bytes = new Uint8Array(5)
  globalThis.crypto.getRandomValues(bytes)
  return `s_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

function defaultFor(f: FieldDef): unknown {
  switch (f.kind) {
    case 'text':
    case 'textarea':
    case 'markdown':
      return f.default ?? ''
    case 'number':
    case 'boolean':
      return f.default
    case 'image':
    case 'cta':
      return null
    case 'video':
      return '' // must be filled in before the page can be saved
    case 'images':
    case 'ids':
    case 'list':
      return []
  }
}

export function defaultSettings(type: SectionType): Record<string, unknown> {
  const def = SECTION_BY_TYPE.get(type)!
  return Object.fromEntries(def.fields.map((f) => [f.key, defaultFor(f)]))
}

export function newSection(type: SectionType): Section {
  const def = SECTION_BY_TYPE.get(type)!
  return {
    id: newSectionId(),
    type,
    variant: def.variants[0]!.value,
    hidden: false,
    settings: defaultSettings(type),
  }
}

export function newListItem(field: Extract<FieldDef, { kind: 'list' }>): Record<string, unknown> {
  return Object.fromEntries(field.fields.map((f) => [f.key, defaultFor(f)]))
}
