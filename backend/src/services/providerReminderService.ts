/**
 * "Your appointment starts soon" for providers (CTO-30): a Command Center
 * card and a red-dot bell notification when one of their appointments starts
 * within 10 minutes, plus an e-mail when SMTP is configured (without SMTP it
 * is skipped with a log line, never an error).
 *
 * No PHI beyond what the provider already sees: the time, "your 10:30
 * appointment", and a link. No patient name, service or reason; the payload
 * is ids and a time (the allow-list is tested).
 */
import prisma from '../config/prisma'
import { sendProviderStartingSoonEmail } from './emailService'

export const STARTING_SOON_KIND = 'APPOINTMENT_STARTING'
export const STARTING_SOON_WINDOW_MS = 10 * 60 * 1000

/** The only keys a reminder notification carries (tested). */
export const REMINDER_PAYLOAD_KEYS = [
  'clinicId',
  'userId',
  'kind',
  'title',
  'link',
  'appointmentId',
  'startsAt',
] as const

const frontendUrl = () =>
  (process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')

/** "10:30 AM" in the clinic's timezone. */
export function localTime(at: Date, timeZone: string): string {
  try {
    return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
  } catch {
    return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
}

export function reminderPayload(appt: {
  id: string
  clinicId: string
  startTime: Date
  timezone: string
  providerUserId: string
}) {
  return {
    clinicId: appt.clinicId,
    userId: appt.providerUserId,
    kind: STARTING_SOON_KIND,
    title: `Your ${localTime(appt.startTime, appt.timezone)} appointment starts soon`,
    link: `/dashboard/provider/appointments/${appt.id}/consultation?autostart=1`,
    appointmentId: appt.id,
    startsAt: appt.startTime,
  }
}

/**
 * Creates one notification per appointment starting in the next 10 minutes
 * (idempotent through the unique key) and e-mails the provider once. Runs
 * every minute from the scheduler, inside the cron tenant bypass.
 */
export async function sendStartingSoonReminders(now: Date = new Date()): Promise<number> {
  const upcoming = await prisma.appointment.findMany({
    where: {
      status: 'CONFIRMED',
      startTime: { gt: now, lte: new Date(now.getTime() + STARTING_SOON_WINDOW_MS) },
      provider: { userId: { not: null }, isActive: true },
    },
    select: {
      id: true,
      clinicId: true,
      startTime: true,
      timezone: true,
      provider: { select: { userId: true, user: { select: { email: true } } } },
    },
    take: 500,
  })
  let created = 0
  for (const appt of upcoming) {
    const providerUserId = appt.provider.userId!
    const data = reminderPayload({ ...appt, providerUserId })
    const result = await prisma.notification.createMany({ data: [data], skipDuplicates: true })
    if (result.count === 0) continue // already reminded
    created++
    const to = appt.provider.user?.email
    if (!to) continue
    if (!process.env.SMTP_HOST) {
      console.warn('[reminders] SMTP not configured; starting-soon e-mail skipped')
      continue
    }
    try {
      await sendProviderStartingSoonEmail({
        to,
        title: data.title,
        link: `${frontendUrl()}${data.link}`,
      })
    } catch (err) {
      console.warn('[reminders] starting-soon e-mail failed:', (err as Error).message)
    }
  }
  return created
}

export async function listMyNotifications(userId: string, clinicId: string) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, clinicId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        kind: true,
        title: true,
        link: true,
        appointmentId: true,
        startsAt: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where: { userId, clinicId, readAt: null } }),
  ])
  return { notifications: items, unread }
}

export async function markRead(userId: string, clinicId: string, id?: string) {
  const res = await prisma.notification.updateMany({
    where: { userId, clinicId, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: new Date() },
  })
  return res.count
}
