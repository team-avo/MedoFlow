import { botanica } from './botanica'
import { clarity } from './clarity'
import { heritage } from './heritage'
import { serenity } from './serenity'
import { vitality } from './vitality'
import type { SiteTemplate } from './types'

export type { SiteTemplate, TemplatePage, TemplateSection } from './types'

/** The template gallery, in display order. */
export const SITE_TEMPLATES: readonly SiteTemplate[] = [
  clarity,
  serenity,
  vitality,
  heritage,
  botanica,
]

const BY_KEY = new Map(SITE_TEMPLATES.map((t) => [t.key, t]))

export function getTemplate(key: string): SiteTemplate | undefined {
  return BY_KEY.get(key)
}

/** Gallery card: everything except the page bodies. */
export function templateSummary(t: SiteTemplate) {
  return {
    key: t.key,
    name: t.name,
    tagline: t.tagline,
    description: t.description,
    bestFor: t.bestFor,
    previewImage: t.previewImage,
    theme: t.settings.theme,
    pages: t.pages.map((p) => ({ kind: p.kind, slug: p.slug, title: p.title })),
  }
}
