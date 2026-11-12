/** Clinic onboarding — CLINIC_REVIEW_MODE and the reviewer inbox. */
import { describe, expect, it } from 'vitest'
import {
  clinicReviewMode,
  confirmClinicNameRequired,
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

describe('confirmClinicNameRequired (CTO-10)', () => {
  it('is off in production and on elsewhere unless ONBOARDING_CONFIRM_NAME says so', () => {
    expect(confirmClinicNameRequired({ NODE_ENV: 'production' })).toBe(false)
    expect(confirmClinicNameRequired({ NODE_ENV: 'development' })).toBe(true)
    expect(confirmClinicNameRequired({ NODE_ENV: 'test' })).toBe(true)
    expect(
      confirmClinicNameRequired({ NODE_ENV: 'production', ONBOARDING_CONFIRM_NAME: ' ON ' })
    ).toBe(true)
    expect(
      confirmClinicNameRequired({ NODE_ENV: 'development', ONBOARDING_CONFIRM_NAME: 'off' })
    ).toBe(false)
    // Anything else falls back to the environment default (and warns at boot).
    expect(
      confirmClinicNameRequired({ NODE_ENV: 'production', ONBOARDING_CONFIRM_NAME: 'yes' })
    ).toBe(false)
  })
})
