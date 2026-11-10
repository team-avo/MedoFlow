import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'
import { applicationProgress } from './clinicApplicationService'

// The agreement, practice application and review live in
// clinicApplicationService; this file keeps the setup-wizard state.

export interface OnboardingStatus {
  completedAt: Date | null
  step: number
  termsAcceptedAt: Date | null
  termsVersion: string | null
  verification: {
    status: 'PENDING_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED'
    submittedAt: Date | null
    reviewedAt: Date | null
    notes: string | null
  }
  /** Which application steps are done (practice → practitioners → agreement). */
  application: { practice: boolean; practitioners: boolean; agreement: boolean }
  checklist: {
    brand: boolean
    locations: boolean
    disciplines: boolean
    services: boolean
    providers: boolean
    /** At least one provider has weekly hours. */
    availability: boolean
    /** At least one website page is published. */
    website: boolean
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

  const [
    tenant,
    brand,
    locationCount,
    disciplineCount,
    serviceCount,
    providerCount,
    profile,
    availabilityCount,
    publishedPageCount,
    site,
  ] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        onboardingCompletedAt: true,
        onboardingStep: true,
        termsAcceptedAt: true,
        termsVersion: true,
        verificationStatus: true,
        submittedForReviewAt: true,
        reviewedAt: true,
        reviewNotes: true,
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
    prisma.clinicProfile.findUnique({
      where: { clinicId },
      select: { practiceCompletedAt: true, practitionersCompletedAt: true },
    }),
    prisma.providerAvailability.count({ where: { provider: { clinicId, isActive: true } } }),
    prisma.sitePage.count({ where: { clinicId, status: 'PUBLISHED' } }),
    prisma.site.findUnique({ where: { clinicId }, select: { settingsDraftJson: true } }),
  ])

  // Brand is considered "customized" when logo uploaded OR primary color changed from default
  // ...or a logo set in the website editor (Site settings brand.logo).
  const siteLogo = Boolean(
    (site?.settingsDraftJson as { brand?: { logo?: unknown } } | null | undefined)?.brand?.logo
  )
  const brandCustomized =
    siteLogo ||
    Boolean(brand && (brand.logoUrl || (brand.primaryColor && brand.primaryColor !== '#6366f1')))

  return {
    completedAt: tenant?.onboardingCompletedAt ?? null,
    step: tenant?.onboardingStep ?? 0,
    termsAcceptedAt: tenant?.termsAcceptedAt ?? null,
    termsVersion: tenant?.termsVersion ?? null,
    verification: {
      status: tenant?.verificationStatus ?? 'PENDING_REVIEW',
      submittedAt: tenant?.submittedForReviewAt ?? null,
      reviewedAt: tenant?.reviewedAt ?? null,
      notes: tenant?.reviewNotes ?? null,
    },
    application: applicationProgress(profile, tenant?.termsAcceptedAt ?? null),
    checklist: {
      brand: brandCustomized,
      locations: locationCount > 0,
      disciplines: disciplineCount > 0,
      services: serviceCount > 0,
      providers: providerCount > 0,
      availability: availabilityCount > 0,
      website: publishedPageCount > 0,
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
