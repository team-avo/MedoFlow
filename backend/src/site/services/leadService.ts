/**
 * Contact-form enquiries from clinic websites (B8.5). An enquiry can contain
 * health information, so it is handled as PHI:
 *   - name, email, phone and message are sealed at rest (field encryption);
 *   - only clinic admins and front desk can list or read them;
 *   - every read is audited (SITE_LEAD_READ);
 *   - the notification email carries no enquiry content;
 *   - spam is filtered with a honeypot field, a minimum fill time and a
 *     per-IP rate limit on the public route.
 */
import prisma from '../../config/prisma'
import { notFound, siteError } from '../errors'
import { auditSite, type SiteActor } from '../actor'
import { sendSiteLeadNotification } from '../../services/emailService'

/** A human takes longer than this to fill the form; bots usually don't. */
export const MIN_FILL_MS = 2500
export const MAX_FILL_MS = 24 * 60 * 60 * 1000

export interface LeadInput {
  name: string
  email: string
  phone?: string
  message: string
  sourcePath?: string
  /** Honeypot: hidden from people, filled in by bots. */
  website?: string
  /** When the form was rendered (ms epoch, from the page). */
  startedAt?: number
}

export type LeadOutcome = { accepted: true; id: string | null }

/**
 * Stores an enquiry for `clinicId`. Spam is accepted silently (same response
 * as a real submission) so bots learn nothing.
 */
export async function createLead(
  clinicId: string,
  input: LeadInput,
  now = Date.now()
): Promise<LeadOutcome> {
  if (input.website && input.website.trim()) return { accepted: true, id: null }
  const age = now - (input.startedAt ?? 0)
  if (!input.startedAt || age < MIN_FILL_MS || age > MAX_FILL_MS)
    return { accepted: true, id: null }

  const clinic = await prisma.clinic.findFirst({
    where: { id: clinicId, isActive: true },
    select: { id: true, name: true, email: true },
  })
  if (!clinic) throw siteError(404, 'site_not_found', 'Site not found')

  const lead = await prisma.siteLead.create({
    data: {
      clinicId,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim() || null,
      message: input.message.trim(),
      sourcePath: input.sourcePath?.slice(0, 300) ?? null,
    },
    select: { id: true },
  })
  const app = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '')
  void sendSiteLeadNotification({
    to: clinic.email,
    clinicName: clinic.name,
    inboxUrl: `${app}/dashboard/site/leads`,
  }).catch(() => undefined)
  return { accepted: true, id: lead.id }
}

const LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  sourcePath: true,
  readAt: true,
  createdAt: true,
} as const

/** Inbox list: contact details only — the message body is read one at a time. */
export async function listLeads(
  clinicId: string,
  opts: { status?: 'NEW' | 'READ' | 'ARCHIVED'; take?: number } = {}
) {
  const status = opts.status
  const where = status ? { clinicId, status } : { clinicId, status: { not: 'ARCHIVED' as const } }
  const [items, unread] = await Promise.all([
    prisma.siteLead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.take ?? 100, 200),
      select: LIST_SELECT,
    }),
    prisma.siteLead.count({ where: { clinicId, status: 'NEW' } }),
  ])
  return { items, unread }
}

export async function readLead(actor: SiteActor, id: string) {
  const lead = await prisma.siteLead.findFirst({
    where: { id, clinicId: actor.clinicId },
    select: { ...LIST_SELECT, message: true },
  })
  if (!lead) throw notFound('Enquiry')
  if (lead.status === 'NEW') {
    await prisma.siteLead.update({
      where: { id, clinicId: actor.clinicId },
      data: { status: 'READ', readAt: new Date() },
    })
  }
  await auditSite(actor, { entityType: 'SiteLead', entityId: id, action: 'SITE_LEAD_READ' })
  return { ...lead, status: lead.status === 'NEW' ? ('READ' as const) : lead.status }
}

export async function setLeadStatus(
  actor: SiteActor,
  id: string,
  status: 'READ' | 'ARCHIVED' | 'NEW'
) {
  const lead = await prisma.siteLead.findFirst({
    where: { id, clinicId: actor.clinicId },
    select: { id: true, status: true },
  })
  if (!lead) throw notFound('Enquiry')
  await prisma.siteLead.update({ where: { id, clinicId: actor.clinicId }, data: { status } })
  await auditSite(actor, {
    entityType: 'SiteLead',
    entityId: id,
    action: 'SITE_LEAD_STATUS',
    oldValue: lead.status,
    newValue: status,
  })
  return { id, status }
}
