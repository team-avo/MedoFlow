/**
 * Unsent form drafts in this browser (CTO-13): a refresh, or a sign-out on a
 * long form, doesn't lose what was typed. Only for the clinic application
 * (business details, no PHI). Sensitive identifiers are never stored here:
 * callers list them in `omit` (the federal tax ID and DEA number), and the
 * draft is cleared as soon as the form is saved.
 *
 * Storage can be unavailable (private mode, blocked site data): every access
 * is wrapped, and the form simply works without a draft.
 */
const PREFIX = 'medoflow:draft:'
/** Drafts older than this are ignored and removed. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export const draftKey = (form: string, userId: string | null | undefined) =>
  userId ? `${PREFIX}${form}:${userId}` : null

export function saveDraft<T extends Record<string, unknown>>(
  key: string | null,
  value: T,
  omit: readonly string[] = []
): void {
  if (!key) return
  const copy: Record<string, unknown> = { ...value }
  for (const k of omit) delete copy[k]
  try {
    window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), value: copy }))
  } catch {
    // storage unavailable: no draft, nothing else changes
  }
}

export function loadDraft<T>(key: string | null, now: number = Date.now()): Partial<T> | null {
  if (!key) return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: number; value?: Partial<T> }
    if (!parsed?.value || typeof parsed.at !== 'number' || now - parsed.at > MAX_AGE_MS) {
      window.localStorage.removeItem(key)
      return null
    }
    return parsed.value
  } catch {
    return null
  }
}

export function clearDraft(key: string | null): void {
  if (!key) return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // nothing to clear
  }
}

/** Never written to a draft: they are encrypted at rest on the server. */
export const PRACTICE_DRAFT_OMIT = ['federalTaxId', 'deaNumber', 'removeDea'] as const
