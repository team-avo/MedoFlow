/** Clinic onboarding — CLINIC_REVIEW_MODE and the reviewer inbox. */
import { describe, expect, it } from 'vitest'
import {
  clinicReviewMode,
  isAutoClinicReview,
  platformReviewRecipients,
} from '../config/clinicReview'

describe('clinicReviewMode', () => {
  it('is manual unless set to auto (case and spaces ignored)', () => {
    expect(clinicReviewMode({})).toBe('manual')
    expect(clinicReviewMode({ CLINIC_REVIEW_MODE: 'yes' })).toBe('manual')
    expect(clinicReviewMode({ CLINIC_REVIEW_MODE: ' AUTO ' })).toBe('auto')
    expect(isAutoClinicReview({ CLINIC_REVIEW_MODE: 'auto' })).toBe(true)
    expect(isAutoClinicReview({})).toBe(false)
  })
})

describe('platformReviewRecipients', () => {
  it('reads a comma-separated list, or null to fall back to platform admins', () => {
    expect(platformReviewRecipients({})).toBeNull()
    expect(platformReviewRecipients({ PLATFORM_REVIEW_EMAIL: ' , ' })).toBeNull()
    expect(
      platformReviewRecipients({ PLATFORM_REVIEW_EMAIL: 'a@example.test, b@example.test' })
    ).toEqual(['a@example.test', 'b@example.test'])
  })
})
