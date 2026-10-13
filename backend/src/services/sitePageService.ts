import prisma from '../config/prisma'
import { ApiError } from '../types/errors'
import type { SitePageStatus } from '@prisma/client'
import { chatCompletion } from './aiProviderService'

// ---------------------------------------------------------------------------
// AI Bootstrap — section content defaults & generation
// ---------------------------------------------------------------------------

const SECTION_DEFAULTS: Record<string, Record<string, unknown>> = {
  hero: {
    eyebrow: 'Welcome',
    headline: 'Care that fits your life.',
    subheadline: 'Book a visit, message your provider, manage your care — all from one place.',
    ctaLabel: 'Book a visit',
    ctaHref: '#services',
    backgroundImage: '',
  },
  'service-grid': {
    title: 'What we offer',
    intro: 'Browse our services and book the one that fits your needs.',
    maxItems: 6,
  },
  'provider-bios': {
    title: 'Meet the team',
    intro: 'Our clinicians are here to help you get the care you need.',
    maxItems: 6,
  },
  testimonials: {
    title: 'What patients say',
    quotes: [
      '"Saved me hours of paperwork." — Sarah M.',
      '"My provider actually listens." — James K.',
      '"Best clinic experience I\'ve had in years." — Priya T.',
    ],
  },
  faq: {
    title: 'Frequently asked',
    items: [
      "Do you accept insurance?|We work with most major insurers. Bring your card to your first visit and we'll verify coverage.",
      'How do I cancel or reschedule?|Log in to your patient portal and go to Appointments. You can cancel or reschedule up to 24 hours before your visit.',
      'Is telehealth available?|Yes — we offer video consultations for follow-ups and many routine visits.',
    ],
  },
  'booking-cta': {
    headline: 'Ready when you are.',
    subheadline: 'Same-day visits available most weekdays. No long waits.',
    ctaLabel: 'Find an appointment',
    ctaHref: '#services',
  },
  'rich-text': {
    title: '',
    body: 'Add any additional information you would like patients to know here.',
  },
}

async function generateAISectionContent(
  name: string,
  sectionTypes: string[]
): Promise<Record<string, Record<string, unknown>>> {
  const validTypes = sectionTypes.filter((t) => SECTION_DEFAULTS[t])

  // Build a concise JSON schema hint for the prompt
  const schemaHints = validTypes
    .map((type) => {
      const defaults = SECTION_DEFAULTS[type]!
      const keysStr = Object.entries(defaults)
        .filter(([k]) => !['maxItems', 'ctaHref', 'backgroundImage'].includes(k))
        .map(([k, v]) => `"${k}": ${Array.isArray(v) ? 'string[]' : '"string"'}`)
        .join(', ')
      return `"${type}": { ${keysStr} }`
    })
    .join(',\n  ')

  const userMessage = `Generate professional website copy for a healthcare clinic named "${name}".

Return ONLY valid JSON with this exact structure (no markdown fences, no extra keys):
{
  ${schemaHints}
}

Rules:
- Headlines: 5–9 words, benefit-focused
- Subheadlines: 1–2 sentences, warm and patient-centred
- FAQ "items" must use "Question?|Answer." format (pipe separator, no extra quotes around it)
- Testimonial "quotes" must use "\\"Quote text.\\" — FirstName L." format
- Do NOT use lorem ipsum or generic filler
- Write as if you know this specific clinic by name`

  try {
    const raw = await chatCompletion({
      systemPrompt:
        'You are an expert healthcare website copywriter. Output ONLY valid JSON — no markdown, no prose.',
      userMessage,
      jsonMode: true,
      temperature: 0.7,
    })

    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>
    const result: Record<string, Record<string, unknown>> = {}

    for (const type of validTypes) {
      const generated = parsed[type]
      const defaults = SECTION_DEFAULTS[type]!
      result[type] =
        generated && typeof generated === 'object' ? { ...defaults, ...generated } : { ...defaults }
    }
    return result
  } catch (e) {
    console.warn('[aiBootstrap] Ollama generation failed — using defaults:', (e as Error).message)
    const result: Record<string, Record<string, unknown>> = {}
    for (const type of validTypes) {
      result[type] = { ...SECTION_DEFAULTS[type]! }
    }
    return result
  }
}

export async function aiBootstrapPage(
  clinicId: string,
  input: {
    name: string
    logoUrl?: string | null
    themeColor?: string | null
    sectionTypes: string[]
  }
) {
  const aiContent = await generateAISectionContent(input.name, input.sectionTypes)

  const sections = input.sectionTypes
    .filter((t) => SECTION_DEFAULTS[t])
    .map((type) => ({
      id: `s_${Math.random().toString(36).slice(2, 10)}`,
      type,
      settings: aiContent[type] ?? SECTION_DEFAULTS[type] ?? {},
      blocks: [],
    }))

  const existing = await prisma.sitePage.findUnique({
    where: { clinicId_slug: { clinicId, slug: 'home' } },
    select: { id: true },
  })

  let page
  if (existing) {
    page = await prisma.sitePage.update({
      where: { id: existing.id, clinicId },
      data: { draftSectionsJson: sections as unknown as object },
    })
  } else {
    page = await prisma.sitePage.create({
      data: {
        clinicId,
        slug: 'home',
        title: `${input.name.trim()} — Home`,
        status: 'DRAFT' as SitePageStatus,
        draftSectionsJson: sections as unknown as object,
        sectionsJson: [] as unknown as object,
        seoTitle: null,
        seoDescription: null,
      },
    })
  }

  return { pageId: page.id, sections }
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/

function validateSlug(slug: string): string {
  const cleaned = slug.trim().toLowerCase()
  if (!SLUG_RE.test(cleaned)) {
    const err = new Error(
      'Slug must be 1-62 chars: lowercase letters, numbers, hyphens (no leading/trailing hyphen).'
    ) as ApiError
    err.statusCode = 400
    throw err
  }
  return cleaned
}

export interface SectionInput {
  type: string
  settings?: Record<string, unknown>
  blocks?: Array<{ type: string; settings?: Record<string, unknown> }>
}

function validateSections(sections: unknown): SectionInput[] {
  if (!Array.isArray(sections)) {
    const err = new Error('sections must be an array') as ApiError
    err.statusCode = 400
    throw err
  }
  if (sections.length > 50) {
    const err = new Error('A page can have at most 50 sections') as ApiError
    err.statusCode = 400
    throw err
  }
  return sections.map((s, idx) => {
    if (!s || typeof s !== 'object') {
      const err = new Error(`Section ${idx} must be an object`) as ApiError
      err.statusCode = 400
      throw err
    }
    const sec = s as Record<string, unknown>
    if (typeof sec['type'] !== 'string' || !sec['type']) {
      const err = new Error(`Section ${idx} is missing a type`) as ApiError
      err.statusCode = 400
      throw err
    }
    return {
      type: sec['type'] as string,
      settings: (sec['settings'] as Record<string, unknown>) ?? {},
      blocks: Array.isArray(sec['blocks'])
        ? (sec['blocks'] as Array<{ type: string; settings?: Record<string, unknown> }>)
        : [],
    }
  })
}

export async function listPages(clinicId: string) {
  return prisma.sitePage.findMany({
    where: { clinicId },
    orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      seoTitle: true,
      seoDescription: true,
      publishedAt: true,
      updatedAt: true,
      createdAt: true,
    },
  })
}

export async function getPage(clinicId: string, pageId: string) {
  const page = await prisma.sitePage.findFirst({
    where: { id: pageId, clinicId },
  })
  if (!page) {
    const err = new Error('Page not found') as ApiError
    err.statusCode = 404
    throw err
  }
  return page
}

export async function getPublishedBySlug(clinicId: string, slug: string) {
  const page = await prisma.sitePage.findFirst({
    where: { clinicId, slug, status: 'PUBLISHED' },
    select: {
      id: true,
      title: true,
      slug: true,
      sectionsJson: true,
      seoTitle: true,
      seoDescription: true,
      publishedAt: true,
    },
  })
  return page
}

export async function createPage(
  clinicId: string,
  input: {
    slug: string
    title: string
    sections?: SectionInput[]
    seoTitle?: string | null
    seoDescription?: string | null
  }
) {
  const slug = validateSlug(input.slug)
  const sections = validateSections(input.sections ?? [])

  const existing = await prisma.sitePage.findUnique({
    where: { clinicId_slug: { clinicId, slug } },
  })
  if (existing) {
    const err = new Error('A page with that slug already exists') as ApiError
    err.statusCode = 409
    throw err
  }

  return prisma.sitePage.create({
    data: {
      clinicId,
      slug,
      title: input.title.trim(),
      status: 'DRAFT',
      draftSectionsJson: sections as unknown as object,
      sectionsJson: [] as unknown as object,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
    },
  })
}

export async function updateDraft(
  clinicId: string,
  pageId: string,
  input: {
    title?: string
    sections?: SectionInput[]
    seoTitle?: string | null
    seoDescription?: string | null
  }
) {
  const page = await prisma.sitePage.findFirst({
    where: { id: pageId, clinicId },
    select: { id: true },
  })
  if (!page) {
    const err = new Error('Page not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const data: Record<string, unknown> = {}
  if (input.title !== undefined) data['title'] = input.title.trim()
  if (input.sections !== undefined) {
    data['draftSectionsJson'] = validateSections(input.sections) as unknown as object
  }
  if (input.seoTitle !== undefined) data['seoTitle'] = input.seoTitle
  if (input.seoDescription !== undefined) data['seoDescription'] = input.seoDescription

  return prisma.sitePage.update({
    where: { id: page.id, clinicId },
    data,
  })
}

export async function publish(clinicId: string, pageId: string) {
  const page = await prisma.sitePage.findFirst({
    where: { id: pageId, clinicId },
  })
  if (!page) {
    const err = new Error('Page not found') as ApiError
    err.statusCode = 404
    throw err
  }
  return prisma.sitePage.update({
    where: { id: page.id, clinicId },
    data: {
      sectionsJson: page.draftSectionsJson as unknown as object,
      status: 'PUBLISHED' as SitePageStatus,
      publishedAt: new Date(),
    },
  })
}

export async function unpublish(clinicId: string, pageId: string) {
  const page = await prisma.sitePage.findFirst({
    where: { id: pageId, clinicId },
    select: { id: true },
  })
  if (!page) {
    const err = new Error('Page not found') as ApiError
    err.statusCode = 404
    throw err
  }
  return prisma.sitePage.update({
    where: { id: page.id, clinicId },
    data: { status: 'DRAFT' as SitePageStatus, publishedAt: null },
  })
}

export async function deletePage(clinicId: string, pageId: string) {
  const page = await prisma.sitePage.findFirst({
    where: { id: pageId, clinicId },
    select: { id: true },
  })
  if (!page) {
    const err = new Error('Page not found') as ApiError
    err.statusCode = 404
    throw err
  }
  await prisma.sitePage.delete({ where: { id: page.id, clinicId } })
}
