import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'
import { logAudit } from './auditService'
import { sendClinicAgreementConfirmation } from './emailService'

export const CURRENT_TERMS_VERSION = 'v1-2026-05'

export interface OnboardingStatus {
  completedAt: Date | null
  step: number
  termsAcceptedAt: Date | null
  termsVersion: string | null
  checklist: {
    brand: boolean
    locations: boolean
    disciplines: boolean
    services: boolean
    providers: boolean
  }
  brand: {
    logoUrl: string | null
    primaryColor: string
    secondaryColor: string | null
    subdomain: string
  } | null
}

async function tenantIdFromClinic(clinicId: string): Promise<string> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { tenantId: true },
  })
  if (!clinic) {
    const err = new Error('Clinic not found') as ApiError
    err.statusCode = 404
    throw err
  }
  return clinic.tenantId
}

export async function getStatus(clinicId: string): Promise<OnboardingStatus> {
  const tenantId = await tenantIdFromClinic(clinicId)

  const [tenant, brand, locationCount, disciplineCount, serviceCount, providerCount] =
    await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          onboardingCompletedAt: true,
          onboardingStep: true,
          termsAcceptedAt: true,
          termsVersion: true,
        },
      }),
      prisma.brand.findUnique({
        where: { tenantId },
        select: { logoUrl: true, primaryColor: true, secondaryColor: true, subdomain: true },
      }),
      prisma.location.count({ where: { clinicId, isActive: true } }),
      prisma.discipline.count({ where: { clinicId } }),
      prisma.service.count({ where: { clinicId } }),
      prisma.provider.count({ where: { clinicId } }),
    ])

  // Brand is considered "customized" when logo uploaded OR primary color changed from default
  const brandCustomized = Boolean(
    brand && (brand.logoUrl || (brand.primaryColor && brand.primaryColor !== '#6366f1'))
  )

  return {
    completedAt: tenant?.onboardingCompletedAt ?? null,
    step: tenant?.onboardingStep ?? 0,
    termsAcceptedAt: tenant?.termsAcceptedAt ?? null,
    termsVersion: tenant?.termsVersion ?? null,
    checklist: {
      brand: brandCustomized,
      locations: locationCount > 0,
      disciplines: disciplineCount > 0,
      services: serviceCount > 0,
      providers: providerCount > 0,
    },
    brand: brand ?? null,
  }
}

export async function setStep(clinicId: string, step: number): Promise<void> {
  if (!Number.isInteger(step) || step < 0 || step > 6) {
    const err = new Error('Invalid step') as ApiError
    err.statusCode = 400
    throw err
  }
  const tenantId = await tenantIdFromClinic(clinicId)
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { onboardingStep: step },
  })
}

export async function complete(clinicId: string): Promise<void> {
  const tenantId = await tenantIdFromClinic(clinicId)
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { onboardingCompletedAt: new Date() },
  })
}

export async function updateBrand(
  clinicId: string,
  data: { primaryColor?: string; secondaryColor?: string | null; logoUrl?: string | null }
): Promise<void> {
  const tenantId = await tenantIdFromClinic(clinicId)

  const updates: {
    primaryColor?: string
    secondaryColor?: string | null
    logoUrl?: string | null
  } = {}
  if (data.primaryColor !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(data.primaryColor)) {
      const err = new Error('primaryColor must be a 6-digit hex like #6366f1') as ApiError
      err.statusCode = 400
      throw err
    }
    updates.primaryColor = data.primaryColor.toLowerCase()
  }
  if (data.secondaryColor !== undefined) {
    if (data.secondaryColor !== null && !/^#[0-9a-fA-F]{6}$/.test(data.secondaryColor)) {
      const err = new Error('secondaryColor must be a 6-digit hex') as ApiError
      err.statusCode = 400
      throw err
    }
    updates.secondaryColor = data.secondaryColor?.toLowerCase() ?? null
  }
  if (data.logoUrl !== undefined) {
    updates.logoUrl = data.logoUrl
  }

  await prisma.brand.update({
    where: { tenantId },
    data: updates,
  })
}

export interface AcceptTermsInput {
  legalName: string
  taxId: string
  primaryContactName: string
  primaryContactEmail: string
  mailingAddress: string
  estimatedSeats: number
  acknowledgements: {
    baa: boolean
    hipaa: boolean
    dataResidency: boolean
    refundPolicy: boolean
    authorizedSignatory: boolean
  }
}

const REQUIRED_ACK_KEYS: Array<keyof AcceptTermsInput['acknowledgements']> = [
  'baa',
  'hipaa',
  'dataResidency',
  'refundPolicy',
  'authorizedSignatory',
]

const ACK_LABELS: Record<keyof AcceptTermsInput['acknowledgements'], string> = {
  baa: 'Business Associate Agreement (BAA)',
  hipaa: 'HIPAA compliance & PHI handling',
  dataResidency: 'US data residency',
  refundPolicy: 'Refund & cancellation policy',
  authorizedSignatory: 'Authorized to bind the clinic',
}

export async function acceptTerms(
  clinicId: string,
  userId: string,
  input: AcceptTermsInput
): Promise<{ acceptedAt: Date; version: string }> {
  for (const key of REQUIRED_ACK_KEYS) {
    if (!input.acknowledgements[key]) {
      const err = new Error(`Acknowledgement "${key}" is required`) as ApiError
      err.statusCode = 400
      throw err
    }
  }

  const tenantId = await tenantIdFromClinic(clinicId)
  const acceptedAt = new Date()

  const [tenant, user] = await Promise.all([
    prisma.tenant.update({
      where: { id: tenantId },
      data: {
        termsAcceptedAt: acceptedAt,
        termsAcceptedByUserId: userId,
        termsVersion: CURRENT_TERMS_VERSION,
      },
      select: { name: true, plan: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    }),
  ])

  await logAudit({
    clinicId,
    entityType: 'Tenant',
    entityId: tenantId,
    action: 'TERMS_ACCEPTED',
    fieldChanged: 'termsVersion',
    oldValue: null,
    newValue: {
      version: CURRENT_TERMS_VERSION,
      legalName: input.legalName,
      taxId: input.taxId,
      primaryContactName: input.primaryContactName,
      primaryContactEmail: input.primaryContactEmail,
      mailingAddress: input.mailingAddress,
      estimatedSeats: input.estimatedSeats,
    },
    performedById: userId,
  })

  if (user?.email) {
    try {
      await sendClinicAgreementConfirmation({
        to: user.email,
        clinicName: tenant.name,
        acceptedByName: user.name ?? input.primaryContactName,
        acceptedAt,
        termsVersion: CURRENT_TERMS_VERSION,
        plan: tenant.plan,
        acknowledgements: REQUIRED_ACK_KEYS.map((k) => ACK_LABELS[k]),
      })
    } catch (e) {
      // Email is best-effort — never block agreement acceptance on SMTP.
      console.error('[acceptTerms] failed to send confirmation email', e)
    }
  }

  return { acceptedAt, version: CURRENT_TERMS_VERSION }
}
