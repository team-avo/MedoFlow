/** CTO-27 / CTO-28: colours from a logo, made readable (WCAG AA); SVG sanitising. */
import { describe, expect, it } from 'vitest'
import {
  accentOnDark,
  DARK_SURFACE,
  extractPalette,
  proposeBrandColors,
  readableAccent,
  sanitizeSvg,
} from '@/lib/brandColors'
import { contrastRatio } from '@/lib/site/theme'

/** A synthetic "logo": 60% teal, 30% orange, the rest white and transparent. */
function logoPixels(): number[] {
  const px: number[] = []
  const push = (n: number, rgba: [number, number, number, number]) => {
    for (let i = 0; i < n; i++) px.push(...rgba)
  }
  push(600, [13, 148, 136, 255]) // teal
  push(300, [249, 115, 22, 255]) // orange
  push(80, [255, 255, 255, 255]) // white background
  push(20, [0, 0, 0, 0]) // transparent
  return px
}

describe('extractPalette', () => {
  it('a known logo gives its known colours, most common first, ignoring white and transparent', () => {
    expect(extractPalette(logoPixels())).toEqual(['#0d9488', '#f97316'])
  })
  it('a grey-only logo has no brand colour', () => {
    expect(extractPalette([128, 128, 128, 255, 40, 40, 40, 255])).toEqual([])
  })
})

describe('readable colours', () => {
  it('text on the accent passes AA; a colour that fails is darkened, not rejected', () => {
    const ok = readableAccent('#1e3a5f')
    expect(ok).toEqual({ accent: '#1e3a5f', foreground: '#ffffff' })
    const pale = readableAccent('#fde047') // yellow: dark text works
    expect(contrastRatio(pale.accent, pale.foreground)).toBeGreaterThanOrEqual(4.5)
    const mid = readableAccent('#14b8a6') // teal 500: neither passes at 4.5 with white
    expect(contrastRatio(mid.accent, mid.foreground)).toBeGreaterThanOrEqual(4.5)
  })
  it('a dark brand colour gets a lighter tint that stands out on the dark sidebar', () => {
    const tint = accentOnDark('#1e3a5f')
    expect(contrastRatio(tint, DARK_SURFACE)).toBeGreaterThanOrEqual(3)
  })
  it('proposals from a palette are readable', () => {
    const p = proposeBrandColors(['#14b8a6', '#f97316'])!
    expect(contrastRatio(p.primary, p.primaryForeground)).toBeGreaterThanOrEqual(4.5)
    expect(p.secondary).toMatch(/^#[0-9a-f]{6}$/)
    expect(proposeBrandColors([])).toBeNull()
  })
})

describe('sanitizeSvg', () => {
  it('removes scripts, event handlers, foreign objects and javascript: links', () => {
    const clean = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><foreignObject/><a href="javascript:alert(3)"><circle r="4"/></a></svg>'
    )!
    expect(clean).not.toMatch(/script|onload|foreignObject|javascript:/i)
    expect(clean).toContain('<circle')
  })
  it('refuses anything that is not an SVG', () => {
    expect(sanitizeSvg('<html><body/></html>')).toBeNull()
  })
})
