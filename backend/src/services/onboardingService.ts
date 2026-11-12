import type { Prisma } from '@prisma/client'
import { readSiteSettings } from '../site/content/settings'
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
    if (data.logoUrl && !isSafeLogoDataUrl(data.logoUrl)) {
      const err = new Error(
        'That logo file is not allowed. Use a PNG, JPEG, WebP or a plain SVG.'
      ) as ApiError
      err.statusCode = 400
      throw err
    }
    updates.logoUrl = data.logoUrl
  }

  await prisma.brand.update({
    where: { tenantId },
    data: updates,
  })

  // CTO-27: the chosen colours feed the console (Clinic.themeColor, read with
  // the session) and the website's draft theme. The live site only changes
  // when the owner publishes.
  if (updates.primaryColor || updates.logoUrl !== undefined) {
    await prisma.clinic.updateMany({
      where: { id: clinicId },
      data: {
        ...(updates.primaryColor ? { themeColor: updates.primaryColor } : {}),
        ...(updates.logoUrl !== undefined ? { logoUrl: updates.logoUrl } : {}),
      },
    })
  }
  if (updates.primaryColor || updates.secondaryColor) {
    const site = await prisma.site.findFirst({
      where: { clinicId },
      select: { settingsDraftJson: true },
    })
    if (site) {
      const settings = readSiteSettings(site.settingsDraftJson, updates.primaryColor ?? null)
      settings.theme.colors = {
        ...settings.theme.colors,
        ...(updates.primaryColor ? { primary: updates.primaryColor } : {}),
        ...(updates.secondaryColor ? { secondary: updates.secondaryColor } : {}),
      }
      await prisma.site.update({
        where: { clinicId },
        data: { settingsDraftJson: settings as unknown as Prisma.InputJsonValue },
      })
    }
  }
}

/**
 * CTO-27: a logo stored as a data URL is a raster image, or an SVG with no
 * script, event handlers, foreign objects or javascript: links (the browser
 * sanitises it first; this is the server's own check).
 */
export function isSafeLogoDataUrl(url: string): boolean {
  if (/^https?:\/\//i.test(url)) return true
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml))(;base64)?,(.*)$/is.exec(url)
  if (!m) return false
  if (m[1]!.toLowerCase() !== 'image/svg+xml') return true
  let svg: string
  try {
    svg = m[2] ? Buffer.from(m[3]!, 'base64').toString('utf8') : decodeURIComponent(m[3]!)
  } catch {
    return false
  }
  return !/<\s*script|<\s*foreignObject|\son[a-z]+\s*=|javascript:|<\s*iframe|<\s*embed|<\s*object/i.test(
    svg
  )
}
