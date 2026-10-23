import * as argon2 from 'argon2'
import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'

export interface SignupData {
  // Account step
  ownerName: string
  ownerEmail: string
  password: string
  // Clinic step
  clinicName: string
  clinicEmail: string
  // Subdomain step
  subdomain: string
}

function sanitizeSubdomain(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

function isValidSubdomain(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(slug)
}

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
  // 'default' was listed here historically but the seed tenant uses that
  // slug — removing it so the reserved list reflects what's actually
  // forbidden for new signups. Tenant slug uniqueness is still enforced
  // via the unique constraint on Brand.subdomain.
])

/**
 * Creates a Tenant, Brand, Clinic, and owner User in one transaction.
 * If any step fails, the entire signup is rolled back.
 */
export async function provisionTenant(data: SignupData) {
  const subdomain = sanitizeSubdomain(data.subdomain)

  if (!isValidSubdomain(subdomain)) {
    const err = new Error(
      'Subdomain must be 3-63 characters, lowercase letters, numbers, and hyphens only.'
    ) as ApiError
    err.statusCode = 400
    throw err
  }

  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    const err = new Error('This subdomain is reserved. Please choose another.') as ApiError
    err.statusCode = 400
    throw err
  }

  const email = data.ownerEmail.trim().toLowerCase()
  const clinicEmail = data.clinicEmail.trim().toLowerCase()

  // Check for existing email before entering transaction (faster fail)
  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    const err = new Error('An account with this email already exists.') as ApiError
    err.statusCode = 409
    throw err
  }

  const existingBrand = await prisma.brand.findUnique({ where: { subdomain } })
  if (existingBrand) {
    const err = new Error('This subdomain is already taken.') as ApiError
    err.statusCode = 409
    throw err
  }

  const hashedPassword = await argon2.hash(data.password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })

  const trialEndsAt = new Date()
  trialEndsAt.setDate(trialEndsAt.getDate() + 14) // 14-day trial

  return prisma.$transaction(async (tx) => {
    // 1. Create Tenant
    const tenant = await tx.tenant.create({
      data: {
        name: data.clinicName,
        slug: subdomain,
        status: 'TRIAL',
        plan: 'FREE',
        trialEndsAt,
      },
    })

    // 2. Create Brand
    await tx.brand.create({
      data: {
        tenantId: tenant.id,
        subdomain,
        primaryColor: '#6366f1',
        typographyPair: 'inter-inter',
      },
    })

    // 3. Create Clinic (tied to tenant). Its website lives at
    //    <subdomain>.<SITE_ROOT_DOMAIN> and /s/<subdomain> (Component 8).
    const slugTaken = await tx.clinic.findUnique({
      where: { slug: subdomain },
      select: { id: true },
    })
    const clinic = await tx.clinic.create({
      data: {
        tenantId: tenant.id,
        name: data.clinicName,
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

    // 4. Create owner User (SUPER_ADMIN of their clinic)
    const user = await tx.user.create({
      data: {
        name: data.ownerName.trim(),
        email,
        password: hashedPassword,
        role: 'SUPER_ADMIN',
        clinicId: clinic.id,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        clinicId: true,
        createdAt: true,
      },
    })

    // 5. Create default Location for the clinic
    await tx.location.create({
      data: {
        clinicId: clinic.id,
        name: 'Main Location',
        timezone: 'UTC',
        isActive: true,
      },
    })

    return { tenant, clinic, user, subdomain }
  })
}

export async function checkSubdomainAvailability(subdomain: string): Promise<boolean> {
  const sanitized = sanitizeSubdomain(subdomain)
  if (!isValidSubdomain(sanitized) || RESERVED_SUBDOMAINS.has(sanitized)) return false
  const existing = await prisma.brand.findUnique({ where: { subdomain: sanitized } })
  if (existing) return false
  // Also free as a clinic-site label (Component 8).
  const site = await prisma.siteDomain.findUnique({
    where: { hostname: sanitized },
    select: { id: true },
  })
  return site === null
}

export async function getTenantBySubdomain(subdomain: string) {
  return prisma.brand.findUnique({
    where: { subdomain },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          status: true,
          plan: true,
          clinics: { select: { id: true, name: true, isActive: true }, take: 1 },
        },
      },
    },
  })
}
