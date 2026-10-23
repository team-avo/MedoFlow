/**
 * Site-wide settings the builder edits (Site.settingsDraftJson) and the
 * public site renders (Site.settingsPublishedJson): theme tokens, header and
 * footer menus, announcement bar, social links, SEO defaults and brand
 * images.
 */
import { z } from 'zod'
import { ctaSchema, externalHref, hexColor, imageRefSchema, siteLinkSchema } from './primitives'

/** Curated heading/body font pairs (frontend/lib/site/theme.ts loads them). */
export const FONT_PAIRS = ['modern', 'friendly', 'editorial', 'classic', 'bold', 'organic'] as const
export type FontPair = (typeof FONT_PAIRS)[number]

export const themeSchema = z
  .object({
    colors: z
      .object({
        primary: hexColor,
        secondary: hexColor,
        accent: hexColor,
        background: hexColor,
        surface: hexColor,
        text: hexColor,
        muted: hexColor,
      })
      .strict(),
    fontPair: z.enum(FONT_PAIRS),
    radius: z.enum(['none', 'sm', 'md', 'lg', 'xl']),
    buttonStyle: z.enum(['solid', 'outline', 'pill']),
    density: z.enum(['compact', 'comfortable', 'spacious']),
  })
  .strict()
export type SiteTheme = z.infer<typeof themeSchema>

const navItemSchema = z
  .object({ label: z.string().trim().min(1).max(40), link: siteLinkSchema })
  .strict()

export const siteSettingsSchema = z
  .object({
    theme: themeSchema,
    brand: z
      .object({
        displayName: z.string().max(80).default(''),
        logo: imageRefSchema.nullable().default(null),
        favicon: imageRefSchema.nullable().default(null),
      })
      .strict(),
    header: z
      .object({
        variant: z.enum(['classic', 'centered', 'minimal']),
        links: z.array(navItemSchema).max(8).default([]),
        cta: ctaSchema.nullable().default(null),
        sticky: z.boolean().default(true),
      })
      .strict(),
    footer: z
      .object({
        variant: z.enum(['columns', 'simple']),
        columns: z
          .array(
            z
              .object({
                title: z.string().max(40),
                links: z.array(navItemSchema).max(8).default([]),
              })
              .strict()
          )
          .max(4)
          .default([]),
        text: z.string().max(500).default(''),
      })
      .strict(),
    announcement: z
      .object({
        enabled: z.boolean().default(false),
        text: z.string().max(160).default(''),
        link: siteLinkSchema.nullable().default(null),
      })
      .strict(),
    social: z
      .object({
        facebook: externalHref.optional(),
        instagram: externalHref.optional(),
        x: externalHref.optional(),
        linkedin: externalHref.optional(),
        youtube: externalHref.optional(),
        tiktok: externalHref.optional(),
      })
      .strict()
      .default({}),
    seo: z
      .object({
        titleSuffix: z.string().max(80).default(''),
        description: z.string().max(300).default(''),
        ogImage: imageRefSchema.nullable().default(null),
      })
      .strict(),
  })
  .strict()
export type SiteSettings = z.infer<typeof siteSettingsSchema>

export const DEFAULT_THEME: SiteTheme = {
  colors: {
    primary: '#0d9488',
    secondary: '#0f766e',
    accent: '#f59e0b',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    muted: '#475569',
  },
  fontPair: 'modern',
  radius: 'md',
  buttonStyle: 'solid',
  density: 'comfortable',
}

/** Settings for a site no one has customised yet (brand colour carried over). */
export function defaultSiteSettings(primary?: string | null): SiteSettings {
  const color = primary && /^#[0-9a-fA-F]{6}$/.test(primary) ? primary.toLowerCase() : null
  return {
    theme: color
      ? { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: color, secondary: color } }
      : DEFAULT_THEME,
    brand: { displayName: '', logo: null, favicon: null },
    header: {
      variant: 'classic',
      links: [
        { label: 'Services', link: { kind: 'route', route: 'services' } },
        { label: 'Our team', link: { kind: 'route', route: 'team' } },
        { label: 'Contact', link: { kind: 'route', route: 'contact' } },
      ],
      cta: { label: 'Book now', link: { kind: 'booking' } },
      sticky: true,
    },
    footer: { variant: 'simple', columns: [], text: '' },
    announcement: { enabled: false, text: '', link: null },
    social: {},
    seo: { titleSuffix: '', description: '', ogImage: null },
  }
}

export class SettingsValidationError extends Error {
  statusCode = 422
  code = 'site_invalid_settings'
}

export function parseSiteSettings(raw: unknown): SiteSettings {
  const r = siteSettingsSchema.safeParse(raw)
  if (!r.success) {
    const issue = r.error.issues[0]
    throw new SettingsValidationError(
      `Site settings${issue?.path.length ? ` ${issue.path.join('.')}` : ''}: ${issue?.message}`
    )
  }
  return r.data
}

/** Reads stored settings leniently: anything invalid falls back to defaults. */
export function readSiteSettings(raw: unknown, primary?: string | null): SiteSettings {
  const r = siteSettingsSchema.safeParse(raw)
  if (r.success) return r.data
  const base = defaultSiteSettings(primary)
  if (raw && typeof raw === 'object') {
    // Keep whatever top-level parts are still valid.
    const parts = raw as Record<string, unknown>
    const merged = { ...base } as Record<string, unknown>
    for (const key of Object.keys(base) as (keyof SiteSettings)[]) {
      const candidate = { ...base, [key]: parts[key] }
      if (parts[key] !== undefined && siteSettingsSchema.safeParse(candidate).success) {
        merged[key] = parts[key]
      }
    }
    return siteSettingsSchema.parse(merged)
  }
  return base
}
