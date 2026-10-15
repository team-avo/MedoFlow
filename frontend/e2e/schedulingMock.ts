/**
 * Stateful stand-in for the scheduling API (Component 1 e2e), layered over
 * installMockApi's auth contract with page.route() — later routes run first,
 * and anything not handled here falls back to the auth mock. It implements
 * the contract the booking screens depend on: public catalogue +
 * availability, slot holds, booking (with prepay), payment confirm,
 * cancel/reschedule with the service's cancellation policy, waitlist, and
 * staff recurring series create/cancel. Knobs on the returned state let a
 * test make a slot get taken or a hold expire at a precise step.
 *
 * Every request URL and page navigation is recorded so specs can prove no
 * patient detail ever lands in a URL (F1.3). Synthetic data only.
 */
import { expect, type Page, type Route } from '@playwright/test'
import { MOCK_USERS, fail, ok } from './mockApi'

export const CLINIC_ID = 'clinic-e2e'
export const LOCATION = { id: 'loc-1', name: 'Main Street', address: null, timezone: 'UTC' }
export const PATIENT = { ...MOCK_USERS.PATIENT, phone: '555-0142' }

export const SERVICES = {
  prepaid: {
    id: 'svc-prepaid',
    name: 'Initial Assessment',
    duration: 30,
    defaultPrice: '120',
    requirePrepayment: true,
    cancellationWindowHours: 24,
    cancellationFeeType: 'FIXED',
    cancellationFeeValue: '25',
  },
  consult: {
    id: 'svc-consult',
    name: 'Follow-up Consult',
    duration: 30,
    defaultPrice: '80',
    requirePrepayment: false,
    cancellationWindowHours: 24,
    cancellationFeeType: 'FIXED',
    cancellationFeeValue: '25',
  },
} as const
type MockService = (typeof SERVICES)[keyof typeof SERVICES]
const serviceById = (id: string): MockService =>
  Object.values(SERVICES).find((s) => s.id === id) ?? SERVICES.consult

export const PROVIDERS = [
  { id: 'prov-1', firstName: 'Avery', lastName: 'Lane' },
  { id: 'prov-2', firstName: 'Blake', lastName: 'Rowan' },
]

const SLOT_TIMES = ['09:00', '09:30', '10:00', '10:30']

export interface MockAppointment {
  id: string
  clinicId: string
  locationId: string
  providerId: string
  serviceId: string
  patientId: string
  startTime: string
  endTime: string
  status: string
  paymentStatus: string
  priceAtBooking: string
  bookingHoldExpiresAt: string | null
  recurringSeriesId: string | null
  createdAt: string
  updatedAt: string
}

export interface SchedulingState {
  appointments: MockAppointment[]
  holds: Map<string, { providerId: string; startTime: string }>
  waitlist: Record<string, unknown>[]
  /** "METHOD /path" of every scheduling call handled here. */
  calls: string[]
  /** Every URL the page requested or navigated to (PHI-in-URL probe). */
  urls: string[]
  // ── knobs ──
  /** Availability returns no slots on any date. */
  fullyBooked: boolean
  /** Slot starts (ISO) whose hold request finds the slot just taken (409), once each. */
  stealOnHold: Set<string>
  /** The next POST /appointments fails like this once (the slot is then gone). */
  failNextBooking: null | 'expired_hold' | 'conflict'
  /** 0-based weeks the recurring booking skips as conflicts. */
  seriesConflictWeeks: number[]
}

const iso = (d: Date) => d.toISOString()
const LIVE = (a: MockAppointment) => a.status !== 'CANCELLED' && a.status !== 'RESCHEDULED'

export function utcAt(daysFromToday: number, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysFromToday)
  d.setUTCHours(h!, m!, 0, 0)
  return d
}

export async function installSchedulingMock(
  page: Page,
  seed: { appointments?: Partial<MockAppointment>[] } = {}
): Promise<SchedulingState> {
  let seq = 0
  const nextId = (p: string) => `${p}-${++seq}`
  const now = () => new Date().toISOString()

  const makeAppointment = (a: Partial<MockAppointment>): MockAppointment => {
    const service = serviceById(a.serviceId ?? SERVICES.consult.id)
    const start = a.startTime ?? iso(utcAt(3, '09:00'))
    return {
      id: a.id ?? nextId('appt'),
      clinicId: CLINIC_ID,
      locationId: LOCATION.id,
      providerId: a.providerId ?? PROVIDERS[0]!.id,
      serviceId: service.id,
      patientId: a.patientId ?? PATIENT.id,
      startTime: start,
      endTime: a.endTime ?? iso(new Date(new Date(start).getTime() + service.duration * 60_000)),
      status: a.status ?? 'CONFIRMED',
      paymentStatus: a.paymentStatus ?? 'NONE',
      priceAtBooking: a.priceAtBooking ?? service.defaultPrice,
      bookingHoldExpiresAt: a.bookingHoldExpiresAt ?? null,
      recurringSeriesId: a.recurringSeriesId ?? null,
      createdAt: now(),
      updatedAt: now(),
    }
  }

  const state: SchedulingState = {
    appointments: (seed.appointments ?? []).map(makeAppointment),
    holds: new Map(),
    waitlist: [],
    calls: [],
    urls: [],
    fullyBooked: false,
    stealOnHold: new Set(),
    failNextBooking: null,
    seriesConflictWeeks: [],
  }

  page.on('request', (r) => state.urls.push(r.url()))
  page.on('framenavigated', (f) => state.urls.push(f.url()))
  // Payment page imports Stripe.js; the e2e build has no Stripe and needs none.
  await page.route('https://js.stripe.com/**', (r) => r.abort())

  const providerView = (p: (typeof PROVIDERS)[number]) => ({
    ...p,
    email: null,
    disciplines: [{ discipline: { id: 'disc-1', name: 'Physiotherapy' } }],
    providerServices: Object.values(SERVICES).map((s) => ({ serviceId: s.id })),
    locationAssignments: [{ id: `pla-${p.id}`, isPrimary: true, location: LOCATION }],
  })
  const serviceView = (s: MockService) => ({
    ...s,
    discipline: { id: 'disc-1', name: 'Physiotherapy' },
    recommendedProducts: [],
  })
  const detailView = (a: MockAppointment) => {
    const p = PROVIDERS.find((x) => x.id === a.providerId)!
    const s = serviceById(a.serviceId)
    return {
      ...a,
      clinic: { id: CLINIC_ID, name: 'Synthetic Clinic' },
      location: { id: LOCATION.id, name: LOCATION.name },
      provider: { ...p, discipline: { id: 'disc-1', name: 'Physiotherapy' }, user: null },
      service: {
        id: s.id,
        name: s.name,
        duration: s.duration,
        cancellationWindowHours: s.cancellationWindowHours,
        cancellationFeeType: s.cancellationFeeType,
        cancellationFeeValue: s.cancellationFeeValue,
      },
      patient: { id: PATIENT.id, name: PATIENT.name, email: PATIENT.email },
    }
  }
  const takeSlot = (providerId: string, startTime: string) => {
    state.appointments.push(
      makeAppointment({ providerId, startTime, patientId: 'someone-else', status: 'CONFIRMED' })
    )
  }
  const slotsFor = (date: string, providerId: string | null, serviceId: string) => {
    if (state.fullyBooked) return []
    const service = serviceById(serviceId)
    const out = []
    for (const p of PROVIDERS.filter((x) => !providerId || x.id === providerId)) {
      for (const t of SLOT_TIMES) {
        const start = new Date(`${date}T${t}:00.000Z`)
        const end = new Date(start.getTime() + service.duration * 60_000)
        const taken =
          state.appointments.some(
            (a) =>
              LIVE(a) &&
              a.providerId === p.id &&
              new Date(a.startTime) < end &&
              new Date(a.endTime) > start
          ) ||
          [...state.holds.values()].some((h) => h.providerId === p.id && h.startTime === iso(start))
        if (!taken) {
          out.push({
            providerId: p.id,
            locationId: LOCATION.id,
            serviceId: service.id,
            timezone: 'UTC',
            start: iso(start),
            end: iso(end),
          })
        }
      }
    }
    return out
  }
  const lateFee = (a: MockAppointment) => {
    const s = serviceById(a.serviceId)
    const hoursBefore = (new Date(a.startTime).getTime() - Date.now()) / 3_600_000
    const late = hoursBefore <= s.cancellationWindowHours
    return late
      ? {
          lateCancellation: true,
          cancellationFee: {
            type: 'FIXED',
            value: s.cancellationFeeValue,
            amount: s.cancellationFeeValue,
          },
        }
      : { lateCancellation: false }
  }

  await page.route('http://127.0.0.1:3999/**', async (route: Route) => {
    const req = route.request()
    const method = req.method()
    if (method === 'OPTIONS') return route.fallback()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const q = url.searchParams
    const body = (req.postDataJSON?.() ?? {}) as Record<string, unknown>
    const authed = !!req.headers()['authorization']
    const handled = () => state.calls.push(`${method} ${path}`)
    let m: RegExpMatchArray | null

    // ── Public catalogue + availability + holds (no auth) ──
    if (path.startsWith('/public/')) {
      handled()
      if (method === 'GET' && (m = path.match(/^\/public\/clinics\/[^/]+$/))) {
        return ok(route, {
          clinic: { id: CLINIC_ID, name: 'Synthetic Clinic', slug: 'synthetic-clinic' },
        })
      }
      if (method === 'GET' && path.endsWith('/services'))
        return ok(route, { services: Object.values(SERVICES).map(serviceView) })
      if (method === 'GET' && path.endsWith('/providers'))
        return ok(route, { providers: PROVIDERS.map(providerView) })
      if (method === 'GET' && path.endsWith('/locations'))
        return ok(route, { locations: [LOCATION] })
      if (method === 'GET' && path === '/public/availability') {
        return ok(route, {
          slots: slotsFor(q.get('date')!, q.get('providerId'), q.get('serviceId')!),
        })
      }
      if (method === 'POST' && path === '/public/slots/hold') {
        const startTime = String(body.startTime)
        const providerId = String(body.providerId)
        if (state.stealOnHold.delete(startTime)) {
          takeSlot(providerId, startTime)
          return fail(route, 409, 'invalid_slot', 'Selected slot is no longer available.')
        }
        const id = nextId('hold')
        state.holds.set(id, { providerId, startTime })
        return ok(route, {
          hold: {
            id,
            clinicId: CLINIC_ID,
            providerId,
            serviceId: body.serviceId,
            locationId: body.locationId ?? null,
            timezone: 'UTC',
            startTime,
            endTime: body.endTime,
            expiresAt: new Date(Date.now() + 3 * 60_000).toISOString(),
            status: 'ACTIVE',
          },
        })
      }
      if (method === 'DELETE' && (m = path.match(/^\/public\/slots\/hold\/(.+)$/))) {
        return ok(route, { released: state.holds.delete(m[1]!) })
      }
      return ok(route, {})
    }

    if (!authed) return route.fallback()

    // ── Booking ──
    if (method === 'POST' && path === '/appointments') {
      handled()
      const holdId = body.slotHoldId as string | undefined
      if (holdId) state.holds.delete(holdId)
      if (state.failNextBooking) {
        const kind = state.failNextBooking
        state.failNextBooking = null
        takeSlot(String(body.providerId), String(body.startTime))
        return kind === 'expired_hold'
          ? fail(route, 400, 'expired_hold', 'Slot hold expired or invalid.')
          : fail(route, 409, 'conflict', 'This time slot was just booked by someone else.')
      }
      const service = serviceById(String(body.serviceId))
      const prepay = service.requirePrepayment
      const appt = makeAppointment({
        providerId: String(body.providerId),
        serviceId: service.id,
        startTime: String(body.startTime),
        endTime: String(body.endTime),
        status: prepay ? 'PENDING_PAYMENT' : 'CONFIRMED',
        paymentStatus: prepay ? 'PENDING' : 'NONE',
        bookingHoldExpiresAt: prepay ? new Date(Date.now() + 10 * 60_000).toISOString() : null,
      })
      state.appointments.push(appt)
      return ok(route, {
        appointment: appt,
        ...(prepay ? { clientSecret: 'pi_e2e_secret_synthetic' } : {}),
      })
    }

    if (method === 'GET' && path === '/appointments/my') {
      handled()
      return ok(route, {
        appointments: state.appointments.filter((a) => a.patientId === PATIENT.id).map(detailView),
      })
    }
    if (method === 'GET' && path === '/appointments/clinic') {
      handled()
      return ok(route, { appointments: state.appointments.map(detailView) })
    }

    if (method === 'POST' && path === '/appointments/recurring') {
      handled()
      const seriesId = nextId('series')
      const first = new Date(String(body.startTime))
      const duration = new Date(String(body.endTime)).getTime() - first.getTime()
      const appointments: MockAppointment[] = []
      const conflicts: { date: string; reason: string }[] = []
      for (let i = 0; i < Number(body.numberOfSessions ?? 2); i++) {
        const start = new Date(first.getTime() + i * 7 * 86_400_000)
        if (state.seriesConflictWeeks.includes(i)) {
          conflicts.push({
            date: iso(start).slice(0, 10),
            reason: 'Provider has a conflicting appointment in this time slot',
          })
          continue
        }
        const a = makeAppointment({
          providerId: String(body.providerId),
          serviceId: String(body.serviceId),
          patientId: String(body.patientId),
          startTime: iso(start),
          endTime: iso(new Date(start.getTime() + duration)),
          recurringSeriesId: seriesId,
        })
        state.appointments.push(a)
        appointments.push(a)
      }
      return ok(route, { appointments, conflicts })
    }

    if (method === 'POST' && (m = path.match(/^\/appointments\/recurring\/([^/]+)\/cancel$/))) {
      handled()
      const cancelled = state.appointments.filter(
        (a) =>
          a.recurringSeriesId === m![1] && LIVE(a) && new Date(a.startTime).getTime() > Date.now()
      )
      for (const a of cancelled) a.status = 'CANCELLED'
      return ok(route, { seriesId: m[1], cancelledAppointmentIds: cancelled.map((a) => a.id) })
    }

    if ((m = path.match(/^\/appointments\/([^/]+)(\/cancel|\/reschedule)?$/))) {
      const appt = state.appointments.find((a) => a.id === m![1])
      if (!appt) return fail(route, 404, 'not_found', 'Appointment not found')
      handled()
      if (method === 'GET' && !m[2]) return ok(route, { appointment: detailView(appt) })
      if (method === 'POST' && m[2] === '/cancel') {
        appt.status = 'CANCELLED'
        return ok(route, { appointment: appt, ...lateFee(appt) })
      }
      if (method === 'POST' && m[2] === '/reschedule') {
        const holdId = body.slotHoldId as string | undefined
        if (holdId) state.holds.delete(holdId)
        if (state.failNextBooking) {
          state.failNextBooking = null
          takeSlot(appt.providerId, String(body.newStartTime))
          return fail(route, 409, 'conflict', 'This time slot was just booked by someone else.')
        }
        const fresh = makeAppointment({
          ...appt,
          id: undefined,
          startTime: String(body.newStartTime),
          endTime: String(body.newEndTime),
          status: 'CONFIRMED',
        })
        appt.status = 'RESCHEDULED'
        state.appointments.push(fresh)
        return ok(route, { oldAppointment: appt, newAppointment: fresh })
      }
    }

    // ── Prepay ──
    if ((m = path.match(/^\/payments\/([^/]+)\/(intent|confirm)$/))) {
      handled()
      const appt = state.appointments.find((a) => a.id === m![1])
      if (!appt) return fail(route, 404, 'not_found', 'Appointment not found')
      if (m[2] === 'intent') return ok(route, { payment: null, clientSecret: null, reused: false })
      appt.status = 'CONFIRMED'
      appt.paymentStatus = 'PAID'
      appt.bookingHoldExpiresAt = null
      return ok(route, { payment: { id: 'pay-1', status: 'PAID', amount: appt.priceAtBooking } })
    }

    // ── Waitlist + staff lookups ──
    if (method === 'POST' && path === '/waitlist') {
      handled()
      const entry = { id: nextId('wl'), ...body, patientId: PATIENT.id, status: 'WAITING' }
      state.waitlist.push(entry)
      return ok(route, { entry })
    }
    if (method === 'GET' && path === '/patients') {
      handled()
      return ok(route, {
        patients: [{ id: PATIENT.id, name: PATIENT.name, email: PATIENT.email }],
      })
    }

    // ── Read-only panels on the appointment page ──
    if (path === '/patients/entitlements')
      return ok(route, { entitlements: { packages: [], memberships: [] } })
    if (path === '/prescriptions/my') return ok(route, { prescriptions: [] })
    if (path.startsWith('/forms/patient/')) return ok(route, { responses: [] })
    if (path.startsWith('/consultations/appointment/')) return ok(route, { session: null })
    if (path.startsWith('/visits/appointment/'))
      return ok(route, { visitRecord: null, patientSummary: null })
    if (path.startsWith('/files/patient/')) return ok(route, { files: [] })

    return route.fallback()
  })

  return state
}

/** F1.3: no URL the browser requested or navigated to carries a patient detail. */
export function expectNoPhiInUrls(state: SchedulingState) {
  const probes = [
    PATIENT.name,
    ...PATIENT.name.split(' '),
    PATIENT.email,
    PATIENT.email.split('@')[0]!,
    PATIENT.phone,
    PATIENT.phone.replace(/\D/g, ''),
  ]
  const variants = probes.flatMap((p) => [p, encodeURIComponent(p), p.replace(/ /g, '+')])
  const decode = (u: string) => {
    try {
      return decodeURIComponent(u)
    } catch {
      return u
    }
  }
  const leaks = state.urls.filter((u) =>
    variants.some((v) => decode(u).toLowerCase().includes(v.toLowerCase()))
  )
  expect(state.urls.length).toBeGreaterThan(0)
  expect(leaks).toEqual([])
}
