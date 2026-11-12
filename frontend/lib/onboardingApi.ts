/**
 * Clinic onboarding: the practice application (practice details →
 * practitioners → signed agreement), its review status, and the setup
 * checklist. Backend: backend/src/routes/onboarding.ts.
 */
import api from '@/lib/api'

export type VerificationStatus = 'PENDING_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED'

export interface Practitioner {
  name: string
  email: string
  phone?: string | null
  credentials?: string | null
  licenseNumber?: string | null
  licenseState?: string | null
  npi?: string | null
  /** Founder, CEO, Medical Director… or free text (CTO-16). */
  title?: string | null
  /** CTO-29: why a registry mismatch on this NPI is fine. */
  npiOverrideReason?: string | null
  isOwner: boolean
  isSelf: boolean
  /** The owner's own row only: false for a non-clinical owner (CTO-14). */
  seesPatients?: boolean
}

export interface ClinicProfile {
  id: string
  legalName: string
  dbaName: string | null
  practiceType: string
  /** The typed name when practiceType is OTHER (CTO-18). */
  practiceTypeOther: string | null
  /** CTO-29: NPPES lookups with any override reason. */
  npiVerification?: {
    group?: NpiCheck | null
    practitioners?: Record<string, NpiCheck>
  } | null
  locationCount: number
  officePhone: string | null
  fax: string | null
  website: string | null
  primaryContactName: string
  primaryContactEmail: string
  primaryContactPhone: string | null
  secondaryContactName: string | null
  secondaryContactEmail: string | null
  secondaryContactPhone: string | null
  mailingSameAsPrimary: boolean
  mailingAddressLine1: string | null
  mailingAddressLine2: string | null
  mailingCity: string | null
  mailingState: string | null
  mailingPostalCode: string | null
  groupNpi: string | null
  noNpi: boolean
  /** Last 4 only — the full number never comes back to the clinic. */
  federalTaxIdMasked: string | null
  deaNumberMasked: string | null
  hasDeaNumber: boolean
  licenseNumber: string | null
  licenseState: string | null
  estimatedSeats: number
  referralSource: string | null
  practitioners: Practitioner[]
  practiceCompletedAt: string | null
  practitionersCompletedAt: string | null
}

export interface ApplicationLocation {
  id: string
  name: string
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  phone: string | null
  timezone: string
}

export interface Verification {
  status: VerificationStatus
  submittedAt: string | null
  reviewedAt: string | null
  notes: string | null
}

export interface Application {
  clinicName: string
  /** Deployment switches (CTO-10): the retype-the-clinic-name step. */
  config?: { confirmClinicName: boolean }
  verification: Verification
  progress: { practice: boolean; practitioners: boolean; agreement: boolean }
  profile: ClinicProfile | null
  location: ApplicationLocation | null
  agreement: {
    version: string
    signerName: string
    signerTitle: string
    communicationsConsent: boolean
    acceptedAt: string
  } | null
}

/** What PUT /onboarding/application/practice accepts. */
export interface PracticeDetailsPayload {
  legalName: string
  dbaName: string | null
  practiceType: string
  /** The typed name when practiceType is OTHER (CTO-18). */
  practiceTypeOther: string | null
  locationCount: number
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  postalCode: string
  timezone: string
  officePhone: string | null
  fax: string | null
  website: string | null
  primaryContactName: string
  primaryContactEmail: string
  primaryContactPhone: string | null
  secondaryContactName: string | null
  secondaryContactEmail: string | null
  secondaryContactPhone: string | null
  mailingSameAsPrimary: boolean
  mailingAddressLine1: string | null
  mailingAddressLine2: string | null
  mailingCity: string | null
  mailingState: string | null
  mailingPostalCode: string | null
  noNpi: boolean
  groupNpi: string | null
  /** CTO-29 */
  groupNpiOverrideReason?: string | null
  /** Omit to keep the number on file. */
  federalTaxId?: string
  licenseNumber: string | null
  licenseState: string | null
  /** Omit to keep, null to remove. */
  deaNumber?: string | null
  estimatedSeats: number
  referralSource: string | null
}

export const ACKNOWLEDGEMENTS = {
  baa: 'I will execute a Business Associate Agreement (BAA) with MedoFlow before any patient health information (PHI) is processed',
  hipaa: 'The practice follows HIPAA requirements for handling clinical data',
  dataResidency: 'I understand patient data is stored in US data centers',
  refundPolicy: 'I have reviewed the refund and cancellation policy',
  authorizedSignatory: 'I am authorized to sign on behalf of this practice',
} as const

export type AcknowledgementKey = keyof typeof ACKNOWLEDGEMENTS
export const ACKNOWLEDGEMENT_KEYS = Object.keys(ACKNOWLEDGEMENTS) as AcknowledgementKey[]

export const COMMUNICATIONS_AUTHORIZATION =
  'I authorize MedoFlow to contact the practice by email, phone, fax and mail about this account, its review and service updates. MedoFlow does not share these details, and marketing emails can be turned off at any time.'

export interface AgreementPayload {
  acknowledgements: Record<AcknowledgementKey, boolean>
  communications: boolean
  signerName: string
  signerTitle: string
  signature: string
  /** Only when the retype step is on (CTO-10). */
  confirmClinicName?: string
}

export interface OnboardingStatus {
  completedAt: string | null
  step: number
  termsAcceptedAt: string | null
  verification: Verification
  application: { practice: boolean; practitioners: boolean; agreement: boolean }
  checklist: {
    brand: boolean
    locations: boolean
    disciplines: boolean
    services: boolean
    providers: boolean
    availability: boolean
    website: boolean
  }
  /** The clinic's brand (logo and colours). */
  brand?: {
    logoUrl: string | null
    primaryColor: string
    secondaryColor: string | null
    subdomain: string
  } | null
}

const data = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data)

export const onboardingApi = {
  getApplication: () => data<Application>(api.get('/onboarding/application')),
  savePractice: (payload: PracticeDetailsPayload) =>
    data<Application>(api.put('/onboarding/application/practice', payload)),
  savePractitioners: (practitioners: Practitioner[]) =>
    data<Application>(api.put('/onboarding/application/practitioners', { practitioners })),
  signAgreement: (payload: AgreementPayload) =>
    data<{ acceptedAt: string; version: string; verificationStatus: VerificationStatus }>(
      api.post('/onboarding/agreement', payload)
    ),
  resubmit: () =>
    data<{ verificationStatus: VerificationStatus; submittedAt: string }>(
      api.post('/onboarding/application/resubmit', {})
    ),
  getStatus: () => data<OnboardingStatus>(api.get('/onboarding/status')),
  /** CTO-27: save the logo and brand colours (site draft + console). */
  saveBrand: (body: {
    primaryColor?: string
    secondaryColor?: string | null
    logoUrl?: string | null
  }) => data<unknown>(api.patch('/onboarding/brand', body)),
  /** CTO-29: look an NPI up in NPPES (type 2 for the group, 1 for a person). */
  lookupNpi: (npi: string, expect: 1 | 2) =>
    data<NpiLookupResult>(api.get(`/onboarding/npi/${encodeURIComponent(npi)}?expect=${expect}`)),
}

export interface NpiLookup {
  npi: string
  status: 'FOUND' | 'NOT_FOUND' | 'DEACTIVATED' | 'UNAVAILABLE'
  type: 1 | 2 | null
  name: string | null
  taxonomy: string | null
  state: string | null
  checkedAt: string
}

export type NpiVerdict = 'OK' | 'WRONG_TYPE' | 'NOT_FOUND' | 'DEACTIVATED' | 'UNVERIFIED'

export interface NpiLookupResult {
  /** Null when registry lookups are off on this server (checksum only). */
  lookup: NpiLookup | null
  verdict: NpiVerdict
  message: string | null
}

export interface NpiCheck {
  lookup: NpiLookup | null
  verdict: NpiVerdict
  overrideReason: string | null
}
