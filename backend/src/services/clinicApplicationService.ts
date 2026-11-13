/**
 * Clinic onboarding application: practice details → practitioners → signed
 * agreement → platform review. The application is what a platform admin
 * verifies (NPI / EIN / license / DEA) before the clinic goes live; see
 * services/clinicVerification.ts for the go-live gate itself.
 *
 *   PENDING_REVIEW ──approve──▶ APPROVED
 *        │  ▲
 *  request│  │resubmit
 *  changes▼  │
 *   CHANGES_REQUESTED          (any non-approved) ──reject──▶ REJECTED
 *
 * Tax ID and DEA are field-encrypted at rest and only ever returned masked to
 * the clinic; platform admins see them in full, and every such read is audited.
 */
import {
  lookupNpi,
  verdictFor,
  VERDICT_MESSAGE,
  type NpiLookup,
  type NpiVerdict,
} from './npiRegistryService'
import { syncOwnerProvider } from './ownerProviderService'
import type { ClinicVerificationStatus, Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import {
  isAutoClinicReview,
  platformReviewRecipients,
  confirmClinicNameRequired,
} from '../config/clinicReview'
import type { ApiError } from '../types/errors'
import { maskIdentifier } from '../utils/practiceIds'
import type {
  AgreementInput,
  PracticeDetailsInput,
  PractitionerInput,
  ReviewDecisionInput,
} from '../validation/onboardingSchemas'
import { ACKNOWLEDGEMENT_KEYS } from '../validation/onboardingSchemas'
import { invalidateHostCache } from '../site/services/hostService'
import { logAudit } from './auditService'
import {
  sendClinicAgreementConfirmation,
  sendClinicApplicationForReview,
  sendClinicApplicationReceived,
  sendClinicReviewDecision,
} from './emailService'

/** Version of the clinic service agreement a signature is recorded against. */
export const CURRENT_TERMS_VERSION = 'v2-2026-11'

export const ACK_LABELS: Record<(typeof ACKNOWLEDGEMENT_KEYS)[number], string> = {
  baa: 'Business Associate Agreement (BAA)',
  hipaa: 'HIPAA compliance & PHI handling',
  dataResidency: 'US data residency',
  refundPolicy: 'Refund & cancellation policy',
  authorizedSignatory: 'Authorized to bind the clinic',
}

/** Fields whose change after approval matters to a reviewer. */
const REGULATED_FIELDS = [
  'legalName',
  'groupNpi',
  'noNpi',
  'federalTaxId',
  'licenseNumber',
  'licenseState',
  'deaNumber',
] as const

export interface Actor {
  userId: string
  ipAddress?: string | null
  userAgent?: string | null
}

const httpError = (statusCode: number, message: string, code?: string): ApiError =>
  Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) }) as ApiError

const appUrl = () =>
  (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')

/** Best-effort email: never fail a request because SMTP is down. */
async function bestEffort(label: string, send: () => Promise<void>): Promise<void> {
  try {
    await send()
  } catch (e) {
    console.error(`[clinicApplication] ${label} email failed`, (e as Error).message)
  }
}

async function clinicContext(clinicId: string) {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      id: true,
      name: true,
      tenantId: true,
      tenant: {
        select: {
          id: true,
          name: true,
          plan: true,
          verificationStatus: true,
          submittedForReviewAt: true,
          reviewedAt: true,
          reviewNotes: true,
          termsAcceptedAt: true,
          termsVersion: true,
          onboardingCompletedAt: true,
        },
      },
    },
  })
  if (!clinic) throw httpError(404, 'Clinic not found')
  return clinic
}

/** The clinic's first active location: signup creates it as "Main Location". */
async function primaryLocation(clinicId: string) {
  return prisma.location.findFirst({
    where: { clinicId, isActive: true },
    orderBy: { createdAt: 'asc' },
  })
}

// ─── Read ───────────────────────────────────────────────────────────────────

export type Practitioner = PractitionerInput

export function applicationProgress(
  profile: { practiceCompletedAt: Date | null; practitionersCompletedAt: Date | null } | null,
  termsAcceptedAt: Date | null
) {
  return {
    practice: Boolean(profile?.practiceCompletedAt),
    practitioners: Boolean(profile?.practitionersCompletedAt),
    agreement: Boolean(termsAcceptedAt),
  }
}

/** The application as the clinic sees it (tax ID and DEA masked). */
/**
 * Columns kept in the table but no longer part of the application: Sales rep
 * (CTO-04), office manager and accounts payable (CTO-17). Never returned.
 */
const RETIRED_PROFILE_FIELDS = [
  'salesRep',
  'officeManagerName',
  'officeManagerEmail',
  'accountsPayableName',
  'accountsPayableEmail',
] as const

function withoutRetired<T extends Record<string, unknown>>(profile: T) {
  const copy: Record<string, unknown> = { ...profile }
  for (const f of RETIRED_PROFILE_FIELDS) delete copy[f]
  return copy as Omit<T, (typeof RETIRED_PROFILE_FIELDS)[number]>
}

export async function getApplication(clinicId: string) {
  const clinic = await clinicContext(clinicId)
  const [profile, location, agreement] = await Promise.all([
    prisma.clinicProfile.findUnique({ where: { clinicId } }),
    primaryLocation(clinicId),
    prisma.clinicAgreement.findFirst({
      where: { clinicId },
      orderBy: { acceptedAt: 'desc' },
      select: {
        version: true,
        signerName: true,
        signerTitle: true,
        communicationsConsent: true,
        acceptedAt: true,
      },
    }),
  ])

  return {
    clinicName: clinic.name,
    // Deployment switches the application form follows (CTO-10).
    config: { confirmClinicName: confirmClinicNameRequired() },
    verification: {
      status: clinic.tenant.verificationStatus,
      submittedAt: clinic.tenant.submittedForReviewAt,
      reviewedAt: clinic.tenant.reviewedAt,
      notes: clinic.tenant.reviewNotes,
    },
    progress: applicationProgress(profile, clinic.tenant.termsAcceptedAt),
    profile: profile
      ? {
          ...withoutRetired(profile),
          federalTaxId: undefined,
          deaNumber: undefined,
          federalTaxIdMasked: maskIdentifier(profile.federalTaxId),
          deaNumberMasked: maskIdentifier(profile.deaNumber),
          hasDeaNumber: Boolean(profile.deaNumber),
          practitioners: (profile.practitioners ?? []) as unknown as Practitioner[],
        }
      : null,
    location: location
      ? {
          id: location.id,
          name: location.name,
          addressLine1: location.addressLine1,
          addressLine2: location.addressLine2,
          city: location.city,
          state: location.state,
          postalCode: location.postalCode,
          phone: location.phone,
          timezone: location.timezone,
        }
      : null,
    agreement,
  }
}

// ─── Step 1: practice details ───────────────────────────────────────────────

// ─── CTO-29: NPPES lookups ──────────────────────────────────────────────────

interface NpiCheck {
  lookup: NpiLookup | null
  verdict: NpiVerdict
  overrideReason: string | null
}

/**
 * Looks an NPI up and returns the check to store. A mismatch (wrong type, not
 * in the registry, deactivated) needs an override reason, or the save is
 * refused with a clear message on that field. An unreachable registry never
 * blocks: the check is stored as UNVERIFIED (checksum only).
 */
async function checkNpi(
  npi: string,
  expectType: 1 | 2,
  overrideReason: string | null | undefined,
  path: (string | number)[]
): Promise<NpiCheck> {
  const lookup = await lookupNpi(npi)
  const verdict = verdictFor(lookup, expectType)
  if (verdict !== 'OK' && verdict !== 'UNVERIFIED' && !overrideReason) {
    throw Object.assign(
      httpError(400, `${VERDICT_MESSAGE[verdict](expectType)} Add a reason to continue anyway.`),
      { code: 'npi_mismatch', details: [{ path, verdict, lookup }] }
    )
  }
  return { lookup, verdict, overrideReason: verdict === 'OK' ? null : (overrideReason ?? null) }
}

type NpiVerification = { group?: NpiCheck | null; practitioners?: Record<string, NpiCheck> }

export async function savePracticeDetails(
  clinicId: string,
  input: PracticeDetailsInput,
  actor: Actor
) {
  const clinic = await clinicContext(clinicId)
  if (clinic.tenant.verificationStatus === 'REJECTED') {
    throw httpError(
      409,
      'This application was not approved. Contact support.',
      'application_rejected'
    )
  }
  const existing = await prisma.clinicProfile.findUnique({ where: { clinicId } })
  if (!existing && !input.federalTaxId) {
    throw Object.assign(httpError(400, 'Federal Tax ID (EIN) is required'), {
      code: 'validation_error',
    })
  }

  const mailing = input.mailingSameAsPrimary
    ? {
        mailingAddressLine1: null,
        mailingAddressLine2: null,
        mailingCity: null,
        mailingState: null,
        mailingPostalCode: null,
      }
    : {
        mailingAddressLine1: input.mailingAddressLine1,
        mailingAddressLine2: input.mailingAddressLine2,
        mailingCity: input.mailingCity,
        mailingState: input.mailingState,
        mailingPostalCode: input.mailingPostalCode,
      }

  // CTO-29: the group NPI must be a real organisation (type 2) NPI.
  const previousNpi = (existing?.npiVerification ?? {}) as NpiVerification
  const groupCheck =
    !input.noNpi && input.groupNpi
      ? await checkNpi(input.groupNpi, 2, input.groupNpiOverrideReason, ['groupNpi'])
      : null

  const data = {
    npiVerification: { ...previousNpi, group: groupCheck } as unknown as Prisma.InputJsonValue,
    legalName: input.legalName,
    dbaName: input.dbaName,
    practiceType: input.practiceType,
    practiceTypeOther: input.practiceType === 'OTHER' ? input.practiceTypeOther : null,
    locationCount: input.locationCount,
    officePhone: input.officePhone,
    fax: input.fax,
    website: input.website,
    primaryContactName: input.primaryContactName,
    primaryContactEmail: input.primaryContactEmail,
    primaryContactPhone: input.primaryContactPhone,
    secondaryContactName: input.secondaryContactName,
    secondaryContactEmail: input.secondaryContactEmail,
    secondaryContactPhone: input.secondaryContactPhone,
    mailingSameAsPrimary: input.mailingSameAsPrimary,
    ...mailing,
    noNpi: input.noNpi,
    groupNpi: input.noNpi ? null : input.groupNpi,
    licenseNumber: input.licenseNumber,
    licenseState: input.licenseState,
    estimatedSeats: input.estimatedSeats,
    referralSource: input.referralSource,
    ...(input.federalTaxId ? { federalTaxId: input.federalTaxId } : {}),
    ...(input.deaNumber !== undefined ? { deaNumber: input.deaNumber } : {}),
  }

  const changedRegulated = existing
    ? REGULATED_FIELDS.filter((f) => f in data && data[f as keyof typeof data] !== existing[f])
    : []

  const now = new Date()
  const profile = existing
    ? await prisma.clinicProfile.update({
        where: { clinicId },
        data: { ...data, practiceCompletedAt: existing.practiceCompletedAt ?? now },
      })
    : await prisma.clinicProfile.create({
        data: {
          clinicId,
          ...data,
          federalTaxId: input.federalTaxId!,
          practiceCompletedAt: now,
        },
      })

  // The primary address and timezone belong on the clinic's first location:
  // that is what booking, reminders and the website read. Signup creates it
  // with timezone UTC, so this is where the real zone is set.
  const location = await primaryLocation(clinicId)
  const locationData = {
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? undefined,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: 'US',
    phone: input.officePhone ?? undefined,
    timezone: input.timezone,
  }
  if (location) {
    await prisma.location.update({ where: { id: location.id, clinicId }, data: locationData })
  } else {
    await prisma.location.create({ data: { clinicId, name: 'Main Location', ...locationData } })
  }

  await logAudit({
    clinicId,
    entityType: 'ClinicProfile',
    entityId: profile.id,
    action: existing ? 'CLINIC_PROFILE_UPDATED' : 'CLINIC_PROFILE_CREATED',
    // Field names only: the values (tax ID, DEA) never enter the audit log.
    fieldChanged: changedRegulated.length ? changedRegulated.join(',') : null,
    newValue: {
      practiceType: profile.practiceType,
      noNpi: profile.noNpi,
      verificationStatus: clinic.tenant.verificationStatus,
    },
    severity:
      changedRegulated.length && clinic.tenant.verificationStatus === 'APPROVED'
        ? 'warning'
        : 'info',
    performedById: actor.userId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  })

  return getApplication(clinicId)
}

// ─── Step 2: practitioners ──────────────────────────────────────────────────

export async function savePractitioners(
  clinicId: string,
  practitioners: PractitionerInput[],
  actor: Actor
) {
  const clinic = await clinicContext(clinicId)
  if (clinic.tenant.verificationStatus === 'REJECTED') {
    throw httpError(
      409,
      'This application was not approved. Contact support.',
      'application_rejected'
    )
  }
  const profile = await prisma.clinicProfile.findUnique({ where: { clinicId } })
  if (!profile?.practiceCompletedAt) {
    throw httpError(409, 'Complete the practice details first', 'practice_incomplete')
  }
  // A practice with a group NPI is a covered provider practice: every
  // practitioner on it needs their own NPI too.
  if (!profile.noNpi) {
    // A non-clinical owner (CTO-14: "I see patients" unticked) has no NPI.
    const missing = practitioners.findIndex(
      (p) => !p.npi && !(p.isSelf && p.seesPatients === false)
    )
    if (missing >= 0) {
      throw Object.assign(
        httpError(400, `Enter an NPI for ${practitioners[missing]!.name}`, 'validation_error'),
        { details: [{ path: ['practitioners', missing, 'npi'] }] }
      )
    }
  }

  // CTO-29: each practitioner's NPI must be a real individual (type 1) NPI.
  const practitionerChecks: Record<string, NpiCheck> = {}
  for (const [i, p] of practitioners.entries()) {
    if (!p.npi) continue
    practitionerChecks[p.npi] = await checkNpi(p.npi, 1, p.npiOverrideReason, [
      'practitioners',
      i,
      'npi',
    ])
  }
  const npiVerification = {
    ...((profile.npiVerification ?? {}) as NpiVerification),
    practitioners: practitionerChecks,
  }

  await prisma.clinicProfile.update({
    where: { clinicId },
    data: {
      npiVerification: npiVerification as unknown as Prisma.InputJsonValue,
      practitioners: practitioners as unknown as Prisma.InputJsonValue,
      practitionersCompletedAt: profile.practitionersCompletedAt ?? new Date(),
    },
  })

  // CTO-14: the account creator is a provider automatically when they see
  // patients; no separate "Add me" step.
  const self = practitioners.find((p) => p.isSelf)
  if (self) {
    await syncOwnerProvider({
      clinicId,
      ownerUserId: actor.userId,
      seesPatients: self.seesPatients !== false,
      performedById: actor.userId,
    })
  }

  await logAudit({
    clinicId,
    entityType: 'ClinicProfile',
    entityId: profile.id,
    action: 'CLINIC_PRACTITIONERS_UPDATED',
    newValue: { count: practitioners.length, ownerSeesPatients: self?.seesPatients !== false },
    performedById: actor.userId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  })

  return getApplication(clinicId)
}

// ─── Step 3: agreement + submit for review ──────────────────────────────────

const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

async function notifyReviewers(params: {
  tenantId: string
  clinicName: string
  legalName: string
  practiceType: string
  resubmitted: boolean
}) {
  let recipients = platformReviewRecipients()
  if (!recipients) {
    const admins = await prisma.user.findMany({
      where: { role: 'PLATFORM_ADMIN', isActive: true },
      select: { email: true },
      take: 20,
    })
    recipients = admins.map((a) => a.email)
  }
  const reviewUrl = `${appUrl()}/platform/clinics/${params.tenantId}`
  for (const to of recipients) {
    await bestEffort('review-queue', () =>
      sendClinicApplicationForReview({
        to,
        clinicName: params.clinicName,
        legalName: params.legalName,
        practiceType: params.practiceType,
        resubmitted: params.resubmitted,
        reviewUrl,
      })
    )
  }
}

/** Status a (re)submitted application moves to. */
function statusOnSubmit(current: ClinicVerificationStatus): ClinicVerificationStatus {
  // Clinics created by a platform admin (and every clinic that existed before
  // review was introduced) are already approved, signing doesn't undo that.
  if (current === 'APPROVED') return 'APPROVED'
  return isAutoClinicReview() ? 'APPROVED' : 'PENDING_REVIEW'
}

export async function signAgreement(clinicId: string, input: AgreementInput, actor: Actor) {
  const clinic = await clinicContext(clinicId)
  const tenant = clinic.tenant

  if (confirmClinicNameRequired() && !sameName(input.confirmClinicName ?? '', tenant.name)) {
    throw httpError(400, 'Confirmation name does not match clinic on file', 'validation_error')
  }
  for (const key of ACKNOWLEDGEMENT_KEYS) {
    if (!input.acknowledgements[key]) {
      throw httpError(400, `Acknowledgement "${key}" is required`, 'validation_error')
    }
  }
  if (!input.communications) {
    throw httpError(400, 'Please accept the communications authorization', 'validation_error')
  }
  if (!sameName(input.signature, input.signerName)) {
    throw httpError(400, 'Type your full name exactly as written above to sign', 'validation_error')
  }
  if (tenant.verificationStatus === 'REJECTED') {
    throw httpError(
      409,
      'This application was not approved. Contact support.',
      'application_rejected'
    )
  }
  if (tenant.termsAcceptedAt) {
    throw httpError(409, 'The agreement is already signed', 'already_signed')
  }
  const profile = await prisma.clinicProfile.findUnique({ where: { clinicId } })
  if (!profile?.practiceCompletedAt || !profile.practitionersCompletedAt) {
    throw httpError(
      409,
      'Complete the practice details and practitioners before signing',
      'application_incomplete'
    )
  }

  const now = new Date()
  const nextStatus = statusOnSubmit(tenant.verificationStatus)
  const autoApproved = nextStatus === 'APPROVED' && tenant.verificationStatus !== 'APPROVED'

  const agreement = await prisma.$transaction(async (tx) => {
    const row = await tx.clinicAgreement.create({
      data: {
        clinicId,
        version: CURRENT_TERMS_VERSION,
        signerUserId: actor.userId,
        signerName: input.signerName,
        signerTitle: input.signerTitle,
        signatureText: input.signature,
        acknowledgements: input.acknowledgements,
        communicationsConsent: input.communications,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent?.slice(0, 300) ?? null,
        acceptedAt: now,
      },
    })
    await tx.tenant.update({
      where: { id: tenant.id },
      data: {
        termsAcceptedAt: now,
        termsAcceptedByUserId: actor.userId,
        termsVersion: CURRENT_TERMS_VERSION,
        verificationStatus: nextStatus,
        submittedForReviewAt: now,
        // CTO-25: signing the agreement finishes onboarding. The owner lands on
        // the Command Center; branding, services and the website are optional
        // Quick setup items there, never a gate in front of the product.
        onboardingCompletedAt: tenant.onboardingCompletedAt ?? now,
        ...(autoApproved
          ? { reviewedAt: now, reviewedById: null, reviewNotes: 'Approved automatically' }
          : {}),
      },
    })
    return row
  })

  await logAudit({
    clinicId,
    entityType: 'Tenant',
    entityId: tenant.id,
    action: 'TERMS_ACCEPTED',
    fieldChanged: 'termsVersion',
    newValue: {
      version: CURRENT_TERMS_VERSION,
      agreementId: agreement.id,
      signerName: input.signerName,
      signerTitle: input.signerTitle,
      acknowledgements: ACKNOWLEDGEMENT_KEYS,
      communicationsConsent: true,
      verificationStatus: nextStatus,
    },
    performedById: actor.userId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  })
  if (autoApproved) {
    invalidateHostCache()
    await logAudit({
      clinicId,
      entityType: 'Tenant',
      entityId: tenant.id,
      action: 'CLINIC_APPROVED',
      fieldChanged: 'verificationStatus',
      oldValue: { verificationStatus: tenant.verificationStatus },
      newValue: { verificationStatus: 'APPROVED', mode: 'auto' },
      performedById: null,
    })
  }

  const owner = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { name: true, email: true },
  })
  if (owner?.email) {
    await bestEffort('agreement-confirmation', () =>
      sendClinicAgreementConfirmation({
        to: owner.email,
        clinicName: tenant.name,
        acceptedByName: input.signerName,
        acceptedAt: now,
        termsVersion: CURRENT_TERMS_VERSION,
        plan: tenant.plan,
        acknowledgements: ACKNOWLEDGEMENT_KEYS.map((k) => ACK_LABELS[k]),
      })
    )
    if (nextStatus === 'PENDING_REVIEW') {
      await bestEffort('application-received', () =>
        sendClinicApplicationReceived({
          to: owner.email,
          name: owner.name ?? input.signerName,
          clinicName: tenant.name,
          dashboardUrl: `${appUrl()}/dashboard`,
        })
      )
    }
  }
  if (nextStatus === 'PENDING_REVIEW') {
    await notifyReviewers({
      tenantId: tenant.id,
      clinicName: tenant.name,
      legalName: profile.legalName,
      practiceType: profile.practiceType,
      resubmitted: false,
    })
  }

  return {
    acceptedAt: now,
    version: CURRENT_TERMS_VERSION,
    verificationStatus: nextStatus,
  }
}

/** CHANGES_REQUESTED → PENDING_REVIEW, after the clinic has edited its application. */
export async function resubmit(clinicId: string, actor: Actor) {
  const clinic = await clinicContext(clinicId)
  const tenant = clinic.tenant
  if (tenant.verificationStatus !== 'CHANGES_REQUESTED') {
    throw httpError(409, 'There is nothing to resubmit', 'not_changes_requested')
  }
  const profile = await prisma.clinicProfile.findUnique({ where: { clinicId } })
  if (
    !profile?.practiceCompletedAt ||
    !profile.practitionersCompletedAt ||
    !tenant.termsAcceptedAt
  ) {
    throw httpError(
      409,
      'Complete every application step before resubmitting',
      'application_incomplete'
    )
  }

  const nextStatus = statusOnSubmit(tenant.verificationStatus)
  const now = new Date()
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      verificationStatus: nextStatus,
      submittedForReviewAt: now,
      ...(nextStatus === 'APPROVED'
        ? { reviewedAt: now, reviewedById: null, reviewNotes: 'Approved automatically' }
        : {}),
    },
  })
  if (nextStatus === 'APPROVED') invalidateHostCache()
  await logAudit({
    clinicId,
    entityType: 'Tenant',
    entityId: tenant.id,
    action: 'CLINIC_APPLICATION_RESUBMITTED',
    fieldChanged: 'verificationStatus',
    oldValue: { verificationStatus: tenant.verificationStatus },
    newValue: { verificationStatus: nextStatus },
    performedById: actor.userId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  })
  if (nextStatus === 'PENDING_REVIEW') {
    await notifyReviewers({
      tenantId: tenant.id,
      clinicName: tenant.name,
      legalName: profile.legalName,
      practiceType: profile.practiceType,
      resubmitted: true,
    })
  }
  return { verificationStatus: nextStatus, submittedAt: now }
}

// ─── Platform review ────────────────────────────────────────────────────────

/** The full application for a platform reviewer. Reading it is audited. */
export async function getApplicationForReview(tenantId: string, reviewerId: string) {
  const clinic = await prisma.clinic.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!clinic) return null
  const [profile, agreements, location, owner] = await Promise.all([
    prisma.clinicProfile.findUnique({ where: { clinicId: clinic.id } }),
    prisma.clinicAgreement.findMany({
      where: { clinicId: clinic.id },
      orderBy: { acceptedAt: 'desc' },
      take: 5,
    }),
    primaryLocation(clinic.id),
    prisma.user.findFirst({
      where: { clinicId: clinic.id, role: 'SUPER_ADMIN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, createdAt: true },
    }),
  ])

  if (profile) {
    await logAudit({
      clinicId: clinic.id,
      entityType: 'ClinicProfile',
      entityId: profile.id,
      action: 'CLINIC_APPLICATION_VIEWED',
      performedById: reviewerId,
    })
  }

  return {
    clinicId: clinic.id,
    owner,
    profile: profile
      ? {
          ...withoutRetired(profile),
          practitioners: (profile.practitioners ?? []) as unknown as Practitioner[],
        }
      : null,
    location,
    agreements,
  }
}

const DECISION_STATUS: Record<ReviewDecisionInput['decision'], ClinicVerificationStatus> = {
  APPROVE: 'APPROVED',
  REQUEST_CHANGES: 'CHANGES_REQUESTED',
  REJECT: 'REJECTED',
}

export async function reviewApplication(
  tenantId: string,
  input: ReviewDecisionInput,
  actor: Actor
) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      verificationStatus: true,
      termsAcceptedAt: true,
      clinics: { select: { id: true }, orderBy: { createdAt: 'asc' }, take: 1 },
    },
  })
  if (!tenant) throw httpError(404, 'Tenant not found')
  const clinicId = tenant.clinics[0]?.id ?? null
  const next = DECISION_STATUS[input.decision]

  if (tenant.verificationStatus === next) {
    // Idempotent: repeating a decision is a no-op, not an error.
    return { verificationStatus: next, changed: false }
  }
  if (input.decision === 'APPROVE' && !tenant.termsAcceptedAt) {
    throw httpError(409, 'The clinic has not signed the agreement yet', 'agreement_missing')
  }

  const now = new Date()
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      verificationStatus: next,
      reviewedAt: now,
      reviewedById: actor.userId,
      reviewNotes: input.notes ?? null,
    },
  })
  // Host → site lookups are cached for a minute; go live (or offline) now.
  invalidateHostCache()
  await logAudit({
    clinicId,
    entityType: 'Tenant',
    entityId: tenantId,
    action:
      input.decision === 'APPROVE'
        ? 'CLINIC_APPROVED'
        : input.decision === 'REJECT'
          ? 'CLINIC_REJECTED'
          : 'CLINIC_CHANGES_REQUESTED',
    fieldChanged: 'verificationStatus',
    oldValue: { verificationStatus: tenant.verificationStatus },
    newValue: { verificationStatus: next, notes: input.notes ?? null },
    performedById: actor.userId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  })

  if (clinicId) {
    const owner = await prisma.user.findFirst({
      where: { clinicId, role: 'SUPER_ADMIN', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { name: true, email: true },
    })
    if (owner) {
      await bestEffort('review-decision', () =>
        sendClinicReviewDecision({
          to: owner.email,
          name: owner.name,
          clinicName: tenant.name,
          decision: next as 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED',
          notes: input.notes ?? null,
          dashboardUrl:
            next === 'CHANGES_REQUESTED' ? `${appUrl()}/dashboard/clinic` : `${appUrl()}/dashboard`,
        })
      )
    }
  }

  return { verificationStatus: next, changed: true }
}
