/**
 * Demo stocking (scripts/demo-stock-clinic.ts → prisma/demoStock.ts): a clinic
 * signed up live in a demo gets everything the rest of the demo uses, on that
 * one clinic.
 *
 *  - Refuses a clinic that isn't approved, and an unknown label; a dry run
 *    writes nothing.
 *  - Creates the doctor, front desk and patient with an unusable password and
 *    a one-time /set-password link; each signs in only after redeeming it,
 *    and a used link is refused. The patient signs in on the clinic's page.
 *  - Dr. Chen has bookable hours; Visits A and B are booked with AI-scribe
 *    consent at the next free slots; the AI-scribe products route as the demo
 *    script says (cart / e-prescribe / unmatched).
 *  - A second run adds nothing; another clinic is untouched.
 */
import crypto from 'crypto'
import { DateTime } from 'luxon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, startServer, type TestServer } from './helpers'
import { createClinicFixture } from './fixtures'
import {
  DemoStockError,
  accountEmail,
  stockDemoClinic,
  type StockReport,
} from '../../../prisma/demoStock'
import { mapOrders } from '../../services/rxMappingService'

let server: TestServer
beforeAll(async () => {
  server = await startServer()
})
afterAll(() => server.close())

const OWNER_PASSWORD = 'Synthetic-Stock-Owner-2026!'
const NEW_PASSWORD = 'Synthetic-Stock-Staff-2026!'
const FRONTEND = 'https://app.example.test'
const TZ = 'America/Chicago'

/** Monday 08:00 at the clinic, at least a week ahead (real availability uses the real clock). */
function demoMorning(): Date {
  let d = DateTime.now().setZone(TZ).plus({ weeks: 1 }).startOf('day')
  while (d.weekday !== 1) d = d.plus({ days: 1 })
  return d.set({ hour: 8 }).toJSDate()
}

async function signUp() {
  const label = `stock${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`
  const res = await api(server.url, '/tenants/signup', {
    body: {
      clinicName: `Synthetic Stock Clinic ${label}`,
      clinicEmail: `clinic.${label}@example.test`,
      subdomain: label,
      ownerName: 'Olivia Owner',
      ownerEmail: `owner.${label}@example.test`,
      password: OWNER_PASSWORD,
      plan: 'GROWTH',
    },
  })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  const clinicId: string = res.body.data.clinicId
  await adminDb.location.updateMany({ where: { clinicId }, data: { timezone: TZ } })
  return { label, clinicId, tenantId: res.body.data.tenantId as string }
}

const approve = (tenantId: string) =>
  adminDb.tenant.update({ where: { id: tenantId }, data: { verificationStatus: 'APPROVED' } })

async function clinicCounts(clinicId: string) {
  const [users, products, packages, memberships, services, providers, appointments, rules] =
    await Promise.all([
      adminDb.user.count({ where: { clinicId } }),
      adminDb.product.count({ where: { clinicId } }),
      adminDb.package.count({ where: { clinicId } }),
      adminDb.membership.count({ where: { clinicId } }),
      adminDb.service.count({ where: { clinicId } }),
      adminDb.provider.count({ where: { clinicId } }),
      adminDb.appointment.count({ where: { clinicId } }),
      adminDb.commissionRule.count({ where: { clinicId } }),
    ])
  return { users, products, packages, memberships, services, providers, appointments, rules }
}

const tokenOf = (link: string | null) => new URL(link!).searchParams.get('token')!

async function setPassword(link: string | null) {
  return api(server.url, '/auth/set-password', {
    body: { token: tokenOf(link), password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
  })
}

describe('demo stocking of a live-signed-up clinic', () => {
  let clinic: Awaited<ReturnType<typeof signUp>>
  let first: StockReport
  const now = demoMorning()

  beforeAll(async () => {
    clinic = await signUp()
  })

  it('refuses an unknown label and a clinic that is still under review', async () => {
    await expect(
      stockDemoClinic(adminDb, {
        label: 'no-such-clinic-label',
        apply: false,
        frontendUrl: FRONTEND,
      })
    ).rejects.toBeInstanceOf(DemoStockError)
    await expect(
      stockDemoClinic(adminDb, { label: clinic.label, apply: true, frontendUrl: FRONTEND, now })
    ).rejects.toThrow(/not live .*PENDING_REVIEW/)
    expect((await clinicCounts(clinic.clinicId)).products).toBe(0)
  })

  it('a dry run reports the plan and writes nothing', async () => {
    await approve(clinic.tenantId)
    const before = await clinicCounts(clinic.clinicId)
    const dry = await stockDemoClinic(adminDb, {
      label: clinic.label,
      apply: false,
      frontendUrl: FRONTEND,
      now,
    })
    expect(dry.applied).toBe(false)
    expect(dry.accounts.map((a) => a.status)).toEqual(['missing', 'missing', 'missing'])
    expect(dry.accounts.every((a) => a.setupLink === null)).toBe(true)
    expect(dry.lines.join('\n')).toMatch(/Products: 0\/20 present, 20 would be added/)
    expect(await clinicCounts(clinic.clinicId)).toEqual(before)
  })

  it('stocks the clinic: accounts, catalogue, hours, commission rule, consented visits', async () => {
    first = await stockDemoClinic(adminDb, {
      label: clinic.label,
      apply: true,
      frontendUrl: FRONTEND,
      now,
    })
    expect(first.applied).toBe(true)
    expect(first.accounts.map((a) => [a.key, a.status])).toEqual([
      ['doctor', 'created'],
      ['frontdesk', 'created'],
      ['patient', 'created'],
    ])
    for (const a of first.accounts) {
      expect(a.email).toBe(accountEmail(a.key, clinic.label))
      expect(a.setupLink).toMatch(new RegExp(`^${FRONTEND}/set-password\\?token=[0-9a-f]{64}$`))
    }

    const c = await clinicCounts(clinic.clinicId)
    expect(c).toMatchObject({
      products: 20,
      packages: 3,
      memberships: 2,
      rules: 1,
      appointments: 2,
    })
    expect(c.services).toBeGreaterThanOrEqual(4)

    const products = await adminDb.product.findMany({
      where: { clinicId: clinic.clinicId },
      select: { name: true, slug: true, fulfillmentClass: true },
    })
    expect(products.every((p) => p.slug)).toBe(true)
    const cls = Object.fromEntries(products.map((p) => [p.name, p.fulfillmentClass]))
    expect(cls).toMatchObject({
      'Magnesium Glycinate': 'SUPPLEMENT',
      'Arnica Gel': 'OTC',
      Tramadol: 'RX_SCHEDULED',
      'Golden Turmeric Blend': 'SUPPLEMENT',
    })

    // Visits A and B: Monday 09:00 and 09:45 at the clinic, both consented.
    expect(first.visits.map((v) => [v.key, v.status])).toEqual([
      ['A', 'created'],
      ['B', 'created'],
    ])
    const visits = await adminDb.appointment.findMany({
      where: { clinicId: clinic.clinicId },
      orderBy: { startTime: 'asc' },
      select: {
        startTime: true,
        aiScribeConsentGrantedAt: true,
        notes: true,
        timezone: true,
        provider: { select: { firstName: true, user: { select: { email: true } } } },
        patient: { select: { email: true } },
      },
    })
    expect(
      visits.map((v) => DateTime.fromJSDate(v.startTime, { zone: TZ }).toFormat('ccc HH:mm'))
    ).toEqual(['Mon 09:00', 'Mon 09:45'])
    for (const v of visits) {
      expect(v.aiScribeConsentGrantedAt).not.toBeNull()
      expect(v.timezone).toBe(TZ)
      expect(v.provider.user?.email).toBe(accountEmail('doctor', clinic.label))
      expect(v.patient.email).toBe(accountEmail('patient', clinic.label))
    }

    const audit = await adminDb.auditLog.count({
      where: { clinicId: clinic.clinicId, action: 'DEMO_CLINIC_STOCKED' },
    })
    expect(audit).toBe(1)
  })

  it('accounts sign in only after their one-time link is redeemed', async () => {
    const doctor = first.accounts.find((a) => a.key === 'doctor')!
    for (const pw of [NEW_PASSWORD, 'pending-setup']) {
      const res = await api(server.url, '/auth/login', {
        body: { email: doctor.email, password: pw },
      })
      expect(res.status).toBe(401)
    }

    for (const a of first.accounts) {
      expect((await setPassword(a.setupLink)).status).toBe(200)
    }
    expect((await setPassword(doctor.setupLink)).status).toBe(400) // used link

    for (const a of first.accounts) {
      const res = await api(server.url, '/auth/login', {
        body: { email: a.email, password: NEW_PASSWORD },
      })
      expect(res.status, a.email).toBe(200)
      expect(res.body.data.user.role).toBe(a.role)
    }
    const patient = first.accounts.find((a) => a.key === 'patient')!
    const onClinicPage = await api(server.url, '/auth/login', {
      body: { email: patient.email, password: NEW_PASSWORD, clinicId: clinic.clinicId },
    })
    expect(onClinicPage.status).toBe(200)
  })

  it('Dr. Chen is bookable around the two visits', async () => {
    const chen = await adminDb.provider.findFirstOrThrow({
      where: { clinicId: clinic.clinicId, firstName: 'Evelyn', lastName: 'Chen' },
      select: { id: true },
    })
    const consult = await adminDb.service.findFirstOrThrow({
      where: { clinicId: clinic.clinicId, name: 'New Patient Consultation' },
      select: { id: true },
    })
    const date = DateTime.fromJSDate(now, { zone: TZ }).toISODate()
    const res = await api(
      server.url,
      `/public/availability?clinicId=${clinic.clinicId}&serviceId=${consult.id}&providerId=${chen.id}&date=${date}`
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const data = res.body.data
    const slots: { startTime: string }[] = Array.isArray(data) ? data : data.slots
    expect(slots.length).toBeGreaterThan(0)
    const local = slots.map((s) => DateTime.fromISO(s.startTime, { zone: TZ }).toFormat('HH:mm'))
    expect(local).not.toContain('09:00')
    expect(local).not.toContain('09:45')
  })

  it('the AI-scribe demo wording routes as the demo script says', async () => {
    const catalog = await adminDb.product.findMany({
      where: { clinicId: clinic.clinicId, isActive: true },
      select: { id: true, name: true, sku: true, aliases: true, fulfillmentClass: true },
    })
    const name = new Map(catalog.map((p) => [p.id, p.name]))
    const lines = mapOrders(
      [
        { name: 'Magnesium glycinate', dose: '400 mg', quantity: 2 },
        { name: 'Arnica gel' },
        { name: 'Mobility Roller Kit' },
        { name: 'Tramadol', dose: '50 mg' },
        { name: 'Turmeric complex' },
        { name: '10-Session Physio Rehab Package' },
      ],
      catalog
    )
    expect(
      lines.map((l) => [l.matchedProductId ? name.get(l.matchedProductId) : null, l.route])
    ).toEqual([
      ['Magnesium Glycinate', 'CART'],
      ['Arnica Gel', 'CART'],
      ['Mobility Roller Kit', 'CART'],
      ['Tramadol', 'EPRESCRIBE'],
      [null, 'MANUAL'],
      [null, 'MANUAL'],
    ])
  })

  it('a second run adds nothing; only accounts without a password get a new link', async () => {
    const before = await clinicCounts(clinic.clinicId)
    const again = await stockDemoClinic(adminDb, {
      label: clinic.label,
      apply: true,
      frontendUrl: FRONTEND,
      now,
    })
    expect(await clinicCounts(clinic.clinicId)).toEqual(before)
    expect(again.accounts.map((a) => a.status)).toEqual(['present', 'present', 'present'])
    // All three set their password above, so no links.
    expect(again.accounts.every((a) => a.setupLink === null)).toBe(true)
    expect(again.visits.map((v) => v.status)).toEqual(['present', 'present'])
    expect(again.lines.join('\n')).toMatch(/Products: 20\/20 present, 0 added/)

    const reissued = await stockDemoClinic(adminDb, {
      label: clinic.label,
      apply: true,
      frontendUrl: FRONTEND,
      now,
      reissue: true,
    })
    expect(reissued.accounts.every((a) => a.setupLink)).toBe(true)
  })

  it('leaves another clinic untouched, and never takes over an account of another clinic', async () => {
    const other = await createClinicFixture('stockother')
    const before = await clinicCounts(other.clinicId)

    const second = await signUp()
    await approve(second.tenantId)
    // An existing account with the label's doctor e-mail, in another clinic.
    await adminDb.user.update({
      where: { id: other.users.provider.id },
      data: { email: accountEmail('doctor', second.label) },
    })
    await expect(
      stockDemoClinic(adminDb, { label: second.label, apply: true, frontendUrl: FRONTEND, now })
    ).rejects.toThrow(/another clinic/)
    expect((await clinicCounts(second.clinicId)).products).toBe(0)
    expect(await clinicCounts(other.clinicId)).toEqual(before)
  })
})
