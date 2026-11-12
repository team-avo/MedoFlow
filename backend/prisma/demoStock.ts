/**
 * Stocks a clinic that was signed up live in a demo, so every component can be
 * shown on that one clinic (arh demo script, Part C): a doctor with hours, a
 * front desk, a patient, the demo catalogue (incl. the AI-scribe products),
 * packages, memberships, a commission rule, and two booked visits with the
 * patient's AI-scribe consent.
 *
 * Staff and the patient get a random, unusable password and a one-time
 * /set-password link (the same token an e-mailed invite carries). The links
 * are returned to the caller and never stored anywhere else.
 *
 * Only for an APPROVED, active clinic that isn't the seeded "demo" tenant.
 * Idempotent: a second run reports everything as present and adds no rows.
 * Writes no encrypted columns, so it runs on a plain owner PrismaClient.
 */
import crypto from 'crypto'
import * as argon2 from 'argon2'
import { DateTime } from 'luxon'
import type { PrismaClient, Role } from '@prisma/client'
import { createPasswordSetupToken } from '../src/services/passwordSetupService'
import {
  DEMO_MEMBERSHIPS,
  DEMO_PACKAGES,
  DEMO_PRODUCTS,
  DEMO_SERVICES,
  SCRIBE_DEMO_PRODUCTS,
  seedBookingWorld,
  seedCatalogue,
} from './demoWorld'

export interface StockOptions {
  /** The clinic's web-address label (SiteDomain hostname or Clinic.slug). */
  label: string
  /** false = dry run: report only, write nothing. */
  apply: boolean
  /** Base of the /set-password links, e.g. https://medoflow.pages.dev */
  frontendUrl: string
  /** Issue fresh links even for accounts that already set a password. */
  reissue?: boolean
  /** Book two fresh visits even if upcoming demo visits exist. */
  newVisits?: boolean
  /** Clock override for tests. */
  now?: Date
}

export type AccountKey = 'doctor' | 'frontdesk' | 'patient'

export interface StockedAccount {
  key: AccountKey
  role: Role
  name: string
  email: string
  /** created now, already there, or would be created (dry run). */
  status: 'created' | 'present' | 'missing'
  /** One-time /set-password link; null when none was issued. */
  setupLink: string | null
}

export interface StockedVisit {
  key: 'A' | 'B'
  appointmentId: string | null
  /** Local start time at the clinic, e.g. "Thu 12 Nov 2026, 14:15 (America/Chicago)". */
  startsAt: string
  status: 'created' | 'present' | 'missing'
}

export interface StockReport {
  applied: boolean
  clinicId: string
  clinicName: string
  label: string
  timezone: string
  lines: string[]
  accounts: StockedAccount[]
  visits: StockedVisit[]
}

export class DemoStockError extends Error {}

const ACCOUNTS: { key: AccountKey; role: Role; name: string }[] = [
  { key: 'doctor', role: 'PROVIDER', name: 'Dr. Evelyn Chen' },
  { key: 'frontdesk', role: 'FRONT_DESK', name: 'Front Desk' },
  { key: 'patient', role: 'PATIENT', name: 'Anika Patel' },
]

export const accountEmail = (key: AccountKey | 'marcus.patel', label: string) =>
  `${key}@${label}.example.test`

const VISIT_NOTES = { A: 'Demo visit A', B: 'Demo visit B' } as const
const VISIT_SERVICE = 'New Patient Consultation'
const COMMISSION_PERCENT = 40
const SLOT_STEP_MIN = 15

/** The clinic for a label: its SiteDomain hostname, or Clinic.slug. Exactly one. */
async function resolveClinic(db: PrismaClient, label: string) {
  const domain = await db.siteDomain.findUnique({
    where: { hostname: label },
    select: { clinicId: true },
  })
  const clinics = await db.clinic.findMany({
    where: { OR: [{ slug: label }, ...(domain ? [{ id: domain.clinicId }] : [])] },
    select: {
      id: true,
      name: true,
      isActive: true,
      tenant: { select: { slug: true, verificationStatus: true } },
    },
  })
  if (clinics.length === 0) throw new DemoStockError(`No clinic uses the web address "${label}".`)
  if (clinics.length > 1) {
    throw new DemoStockError(
      `"${label}" matches ${clinics.length} clinics (${clinics.map((c) => c.name).join(', ')}).`
    )
  }
  const clinic = clinics[0]!
  if (clinic.tenant.slug === 'demo') {
    throw new DemoStockError('That is the seeded Demo Clinic; use prisma db seed for it.')
  }
  // Same rule as liveClinicWhere (src/services/clinicVerification.ts).
  if (!clinic.isActive || clinic.tenant.verificationStatus !== 'APPROVED') {
    throw new DemoStockError(
      `${clinic.name} is not live (active: ${clinic.isActive}, review: ${clinic.tenant.verificationStatus}). Approve it first.`
    )
  }
  return clinic
}

/**
 * The next `count` free starts for `durationMin`, Mon–Fri 09:00–17:00 at the
 * clinic, at least `noticeMin` from now, on a 15-minute grid, avoiding `busy`.
 */
export function nextFreeSlots(params: {
  now: Date
  timezone: string
  durationMin: number
  noticeMin: number
  busy: { start: Date; end: Date }[]
  count: number
}): DateTime[] {
  const { timezone, durationMin, count } = params
  const earliest = DateTime.fromJSDate(params.now, { zone: timezone }).plus({
    minutes: params.noticeMin,
  })
  const busy = params.busy.map((b) => ({ start: +b.start, end: +b.end }))
  const picked: DateTime[] = []
  for (let day = 0; day < 21 && picked.length < count; day++) {
    const date = earliest.startOf('day').plus({ days: day })
    if (date.weekday > 5) continue
    const open = date.set({ hour: 9, minute: 0 })
    const lastStart = date.set({ hour: 17, minute: 0 }).minus({ minutes: durationMin })
    for (
      let t = open;
      t <= lastStart && picked.length < count;
      t = t.plus({ minutes: SLOT_STEP_MIN })
    ) {
      if (t < earliest) continue
      const s = +t
      const e = +t.plus({ minutes: durationMin })
      if (busy.some((b) => s < b.end && e > b.start)) continue
      picked.push(t)
      busy.push({ start: s, end: e })
    }
  }
  return picked
}

const describeTime = (t: DateTime) => `${t.toFormat('ccc d LLL yyyy, HH:mm')} (${t.zoneName})`

export async function stockDemoClinic(db: PrismaClient, opts: StockOptions): Promise<StockReport> {
  const label = opts.label.trim().toLowerCase()
  if (!/^[a-z0-9-]{3,63}$/.test(label)) {
    throw new DemoStockError('The label is 3–63 lowercase letters, numbers or hyphens.')
  }
  const now = opts.now ?? new Date()
  const base = opts.frontendUrl.replace(/\/$/, '')
  const clinic = await resolveClinic(db, label)
  const location = await db.location.findFirst({
    where: { clinicId: clinic.id, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, timezone: true },
  })
  if (!location) throw new DemoStockError(`${clinic.name} has no active location.`)

  const lines: string[] = []
  const say = (s: string) => lines.push(s)
  const verb = (n: number) => (opts.apply ? `${n} added` : `${n} would be added`)

  // ── Accounts ──────────────────────────────────────────────────────────────
  const users = new Map<AccountKey, { id: string; hasPendingToken: boolean } | null>()
  for (const a of ACCOUNTS) {
    const email = accountEmail(a.key, label)
    const u = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        clinicId: true,
        role: true,
        _count: { select: { passwordSetupTokens: true } },
      },
    })
    if (u && (u.clinicId !== clinic.id || u.role !== a.role)) {
      throw new DemoStockError(
        `${email} already exists for another clinic or role; not touching it.`
      )
    }
    users.set(a.key, u ? { id: u.id, hasPendingToken: u._count.passwordSetupTokens > 0 } : null)
  }

  // ── What's there already ──────────────────────────────────────────────────
  const productNames = [...DEMO_PRODUCTS, ...SCRIBE_DEMO_PRODUCTS].map((p) => p.name)
  const [products, packages, memberships, services] = await Promise.all([
    db.product.count({ where: { clinicId: clinic.id, name: { in: productNames } } }),
    db.package.count({
      where: { clinicId: clinic.id, name: { in: DEMO_PACKAGES.map((p) => p.name) } },
    }),
    db.membership.count({
      where: { clinicId: clinic.id, name: { in: DEMO_MEMBERSHIPS.map((m) => m.name) } },
    }),
    db.service.count({
      where: { clinicId: clinic.id, name: { in: DEMO_SERVICES.map((s) => s.name) } },
    }),
  ])
  say(`Clinic: ${clinic.name} (${clinic.id}), location "${location.name}", ${location.timezone}`)
  say(
    `Services: ${services}/${DEMO_SERVICES.length} present, ${verb(DEMO_SERVICES.length - services)}`
  )
  say(
    `Products: ${products}/${productNames.length} present, ${verb(productNames.length - products)}`
  )
  say(
    `Packages: ${packages}/${DEMO_PACKAGES.length} present, ${verb(DEMO_PACKAGES.length - packages)}`
  )
  say(
    `Memberships: ${memberships}/${DEMO_MEMBERSHIPS.length} present, ${verb(DEMO_MEMBERSHIPS.length - memberships)}`
  )

  const accounts: StockedAccount[] = []
  const visits: StockedVisit[] = []

  if (!opts.apply) {
    for (const a of ACCOUNTS) {
      const u = users.get(a.key)
      accounts.push({
        key: a.key,
        role: a.role,
        name: a.name,
        email: accountEmail(a.key, label),
        status: u ? 'present' : 'missing',
        setupLink: null,
      })
    }
    const doctorProvider = users.get('doctor')
      ? await db.provider.findUnique({
          where: { userId: users.get('doctor')!.id },
          select: { id: true },
        })
      : null
    for (const key of ['A', 'B'] as const) {
      const v = doctorProvider
        ? await db.appointment.findFirst({
            where: {
              clinicId: clinic.id,
              providerId: doctorProvider.id,
              notes: VISIT_NOTES[key],
              status: 'CONFIRMED',
              startTime: { gt: now },
            },
            select: { id: true, startTime: true },
          })
        : null
      visits.push({
        key,
        appointmentId: v?.id ?? null,
        startsAt: v
          ? describeTime(DateTime.fromJSDate(v.startTime, { zone: location.timezone }))
          : '',
        status: v && !opts.newVisits ? 'present' : 'missing',
      })
    }
    return {
      applied: false,
      clinicId: clinic.id,
      clinicName: clinic.name,
      label,
      timezone: location.timezone,
      lines,
      accounts,
      visits,
    }
  }

  // ── Apply: accounts (random unusable password; links issued at the end) ───
  const ids = new Map<AccountKey, string>()
  for (const a of ACCOUNTS) {
    const existing = users.get(a.key)
    if (existing) {
      ids.set(a.key, existing.id)
      continue
    }
    const password = await argon2.hash(crypto.randomBytes(32).toString('hex'), {
      type: argon2.argon2id,
    })
    const created = await db.user.create({
      data: {
        email: accountEmail(a.key, label),
        name: a.name,
        role: a.role,
        password,
        clinicId: clinic.id,
        isActive: true,
      },
      select: { id: true },
    })
    ids.set(a.key, created.id)
  }

  // ── Booking world on the clinic's own location ────────────────────────────
  const world = await seedBookingWorld(db, clinic.id, {
    locationId: location.id,
    assignSlugs: true,
    providers: [
      {
        firstName: 'Evelyn',
        lastName: 'Chen',
        email: accountEmail('doctor', label),
        userId: ids.get('doctor')!,
      },
      {
        firstName: 'Marcus',
        lastName: 'Patel',
        email: accountEmail('marcus.patel', label),
        userId: null,
      },
    ],
  })
  const chen = world.providers.find((p) => p.firstName === 'Evelyn')!
  if (!chen.userId) {
    // An earlier, unlinked "Evelyn Chen": attach the doctor's account to it.
    await db.provider.update({ where: { id: chen.id }, data: { userId: ids.get('doctor')! } })
  }

  await seedCatalogue(db, clinic.id, { extraProducts: SCRIBE_DEMO_PRODUCTS, assignSlugs: true })

  // ── Patient belongs to the clinic (what registerUser + booking write) ────
  await db.patientClinicMembership.upsert({
    where: { clinicId_patientId: { clinicId: clinic.id, patientId: ids.get('patient')! } },
    update: { isActive: true },
    create: {
      clinicId: clinic.id,
      patientId: ids.get('patient')!,
      primaryLocationId: location.id,
      isActive: true,
    },
  })

  // ── Commission rule: 40% of Dr. Chen's new-patient consultations ─────────
  const consult = world.services.find((s) => s.name === VISIT_SERVICE)!
  const rule = await db.commissionRule.findFirst({
    where: { clinicId: clinic.id, providerId: chen.id, itemType: 'SERVICE', serviceId: consult.id },
    select: { id: true },
  })
  if (!rule) {
    await db.commissionRule.create({
      data: {
        clinicId: clinic.id,
        providerId: chen.id,
        itemType: 'SERVICE',
        serviceId: consult.id,
        commissionType: 'PERCENTAGE',
        commissionValue: COMMISSION_PERCENT,
      },
    })
  }
  say(
    `Commission rule (${COMMISSION_PERCENT}% of Dr. Chen's ${VISIT_SERVICE}): ${rule ? 'present' : 'added'}`
  )

  // ── Visits A and B with AI-scribe consent ────────────────────────────────
  const busy = await db.appointment.findMany({
    where: {
      providerId: chen.id,
      endTime: { gt: now },
      status: { notIn: ['CANCELLED', 'RESCHEDULED'] },
    },
    select: { startTime: true, endTime: true },
  })
  const consultDef = DEMO_SERVICES.find((s) => s.name === VISIT_SERVICE)!
  const free = nextFreeSlots({
    now,
    timezone: location.timezone,
    durationMin: consultDef.duration,
    noticeMin: consultDef.notice,
    busy: busy.map((b) => ({ start: b.startTime, end: b.endTime })),
    count: 2,
  })
  for (const key of ['A', 'B'] as const) {
    const existing = opts.newVisits
      ? null
      : await db.appointment.findFirst({
          where: {
            clinicId: clinic.id,
            providerId: chen.id,
            patientId: ids.get('patient')!,
            notes: VISIT_NOTES[key],
            status: 'CONFIRMED',
            startTime: { gt: now },
          },
          select: { id: true, startTime: true },
        })
    if (existing) {
      visits.push({
        key,
        appointmentId: existing.id,
        startsAt: describeTime(
          DateTime.fromJSDate(existing.startTime, { zone: location.timezone })
        ),
        status: 'present',
      })
      continue
    }
    const start = free.shift()
    if (!start)
      throw new DemoStockError('No free weekday slot for Dr. Chen in the next three weeks.')
    // The appointment_no_overlap exclusion constraint still guards this insert.
    const appt = await db.appointment.create({
      data: {
        clinicId: clinic.id,
        locationId: location.id,
        providerId: chen.id,
        serviceId: consult.id,
        disciplineId: world.disciplineId,
        patientId: ids.get('patient')!,
        timezone: location.timezone,
        startTime: start.toJSDate(),
        endTime: start.plus({ minutes: consultDef.duration }).toJSDate(),
        status: 'CONFIRMED',
        priceAtBooking: consultDef.price,
        bookingSource: 'FRONT_DESK',
        notes: VISIT_NOTES[key],
        aiScribeConsentGrantedAt: now,
      },
      select: { id: true },
    })
    visits.push({ key, appointmentId: appt.id, startsAt: describeTime(start), status: 'created' })
  }

  // ── One-time /set-password links ─────────────────────────────────────────
  for (const a of ACCOUNTS) {
    const before = users.get(a.key)
    const issue = !before || before.hasPendingToken || opts.reissue
    const token = issue ? await createPasswordSetupToken(ids.get(a.key)!, db) : null
    accounts.push({
      key: a.key,
      role: a.role,
      name: a.name,
      email: accountEmail(a.key, label),
      status: before ? 'present' : 'created',
      setupLink: token ? `${base}/set-password?token=${token}` : null,
    })
  }

  await db.auditLog.create({
    data: {
      clinicId: clinic.id,
      entityType: 'Clinic',
      entityId: clinic.id,
      action: 'DEMO_CLINIC_STOCKED',
      newValue: {
        accountsCreated: accounts.filter((a) => a.status === 'created').length,
        visitsCreated: visits.filter((v) => v.status === 'created').length,
        productsAdded: productNames.length - products,
      },
    },
  })

  return {
    applied: true,
    clinicId: clinic.id,
    clinicName: clinic.name,
    label,
    timezone: location.timezone,
    lines,
    accounts,
    visits,
  }
}
