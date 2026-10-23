import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'
import { createPasswordSetupToken } from './passwordSetupService'
import { sendStaffInviteEmail } from './emailService'

const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

const RESERVED_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'dashboard',
  'mail',
  'smtp',
  'pop',
  'imap',
  'ns1',
  'ns2',
  'ftp',
  'cdn',
  'media',
  'assets',
  'static',
  'status',
  'help',
  'support',
  'blog',
  'docs',
  'dev',
  'staging',
  'medoflow',
  'platform',
])

function sanitizeSubdomain(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

function buildSetupLink(token: string): string {
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  return `${base}/set-password?token=${token}&firstLogin=1`
}

export interface CreateClinicByPlatformInput {
  clinicName: string
  clinicEmail: string
  ownerName: string
  ownerEmail: string
  subdomain: string
  plan?: 'FREE' | 'STARTER' | 'GROWTH' | 'ENTERPRISE'
}

export async function createClinicByPlatform(input: CreateClinicByPlatformInput) {
  const subdomain = sanitizeSubdomain(input.subdomain)
  if (!SUBDOMAIN_RE.test(subdomain)) {
    const err = new Error(
      'Subdomain must be 3-63 chars, lowercase letters, numbers, hyphens.'
    ) as ApiError
    err.statusCode = 400
    throw err
  }
  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    const err = new Error('This subdomain is reserved.') as ApiError
    err.statusCode = 400
    throw err
  }

  const ownerEmail = input.ownerEmail.trim().toLowerCase()
  const clinicEmail = input.clinicEmail.trim().toLowerCase()

  const [existingUser, existingBrand] = await Promise.all([
    prisma.user.findUnique({ where: { email: ownerEmail } }),
    prisma.brand.findUnique({ where: { subdomain } }),
  ])
  if (existingUser) {
    const err = new Error('An account with the owner email already exists.') as ApiError
    err.statusCode = 409
    throw err
  }
  if (existingBrand) {
    const err = new Error('This subdomain is already taken.') as ApiError
    err.statusCode = 409
    throw err
  }

  const trialEndsAt = new Date()
  trialEndsAt.setDate(trialEndsAt.getDate() + 14)

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: input.clinicName,
        slug: subdomain,
        status: 'TRIAL',
        plan: input.plan ?? 'FREE',
        trialEndsAt,
      },
    })

    await tx.brand.create({
      data: {
        tenantId: tenant.id,
        subdomain,
        primaryColor: '#6366f1',
        typographyPair: 'inter-inter',
      },
    })

    // Website at <subdomain>.<SITE_ROOT_DOMAIN> and /s/<subdomain> (Component 8).
    const slugTaken = await tx.clinic.findUnique({
      where: { slug: subdomain },
      select: { id: true },
    })
    const clinic = await tx.clinic.create({
      data: {
        tenantId: tenant.id,
        name: input.clinicName,
        email: clinicEmail,
        slug: slugTaken ? null : subdomain,
        isActive: true,
        aiEnabled: true,
      },
    })
    const labelTaken = await tx.siteDomain.findUnique({
      where: { hostname: subdomain },
      select: { id: true },
    })
    if (!labelTaken) {
      await tx.siteDomain.create({
        data: {
          clinicId: clinic.id,
          hostname: subdomain,
          kind: 'SUBDOMAIN',
          status: 'VERIFIED',
          verifiedAt: new Date(),
          isPrimary: true,
        },
      })
    }

    // Owner created without a password — they'll set it via the invite link.
    const user = await tx.user.create({
      data: {
        name: input.ownerName.trim(),
        email: ownerEmail,
        // Placeholder hash so the column is non-null; the invite flow rewrites
        // it before the account is usable. Login is impossible until set.
        password: '__pending_invite__',
        role: 'SUPER_ADMIN',
        clinicId: clinic.id,
        isActive: true,
      },
      select: { id: true, email: true, name: true },
    })

    return { tenant, clinic, user, subdomain }
  })

  const token = await createPasswordSetupToken(result.user.id)
  const setupLink = buildSetupLink(token)
  try {
    await sendStaffInviteEmail({
      to: result.user.email,
      name: result.user.name ?? input.ownerName,
      setupLink,
      roleLabel: 'Clinic Admin',
    })
  } catch (e) {
    // Email is best-effort; the platform admin can resend later.
    console.error('[createClinicByPlatform] invite email failed', e)
  }

  return { ...result, setupLink }
}

export interface ListClinicsFilters {
  q?: string
  status?: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED'
  plan?: 'FREE' | 'STARTER' | 'GROWTH' | 'ENTERPRISE'
  limit?: number
  offset?: number
}

export async function listClinics(filters: ListClinicsFilters = {}) {
  const where: Record<string, unknown> = {}
  if (filters.status) where['status'] = filters.status
  if (filters.plan) where['plan'] = filters.plan
  if (filters.q && filters.q.trim()) {
    const q = filters.q.trim()
    where['OR'] = [
      { name: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q, mode: 'insensitive' } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(filters.limit ?? 50, 200),
      skip: filters.offset ?? 0,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        plan: true,
        trialEndsAt: true,
        termsAcceptedAt: true,
        onboardingCompletedAt: true,
        createdAt: true,
        clinics: { select: { id: true, name: true, email: true }, take: 1 },
      },
    }),
    prisma.tenant.count({ where }),
  ])

  return { items, total }
}

export async function getClinicDetail(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      plan: true,
      trialEndsAt: true,
      termsAcceptedAt: true,
      termsVersion: true,
      onboardingCompletedAt: true,
      onboardingStep: true,
      createdAt: true,
      brand: {
        select: { subdomain: true, customDomain: true, primaryColor: true, logoUrl: true },
      },
      clinics: {
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          _count: {
            select: { providers: true, locations: true, users: true },
          },
        },
      },
    },
  })

  if (!tenant) {
    const err = new Error('Tenant not found') as ApiError
    err.statusCode = 404
    throw err
  }
  return tenant
}

export async function resendInvite(tenantId: string) {
  // Find the SUPER_ADMIN owner of the tenant's primary clinic.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      name: true,
      clinics: {
        select: {
          id: true,
          users: {
            where: { role: 'SUPER_ADMIN' },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { id: true, name: true, email: true },
          },
        },
        take: 1,
      },
    },
  })

  const owner = tenant?.clinics[0]?.users[0]
  if (!owner) {
    const err = new Error('No owner account found for this tenant') as ApiError
    err.statusCode = 404
    throw err
  }

  const token = await createPasswordSetupToken(owner.id)
  const setupLink = buildSetupLink(token)
  await sendStaffInviteEmail({
    to: owner.email,
    name: owner.name ?? 'Clinic Admin',
    setupLink,
    roleLabel: 'Clinic Admin',
  })
  return { setupLink, ownerEmail: owner.email }
}
