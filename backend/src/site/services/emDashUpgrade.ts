/**
 * CTO-11: remove em dashes from copy clinics already have on their website
 * (templates installed before the sweep carried them into the database).
 *
 * Rules, applied to every string anywhere in a JSON value:
 *   - a dash that opens the text ("\u2014 Sarah M.")                 -> dropped
 *   - " \u2014 " (spaced) and the HTML entities (mdash, #8212) between words -> ", "
 *   - any other \u2014 (e.g. "9\u20145")                              -> "-"
 *
 * Pure and idempotent: a second pass finds nothing to change. Keys are left
 * alone; only string values change.
 */

const ENTITY = /&(?:mdash|#8212|#x2014);/gi
const SPACED = /\s*\u2014\s+|\s+\u2014\s*/g
const LEADING = /^\s*\u2014\s*/
const BARE = /\u2014/g

/** One string without em dashes. */
export function removeEmDashes(text: string): string {
  return text
    .replace(ENTITY, '\u2014')
    .replace(LEADING, '')
    .replace(SPACED, ', ')
    .replace(BARE, '-')
}

/** Every string in `value` rewritten, plus how many strings changed. */
export function upgradeEmDashes<T>(value: T): { value: T; changed: number } {
  let changed = 0
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const next = removeEmDashes(v)
      if (next !== v) changed += 1
      return next
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    }
    return v
  }
  const next = walk(value) as T
  return { value: next, changed }
}

/** The SitePage columns that hold copy (draft and published). */
export const SITE_PAGE_COPY_FIELDS = [
  'title',
  'sectionsJson',
  'draftSectionsJson',
  'seoTitle',
  'seoDescription',
  'draftTitle',
  'draftSeoTitle',
  'draftSeoDescription',
] as const

/** The Site columns that hold copy (draft and published settings). */
export const SITE_COPY_FIELDS = ['settingsDraftJson', 'settingsPublishedJson'] as const

/**
 * The fields of a row that change, and the total strings changed. Fields that
 * do not change are left out, so an update writes only what it must.
 */
export function upgradeRow<K extends string>(
  row: Partial<Record<K, unknown>>,
  fields: readonly K[]
): { data: Partial<Record<K, unknown>>; changed: number } {
  const data: Partial<Record<K, unknown>> = {}
  let changed = 0
  for (const field of fields) {
    const current = row[field]
    if (current === null || current === undefined) continue
    const result = upgradeEmDashes(current)
    if (result.changed > 0) {
      data[field] = result.value
      changed += result.changed
    }
  }
  return { data, changed }
}
