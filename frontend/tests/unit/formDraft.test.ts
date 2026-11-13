/** CTO-13: unsent application drafts survive a refresh; tax ID and DEA never stored. */
import { beforeEach, describe, expect, it } from 'vitest'
import { clearDraft, draftKey, loadDraft, PRACTICE_DRAFT_OMIT, saveDraft } from '@/lib/formDraft'

beforeEach(() => localStorage.clear())

describe('form drafts', () => {
  it('saves and restores per user, leaving out the sensitive identifiers', () => {
    const key = draftKey('practice', 'user-1')
    saveDraft(
      key,
      { legalName: 'Sunrise LLC', federalTaxId: '12-3456789', deaNumber: 'AB1234563' },
      PRACTICE_DRAFT_OMIT
    )
    expect(loadDraft(key)).toEqual({ legalName: 'Sunrise LLC' })
    expect(localStorage.getItem(key!)).not.toMatch(/3456789|AB1234563/)
    expect(loadDraft(draftKey('practice', 'user-2'))).toBeNull()
  })

  it('is cleared on save and expires after a week', () => {
    const key = draftKey('practitioners', 'user-1')
    saveDraft(key, { rows: [] })
    clearDraft(key)
    expect(loadDraft(key)).toBeNull()
    saveDraft(key, { rows: [] })
    expect(loadDraft(key, Date.now() + 8 * 24 * 60 * 60 * 1000)).toBeNull()
    expect(localStorage.getItem(key!)).toBeNull()
  })

  it('needs a signed-in user', () => {
    expect(draftKey('practice', null)).toBeNull()
    saveDraft(null, { a: 1 })
    expect(loadDraft(null)).toBeNull()
  })
})
