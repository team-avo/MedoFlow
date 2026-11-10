export type Role =
  | 'PLATFORM_ADMIN'
  | 'SUPER_ADMIN'
  | 'PROVIDER'
  | 'FRONT_DESK'
  | 'PATIENT'
  | 'STAFF'
  | 'ACCOUNTING'
  | 'MARKETING'

export interface UserTenantSummary {
  id: string
  name: string
  onboardingCompletedAt: string | null
  onboardingStep: number
  termsAcceptedAt: string | null
  termsVersion: string | null
  /** Clinic onboarding review; public site and booking go live once APPROVED. */
  verificationStatus?: 'PENDING_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED'
  submittedForReviewAt?: string | null
  /** The reviewer's note when changes were requested or the clinic was rejected. */
  reviewNotes?: string | null
}

export interface UserClinicSummary {
  id: string
  name: string
  tenant: UserTenantSummary
  /** Which application steps are done; null before the practice details are saved. */
  clinicProfile?: {
    practiceCompletedAt: string | null
    practitionersCompletedAt: string | null
  } | null
}

export interface User {
  id: string
  name: string
  email: string
  /** Patient contact number; auto-filled into bookings. */
  phone?: string | null
  role: Role
  clinicId: string | null
  customRoleId?: string | null
  customRoleName?: string | null
  permissions?: string[]
  hasSeenTour?: boolean
  tourCompletedAt?: string | null
  preferences?: Record<string, unknown> | null
  clinic?: UserClinicSummary | null
  hasSeenPatientTour?: boolean
  /** Two-step verification (TOTP) is on for this account (B0.2.2 / F0.2.2). */
  mfaEnabled?: boolean
}

export interface ApiResponse<T> {
  success: boolean
  message: string
  data: T
}

export interface LoginResponse {
  accessToken: string
  user: User
}

export interface RegisterPayload {
  name: string
  email: string
  password: string
}
