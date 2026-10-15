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
}

export interface UserClinicSummary {
  id: string
  name: string
  tenant: UserTenantSummary
}

export interface User {
  id: string
  name: string
  email: string
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
