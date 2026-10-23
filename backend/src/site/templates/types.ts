import type { SectionType } from '../content/sections'
import type { SiteSettings } from '../content/settings'

/** A section as written in a template (ids are assigned on install). */
export interface TemplateSection {
  type: SectionType
  variant?: string
  settings: Record<string, unknown>
}

/**
 * The Prisma `SitePageKind` enum, as a plain union. Templates are also loaded
 * by the frontend e2e mock (frontend/e2e/siteMock.ts), where no Prisma client
 * is generated, so this file must not import `@prisma/client`. siteService.ts
 * fails to compile if the two ever differ.
 */
export type TemplatePageKind = 'HOME' | 'STANDARD' | 'SERVICES' | 'TEAM' | 'CONTACT' | 'LEGAL'

export interface TemplatePage {
  kind: TemplatePageKind
  slug: string
  title: string
  seoTitle?: string
  seoDescription?: string
  showInNav: boolean
  sections: TemplateSection[]
}

/**
 * A ready-made website a clinic can install and then customise (B8.3).
 * Links between template pages use `{ kind: 'page', pageId: 'tpl_<slug>' }`;
 * install rewrites them to the real page ids.
 */
export interface SiteTemplate {
  key: string
  name: string
  tagline: string
  description: string
  bestFor: string[]
  previewImage: string
  settings: SiteSettings
  pages: TemplatePage[]
}

export const templatePageRef = (slug: string) => ({ kind: 'page' as const, pageId: `tpl_${slug}` })
