/**
 * How a new clinic's application is reviewed on this deployment (clinic
 * onboarding).
 *
 *   CLINIC_REVIEW_MODE=manual (default)  a platform admin reviews every
 *                                        submitted application. Until it is
 *                                        APPROVED the clinic's public site,
 *                                        online booking and patient intake
 *                                        stay off (services/clinicVerification).
 *   CLINIC_REVIEW_MODE=auto              submitting the application approves it
 *                                        straight away — for the hosted demo and
 *                                        local development.
 *
 * The single place this is read.
 */
export type ClinicReviewMode = 'manual' | 'auto'

export function clinicReviewMode(env: NodeJS.ProcessEnv = process.env): ClinicReviewMode {
  return env.CLINIC_REVIEW_MODE?.trim().toLowerCase() === 'auto' ? 'auto' : 'manual'
}

export const isAutoClinicReview = (env: NodeJS.ProcessEnv = process.env) =>
  clinicReviewMode(env) === 'auto'

/**
 * Where "an application is waiting" emails go: PLATFORM_REVIEW_EMAIL
 * (comma-separated), or null to fall back to every active platform admin.
 */
export function platformReviewRecipients(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const list = (env.PLATFORM_REVIEW_EMAIL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length ? list : null
}
