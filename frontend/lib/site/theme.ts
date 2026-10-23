/**
 * Theme tokens → CSS custom properties for a clinic site. Every section is
 * styled through these variables (components/site/site.css), so changing a
 * theme repaints the whole site without touching section code.
 */
import type { CSSProperties } from 'react'
import type { FontPair, SiteTheme } from './types'

export interface FontPairDef {
  key: FontPair
  label: string
  description: string
  /** CSS variables set by lib/site/fonts.ts (next/font). */
  headingVar: string
  bodyVar: string
}

export const FONT_PAIRS: readonly FontPairDef[] = [
  {
    key: 'modern',
    label: 'Modern',
    description: 'Inter — clean and neutral',
    headingVar: '--font-inter',
    bodyVar: '--font-inter',
  },
  {
    key: 'friendly',
    label: 'Friendly',
    description: 'Nunito — rounded and warm',
    headingVar: '--font-site-nunito',
    bodyVar: '--font-site-nunito-sans',
  },
  {
    key: 'editorial',
    label: 'Editorial',
    description: 'Playfair Display + Source Sans',
    headingVar: '--font-site-playfair',
    bodyVar: '--font-site-source-sans',
  },
  {
    key: 'classic',
    label: 'Classic',
    description: 'Lora + Inter',
    headingVar: '--font-site-lora',
    bodyVar: '--font-inter',
  },
  {
    key: 'bold',
    label: 'Bold',
    description: 'Poppins + Inter',
    headingVar: '--font-site-poppins',
    bodyVar: '--font-inter',
  },
  {
    key: 'organic',
    label: 'Organic',
    description: 'Fraunces + Work Sans',
    headingVar: '--font-site-fraunces',
    bodyVar: '--font-site-work-sans',
  },
]

const RADIUS: Record<SiteTheme['radius'], string> = {
  none: '0px',
  sm: '4px',
  md: '10px',
  lg: '16px',
  xl: '24px',
}

const DENSITY: Record<SiteTheme['density'], string> = {
  compact: '3.5rem',
  comfortable: '5rem',
  spacious: '7rem',
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of #rrggbb. */
export function luminance(hex: string): number {
  if (!HEX_RE.test(hex)) return 0
  const n = parseInt(hex.slice(1), 16)
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  )
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** White or near-black, whichever reads better on `bg`. */
export function readableOn(bg: string): string {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#0f172a') ? '#ffffff' : '#0f172a'
}

export interface ContrastIssue {
  pair: string
  ratio: number
}

/** Pairs below WCAG AA (4.5:1 for body text, 3:1 for large text / buttons). */
export function contrastIssues(theme: SiteTheme): ContrastIssue[] {
  const c = theme.colors
  const checks: [string, string, string, number][] = [
    ['Text on background', c.text, c.background, 4.5],
    ['Muted text on background', c.muted, c.background, 4.5],
    ['Text on surface', c.text, c.surface, 4.5],
    ['Button text on primary', readableOn(c.primary), c.primary, 3],
  ]
  return checks
    .map(([pair, fg, bg, min]) => ({ pair, ratio: contrastRatio(fg, bg), min }))
    .filter((x) => x.ratio < x.min)
    .map(({ pair, ratio }) => ({ pair, ratio: Math.round(ratio * 100) / 100 }))
}

export function fontPair(key: FontPair): FontPairDef {
  return FONT_PAIRS.find((f) => f.key === key) ?? FONT_PAIRS[0]!
}

/** Inline style for the site root: every theme token as a CSS variable. */
export function themeStyle(theme: SiteTheme): CSSProperties {
  const c = theme.colors
  const f = fontPair(theme.fontPair)
  const vars: Record<string, string> = {
    '--site-primary': c.primary,
    '--site-on-primary': readableOn(c.primary),
    '--site-secondary': c.secondary,
    '--site-on-secondary': readableOn(c.secondary),
    '--site-accent': c.accent,
    '--site-bg': c.background,
    '--site-surface': c.surface,
    '--site-text': c.text,
    '--site-muted': c.muted,
    '--site-radius': RADIUS[theme.radius],
    '--site-btn-radius': theme.buttonStyle === 'pill' ? '999px' : RADIUS[theme.radius],
    '--site-section-y': DENSITY[theme.density],
    '--site-font-heading': `var(${f.headingVar}), ui-sans-serif, system-ui, sans-serif`,
    '--site-font-body': `var(${f.bodyVar}), ui-sans-serif, system-ui, sans-serif`,
  }
  return vars as CSSProperties
}

export const buttonClass = (theme: SiteTheme, kind: 'primary' | 'secondary' = 'primary') =>
  kind === 'secondary' || theme.buttonStyle === 'outline'
    ? 'mf-btn mf-btn-outline'
    : 'mf-btn mf-btn-solid'
