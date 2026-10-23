/**
 * Gallery previews (B8.3): a template rendered with sample data through the
 * same payload shape as a live site, so the gallery shows exactly what a
 * clinic will get. Sample data is obviously synthetic.
 */
import { getTemplate } from '../templates'
import { newSectionId } from '../content/sections'
import { resolveContent, type LinkTargets } from '../content/resolve'
import { pagePath } from './pageService'
import type { RenderPayload, SectionData } from './renderService'

const SAMPLE_DATA: SectionData = {
  services: [
    {
      id: 'svc_sample1',
      slug: 'new-patient-visit',
      name: 'New patient visit',
      durationMinutes: 45,
      price: '120.00',
      discipline: 'General care',
    },
    {
      id: 'svc_sample2',
      slug: 'follow-up',
      name: 'Follow-up consultation',
      durationMinutes: 20,
      price: '65.00',
      discipline: 'General care',
    },
    {
      id: 'svc_sample3',
      slug: 'video-visit',
      name: 'Video visit',
      durationMinutes: 20,
      price: '55.00',
      discipline: 'Telehealth',
    },
    {
      id: 'svc_sample4',
      slug: 'wellness-check',
      name: 'Annual wellness check',
      durationMinutes: 40,
      price: '140.00',
      discipline: 'Prevention',
    },
    {
      id: 'svc_sample5',
      slug: 'treatment-session',
      name: 'Treatment session',
      durationMinutes: 50,
      price: '95.00',
      discipline: 'Therapy',
    },
    {
      id: 'svc_sample6',
      slug: 'nutrition-consult',
      name: 'Nutrition consult',
      durationMinutes: 30,
      price: '80.00',
      discipline: 'Nutrition',
    },
  ],
  providers: [
    {
      id: 'prv_sample1',
      slug: 'dr-alex-rivera',
      name: 'Dr. Alex Rivera',
      bio: 'Sample profile — your clinicians appear here automatically.',
      headshotUrl: null,
      languages: ['English', 'Spanish'],
      disciplines: ['General care'],
      serviceIds: [],
    },
    {
      id: 'prv_sample2',
      slug: 'dr-sam-chen',
      name: 'Dr. Sam Chen',
      bio: 'Sample profile — add bios and headshots in Staff.',
      headshotUrl: null,
      languages: ['English'],
      disciplines: ['Prevention'],
      serviceIds: [],
    },
    {
      id: 'prv_sample3',
      slug: 'jordan-patel',
      name: 'Jordan Patel',
      bio: 'Sample profile.',
      headshotUrl: null,
      languages: ['English'],
      disciplines: ['Therapy'],
      serviceIds: [],
    },
  ],
  products: [
    {
      id: 'prd_sample1',
      slug: 'daily-multivitamin',
      name: 'Daily multivitamin',
      description: 'Sample product.',
      price: '24.00',
      inStock: true,
    },
    {
      id: 'prd_sample2',
      slug: 'magnesium-glycinate',
      name: 'Magnesium glycinate',
      description: 'Sample product.',
      price: '19.00',
      inStock: true,
    },
    {
      id: 'prd_sample3',
      slug: 'recovery-balm',
      name: 'Recovery balm',
      description: 'Sample product.',
      price: '28.00',
      inStock: true,
    },
    {
      id: 'prd_sample4',
      slug: 'vitamin-d3',
      name: 'Vitamin D3',
      description: 'Sample product.',
      price: '15.00',
      inStock: false,
    },
  ],
  packages: [
    {
      id: 'pkg_sample1',
      name: 'Five-visit pack',
      description: 'Sample package.',
      price: '425.00',
      totalSessions: 5,
      expiresInDays: 180,
    },
  ],
  memberships: [
    {
      id: 'mem_sample1',
      name: 'Essentials',
      description: 'Sample membership.',
      monthlyPrice: '49.00',
      serviceDiscountPercent: '10',
      billingPeriod: 'MONTHLY',
    },
    {
      id: 'mem_sample2',
      name: 'Premium',
      description: 'Sample membership.',
      monthlyPrice: '99.00',
      serviceDiscountPercent: '20',
      billingPeriod: 'MONTHLY',
    },
  ],
  locations: [
    {
      id: 'loc_sample1',
      name: 'Main clinic',
      addressLines: ['100 Sample Street', 'Springfield, ST 00000'],
      phone: '555-0100',
      timezone: 'UTC',
      isVirtual: false,
    },
  ],
}

export function templatePreview(key: string, pageSlug = 'home'): RenderPayload | null {
  const t = getTemplate(key)
  if (!t) return null
  const tp = t.pages.find((p) => p.slug === pageSlug) ?? t.pages.find((p) => p.kind === 'HOME')!
  const targets: LinkTargets = {
    pages: new Map(t.pages.map((p) => [`tpl_${p.slug}`, pagePath(p.kind, p.slug)])),
    services: new Map(SAMPLE_DATA.services.map((s) => [s.id, s.slug!])),
    providers: new Map(SAMPLE_DATA.providers.map((p) => [p.id, p.slug!])),
    products: new Map(SAMPLE_DATA.products.map((p) => [p.id, p.slug!])),
    hasStore: true,
  }
  const sections = tp.sections.map((s) => ({
    id: newSectionId(),
    type: s.type,
    variant: s.variant ?? '',
    hidden: false,
    settings: s.settings,
  }))
  return {
    site: {
      clinicId: 'template-preview',
      name: 'Your Clinic',
      slug: null,
      canonicalBase: '',
      settings: resolveContent(t.settings, targets, new Map()),
      showBadge: false,
      legacyLogoUrl: null,
      hasStore: true,
    },
    route: {
      key: tp.kind === 'HOME' ? 'home' : 'page',
      path: pagePath(tp.kind, tp.slug),
      params: {},
    },
    page: {
      id: `template-${t.key}-${tp.slug}`,
      kind: tp.kind,
      title: tp.title,
      seoTitle: tp.seoTitle ?? null,
      seoDescription: tp.seoDescription ?? null,
      noindex: true,
      sections: resolveContent(sections, targets, new Map()),
    },
    entity: null,
    data: SAMPLE_DATA,
    preview: true,
  }
}
