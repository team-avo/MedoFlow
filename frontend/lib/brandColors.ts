/**
 * Brand colours (CTO-27 / CTO-28), all in the browser: nothing is sent to a
 * third party.
 *
 *  - `extractPalette`: the dominant colours of a logo's pixels, ignoring
 *    transparent, near-white, near-black and grey pixels.
 *  - `proposeBrandColors`: a primary and a secondary from that palette, made
 *    readable (WCAG AA) on white and on the console's dark surface.
 *  - `readableAccent` / `accentOnDark`: a colour adjusted until text on it
 *    passes AA, or until it stands out (3:1) on the dark sidebar. Used by the
 *    console theme so any chosen colour is safe.
 *  - `sanitizeSvg`: strips scripts, event handlers, foreign objects and
 *    javascript: links from an uploaded SVG before it is previewed or saved.
 */
import { contrastRatio } from '@/lib/site/theme'

export const DARK_SURFACE = '#16304f'
export const WHITE = '#ffffff'
const DARK_TEXT = '#0f172a'

export type Rgb = [number, number, number]

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
export const toHex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('')}`
export const fromHex = (hex: string): Rgb => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === rn
      ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
      : max === gn
        ? ((bn - rn) / d + 2) / 6
        : ((rn - gn) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255]
}

/** Moves a colour's lightness by `delta` (−1..1), keeping its hue. */
export function shiftLightness(hex: string, delta: number): string {
  const [h, s, l] = rgbToHsl(fromHex(hex))
  return toHex(hslToRgb([h, s, Math.max(0, Math.min(1, l + delta))]))
}

/**
 * The dominant colours in RGBA pixel data (e.g. a 64×64 canvas of the logo),
 * most common first. Colours are bucketed (4 bits a channel) so near-identical
 * shades count together.
 */
export function extractPalette(pixels: Uint8ClampedArray | number[], max = 5): string[] {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const [r, g, b, a] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, pixels[i + 3]!]
    if (a < 128) continue // transparent
    const [, s, l] = rgbToHsl([r, g, b])
    if (l > 0.93 || l < 0.07 || s < 0.18) continue // white, black, grey
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bucket.count += 1
    bucket.r += r
    bucket.g += g
    bucket.b += b
    buckets.set(key, bucket)
  }
  const sorted = [...buckets.values()].sort((x, y) => y.count - x.count)
  const colours: string[] = []
  for (const b of sorted) {
    const hex = toHex([b.r / b.count, b.g / b.count, b.b / b.count])
    // Skip shades too close to one already chosen.
    if (colours.some((c) => distance(c, hex) < 60)) continue
    colours.push(hex)
    if (colours.length >= max) break
  }
  return colours
}

function distance(a: string, b: string) {
  const [x, y] = [fromHex(a), fromHex(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

/**
 * A colour that text can sit on at WCAG AA (4.5:1): unchanged when white or
 * dark text already passes, otherwise darkened step by step until white does.
 */
export function readableAccent(hex: string): { accent: string; foreground: string } {
  if (contrastRatio(hex, WHITE) >= 4.5) return { accent: hex, foreground: WHITE }
  if (contrastRatio(hex, DARK_TEXT) >= 4.5) return { accent: hex, foreground: DARK_TEXT }
  let c = hex
  for (let i = 0; i < 40 && contrastRatio(c, WHITE) < 4.5; i++) c = shiftLightness(c, -0.025)
  return { accent: c, foreground: WHITE }
}

/** A tint of the colour that stands out (3:1) on the dark console surface. */
export function accentOnDark(hex: string, surface = DARK_SURFACE): string {
  let c = hex
  for (let i = 0; i < 40 && contrastRatio(c, surface) < 3; i++) c = shiftLightness(c, 0.025)
  return c
}

/**
 * Primary and secondary proposals from a logo palette, adjusted for AA. A
 * logo with one colour gets a lighter secondary of it.
 */
export function proposeBrandColors(palette: string[]): {
  primary: string
  secondary: string
  primaryForeground: string
} | null {
  if (palette.length === 0) return null
  const primary = readableAccent(palette[0]!)
  const secondarySource = palette[1] ?? shiftLightness(palette[0]!, 0.15)
  return {
    primary: primary.accent,
    primaryForeground: primary.foreground,
    secondary: readableAccent(secondarySource).accent,
  }
}

/** Removes anything executable from an SVG document. Returns null if it isn't an SVG. */
export function sanitizeSvg(svgText: string): string | null {
  if (typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const root = doc.documentElement
  if (
    !root ||
    root.nodeName.toLowerCase() !== 'svg' ||
    doc.getElementsByTagName('parsererror').length
  )
    return null
  for (const tag of ['script', 'foreignObject', 'iframe', 'embed', 'object']) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) el.remove()
  }
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim().toLowerCase()
      if (name.startsWith('on')) el.removeAttribute(attr.name)
      else if ((name === 'href' || name.endsWith(':href')) && value.startsWith('javascript:'))
        el.removeAttribute(attr.name)
    }
  }
  return new XMLSerializer().serializeToString(doc)
}

/** Reads an image (any data/blob URL) into a small canvas and returns its palette. */
export async function paletteFromImage(src: string, size = 64): Promise<string[]> {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return []
  ctx.drawImage(img, 0, 0, size, size)
  return extractPalette(ctx.getImageData(0, 0, size, size).data)
}
