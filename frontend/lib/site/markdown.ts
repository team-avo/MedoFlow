/**
 * The small, safe markdown subset clinic copy may use: paragraphs, "- "
 * lists, **bold**, *italic* and [links](…). Parsed to a tree and rendered as
 * React elements — never as HTML — so stored copy can't inject markup.
 * Links may be https / mailto / tel, or a site path ("/contact").
 */
import { isSafeExternalHref } from './links'

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; internal: boolean; c: Inline[] }

export type Block = { t: 'p'; c: Inline[] } | { t: 'ul'; items: Inline[][] }

const INLINE_RE = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/

export function parseInline(src: string, depth = 0): Inline[] {
  if (depth > 4) return [{ t: 'text', v: src }]
  const out: Inline[] = []
  let rest = src
  while (rest) {
    const m = INLINE_RE.exec(rest)
    if (!m) {
      out.push({ t: 'text', v: rest })
      break
    }
    if (m.index > 0) out.push({ t: 'text', v: rest.slice(0, m.index) })
    if (m[1] !== undefined) out.push({ t: 'strong', c: parseInline(m[1], depth + 1) })
    else if (m[2] !== undefined) out.push({ t: 'em', c: parseInline(m[2], depth + 1) })
    else {
      const href = m[4]!
      const internal = /^\/[a-z0-9/._-]*$/i.test(href) && !href.startsWith('//')
      if (internal || isSafeExternalHref(href)) {
        out.push({ t: 'link', href, internal, c: parseInline(m[3]!, depth + 1) })
      } else {
        out.push({ t: 'text', v: m[3]! }) // unsafe link: keep the words, drop the URL
      }
    }
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = []
  for (const chunk of src.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter((l) => l.trim())
    if (!lines.length) continue
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      blocks.push({ t: 'ul', items: lines.map((l) => parseInline(l.replace(/^\s*[-*]\s+/, ''))) })
    } else {
      blocks.push({ t: 'p', c: parseInline(lines.join(' ')) })
    }
  }
  return blocks
}

/** Plain text (for meta descriptions and previews). */
export function markdownToText(src: string): string {
  const flat = (xs: Inline[]): string => xs.map((x) => (x.t === 'text' ? x.v : flat(x.c))).join('')
  return parseMarkdown(src)
    .map((b) => (b.t === 'p' ? flat(b.c) : b.items.map(flat).join(' · ')))
    .join(' ')
    .trim()
}
