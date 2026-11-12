/**
 * The patient's checkout link for a cart the AI scribe built (CTO-32).
 *
 *  - A clinic with a published website on its own address keeps its own
 *    checkout: <site>/checkout.
 *  - A clinic without one gets a MedoFlow-hosted, clinic-branded checkout:
 *    <app>/c/<clinic-slug>/cart?t=<token>, which opens the existing cart and
 *    one-click checkout.
 *
 * The token is 32 random bytes; only its SHA-256 is stored. Opening it needs
 * the patient to be signed in as the cart's own patient, and it expires after
 * 72 hours: anyone else (or an expired / unknown token) gets "not found", so
 * the link never exposes the cart.
 */
import crypto from 'crypto'
import prisma from '../config/prisma'
import { withTenantBypass } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import { siteBaseUrls } from '../site/services/domainService'
import * as auditService from './auditService'
import { sendCartReadyEmail } from './emailService'

export const CHECKOUT_LINK_TTL_MS = 72 * 60 * 60 * 1000

const frontendUrl = () =>
  (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

function notFound(): ApiError {
  const err = new Error('This checkout link is not valid') as ApiError
  err.statusCode = 404
  err.code = 'not_found'
  return err
}

/** Whether the clinic has a published website on an address of its own. */
async function hasOwnSite(clinicId: string) {
  const site = await prisma.site.findFirst({
    where: { clinicId, publishedAt: { not: null } },
    select: { id: true },
  })
  if (!site) return null
  const urls = await siteBaseUrls(clinicId)
  return urls.canonicalKind === 'domain' ? urls.canonical : null
}

export async function createCheckoutLink(params: {
  clinicId: string
  cartId: string
  patientId: string
}): Promise<{ url: string; kind: 'site' | 'medoflow'; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + CHECKOUT_LINK_TTL_MS)
  const siteOrigin = await hasOwnSite(params.clinicId)
  if (siteOrigin) return { url: `${siteOrigin}/checkout`, kind: 'site', expiresAt }

  const clinic = await prisma.clinic.findFirst({
    where: { id: params.clinicId },
    select: { slug: true, id: true },
  })
  const token = crypto.randomBytes(32).toString('hex')
  await prisma.checkoutLinkToken.create({
    data: {
      clinicId: params.clinicId,
      cartId: params.cartId,
      patientId: params.patientId,
      tokenHash: hashToken(token),
      expiresAt,
    },
  })
  const slug = clinic?.slug ?? clinic?.id ?? params.clinicId
  return {
    url: `${frontendUrl()}/c/${encodeURIComponent(slug)}/cart?t=${token}`,
    kind: 'medoflow',
    expiresAt,
  }
}

/**
 * The signed-in patient opens their link. Returns the clinic to check out
 * with; 404 for an unknown, expired or someone else's token.
 */
export async function openCheckoutLink(token: string, patientUserId: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw notFound()
  // Looked up by its hash before any clinic context exists; the patient check
  // below is what keeps it theirs.
  const row = await withTenantBypass('checkout-link:open', () =>
    prisma.checkoutLinkToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { clinic: { select: { id: true, slug: true, name: true } } },
    })
  )
  if (!row || row.patientId !== patientUserId || row.expiresAt <= new Date()) throw notFound()
  if (!row.usedAt) {
    await withTenantBypass('checkout-link:open', async () => {
      await prisma.checkoutLinkToken.updateMany({
        where: { id: row.id, clinicId: row.clinicId, usedAt: null },
        data: { usedAt: new Date() },
      })
      await auditService.logAudit({
        clinicId: row.clinicId,
        entityType: 'Cart',
        entityId: row.cartId,
        action: 'CHECKOUT_LINK_OPENED',
        performedById: patientUserId,
      })
    })
  }
  return { clinicId: row.clinic.id, clinicSlug: row.clinic.slug, clinicName: row.clinic.name }
}

/**
 * After "Approve & send" builds a cart (CTO-32/33): make the patient's link
 * and e-mail it to them (best effort; works without SMTP, the provider sees
 * the link to share). Returns the link, or null when nothing went into the cart.
 */
export async function sendCartLink(params: {
  clinicId: string
  cartId: string | null
  cartItemCount: number
  patientId: string
}): Promise<{ url: string; kind: 'site' | 'medoflow'; emailed: boolean } | null> {
  if (!params.cartId || params.cartItemCount === 0) return null
  const link = await createCheckoutLink({
    clinicId: params.clinicId,
    cartId: params.cartId,
    patientId: params.patientId,
  })
  let emailed = false
  try {
    const [patient, clinic] = await Promise.all([
      prisma.user.findUnique({
        where: { id: params.patientId },
        select: { name: true, email: true },
      }),
      prisma.clinic.findFirst({ where: { id: params.clinicId }, select: { name: true } }),
    ])
    if (patient?.email && !patient.email.endsWith('@patients.invalid') && process.env.SMTP_HOST) {
      await sendCartReadyEmail({
        to: patient.email,
        name: patient.name,
        clinicName: clinic?.name ?? 'Your clinic',
        link: link.url,
      })
      emailed = true
    }
  } catch (err) {
    console.warn('[checkoutLink] e-mail not sent:', (err as Error).message)
  }
  await auditService.logAudit({
    clinicId: params.clinicId,
    entityType: 'Cart',
    entityId: params.cartId,
    action: 'CHECKOUT_LINK_SENT',
    newValue: { kind: link.kind, emailed },
    performedById: null,
  })
  return { url: link.url, kind: link.kind, emailed }
}
