/**
 * CTO-23: Khush's test path. A brand-new clinic with NO website signs up,
 * finishes the application, lands on the dashboard, and then (no Site ever
 * published):
 *   a. the owner creates an appointment for a new walk-in patient (CTO-24),
 *   b. starts the visit and runs AI Scribe through to "Approve & send",
 *   c. adds a product to the Storefront and adjusts its stock,
 *   d. the patient gets a MedoFlow checkout link (CTO-32), opens it and pays.
 * Nothing returns an error, a redirect or a block because there is no
 * website; the public gate is approval (liveClinicWhere), never the site.
 */
import crypto from 'crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { adminDb, api, login, startServer, type TestServer } from './helpers'

let server: TestServer
const savedMode = process.env.CLINIC_REVIEW_MODE

beforeAll(async () => {
  process.env.CLINIC_REVIEW_MODE = 'auto' // the hosted demo's setting
  server = await startServer()
})
afterEach(() => undefined)
afterAll(async () => {
  if (savedMode === undefined) delete process.env.CLINIC_REVIEW_MODE
  else process.env.CLINIC_REVIEW_MODE = savedMode
  await server.close()
})

const PASSWORD = 'Synthetic-Fresh-Clinic-2026!'
const NPI = '1234567893'

describe('a fresh clinic with no website', () => {
  it('signs up, onboards, books a walk-in, scribes, sells and gets paid', async () => {
    const sub = `fresh${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`
    const clinicName = `Fresh Longevity ${sub}`
    const signup = await api(server.url, '/tenants/signup', {
      body: {
        clinicName,
        clinicEmail: `clinic.${sub}@example.test`,
        subdomain: sub,
        ownerName: 'Khush Owner',
        ownerEmail: `owner.${sub}@example.test`,
        password: PASSWORD,
        plan: 'FREE',
      },
    })
    expect(signup.status, JSON.stringify(signup.body)).toBe(201)
    const clinicId = signup.body.data.clinicId as string
    const owner = (await login(server.url, `owner.${sub}@example.test`, PASSWORD)).accessToken
    const call = (path: string, opts: { method?: string; body?: unknown; token?: string } = {}) =>
      api(server.url, path, { token: owner, ...opts })

    // ── The application: practice → practitioners (owner = doctor) → agreement ──
    expect(
      (
        await call('/onboarding/application/practice', {
          method: 'PUT',
          body: {
            legalName: 'Fresh Longevity LLC',
            practiceType: 'LONGEVITY_MEDICAL',
            locationCount: 1,
            addressLine1: '1 Fresh Street',
            city: 'Austin',
            state: 'TX',
            postalCode: '73301',
            timezone: 'America/Chicago',
            primaryContactName: 'Khush Owner',
            primaryContactEmail: `owner.${sub}@example.test`,
            mailingSameAsPrimary: true,
            noNpi: false,
            groupNpi: NPI,
            federalTaxId: '12-3456789',
            estimatedSeats: 1,
          },
        })
      ).status
    ).toBe(200)
    expect(
      (
        await call('/onboarding/application/practitioners', {
          method: 'PUT',
          body: {
            practitioners: [
              {
                name: 'Dr Khush Owner',
                email: `owner.${sub}@example.test`,
                npi: NPI,
                title: 'Medical Director',
                isOwner: true,
                isSelf: true,
                seesPatients: true,
              },
            ],
          },
        })
      ).status
    ).toBe(200)
    const signed = await call('/onboarding/agreement', {
      body: {
        acknowledgements: {
          baa: true,
          hipaa: true,
          dataResidency: true,
          refundPolicy: true,
          authorizedSignatory: true,
        },
        communications: true,
        signerName: 'Khush Owner',
        signerTitle: 'Medical Director',
        signature: 'Khush Owner',
        confirmClinicName: clinicName,
      },
    })
    expect(signed.status, JSON.stringify(signed.body)).toBe(200)
    expect(signed.body.data.verificationStatus).toBe('APPROVED')

    // Straight to the dashboard: onboarding is done; the website is optional.
    const me = await call('/auth/me')
    expect(me.body.data.user.clinic.tenant.onboardingCompletedAt).not.toBeNull()
    expect(me.body.data.user.provider).toMatchObject({ isActive: true })
    const status = await call('/onboarding/status')
    expect(status.body.data.checklist.website).toBe(false)

    // ── c. Storefront without a website: a product and its stock ──
    const product = await call('/products', {
      body: { name: 'Magnesium Glycinate', price: 24, fulfillmentClass: 'SUPPLEMENT' },
    })
    expect(product.status, JSON.stringify(product.body)).toBe(201)
    const productId = product.body.data.product.id as string
    const stock = await call(`/inventory/${productId}/adjust`, {
      method: 'PUT',
      body: { quantityInStock: 10 },
    })
    expect(stock.status, JSON.stringify(stock.body)).toBe(200)
    // A bad count is refused before it reaches the database.
    for (const quantityInStock of [-1, 2.5, 'ten'])
      expect(
        (
          await call(`/inventory/${productId}/adjust`, {
            method: 'PUT',
            body: { quantityInStock },
          })
        ).status
      ).toBe(400)

    // A service to book (a solo practice's one provider offers it at once).
    const discipline = await call('/disciplines', { body: { name: 'Longevity' } })
    const service = await call('/services', {
      body: {
        disciplineId: discipline.body.data.discipline.id,
        name: 'Longevity consult',
        duration: 30,
        defaultPrice: 0,
      },
    })
    expect(service.status, JSON.stringify(service.body)).toBe(201)
    const serviceId = service.body.data.service.id as string
    const providerId = me.body.data.user.provider.id as string

    // ── a. A walk-in patient, booked now by the owner ──
    const patientEmail = `walkin.${sub}@example.test`
    const patient = await call('/patients', {
      body: { name: 'Walk In Patient', email: patientEmail },
    })
    expect(patient.status, JSON.stringify(patient.body)).toBe(201)
    const patientId = patient.body.data.patient.id as string
    const start = new Date(Date.now() + 2 * 60_000)
    const appt = await call('/appointments', {
      body: {
        providerId,
        serviceId,
        patientId,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
        bookingSource: 'WALK_IN',
      },
    })
    expect(appt.status, JSON.stringify(appt.body)).toBe(201)
    const appointmentId = appt.body.data.appointment.id as string

    // ── b. The owner-doctor runs AI Scribe to "Approve & send" ──
    const visit = await call('/visits', { body: { appointmentId } })
    expect(visit.status, JSON.stringify(visit.body)).toBe(201)
    const visitRecordId = (visit.body.data.visitRecord ?? visit.body.data.visit).id as string
    const scribe = await call('/ai-scribe/session/start', { body: { visitRecordId } })
    expect(scribe.status, JSON.stringify(scribe.body)).toBe(201)
    const sessionId = scribe.body.data.session.id as string
    expect(
      (await call(`/ai-scribe/session/${sessionId}/simulate`, { method: 'POST' })).status
    ).toBe(200)
    const proposal = (await call(`/rx-cart/sessions/${sessionId}/proposal`)).body.data.proposal
    const mag = proposal.lines.find(
      (l: { matchedProductId: string | null }) => l.matchedProductId === productId
    )
    expect(mag).toBeTruthy()
    const approved = await call(`/ai-scribe/session/${sessionId}/approve`, {
      body: {
        rxConfirmation: { proposalId: proposal.id, confirmedLineIds: [mag.id], acknowledged: true },
      },
    })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    const rx = approved.body.data.session.rxCart
    expect(rx.cartItemIds).toHaveLength(1)

    // ── d. The patient's MedoFlow checkout link (no website) ──
    expect(rx.checkoutLink.kind).toBe('medoflow')
    const token = new URL(rx.checkoutLink.url).searchParams.get('t')!
    const invite = new URL(patient.body.data.inviteLink).searchParams.get('token')!
    expect(
      (
        await api(server.url, '/auth/set-password', {
          body: { token: invite, password: PASSWORD, confirmPassword: PASSWORD },
        })
      ).status
    ).toBe(200)
    const patientToken = (await login(server.url, patientEmail, PASSWORD)).accessToken
    const opened = await api(server.url, '/checkout-links/open', {
      token: patientToken,
      body: { token },
    })
    expect(opened.status, JSON.stringify(opened.body)).toBe(200)
    expect(opened.body.data.clinicId).toBe(clinicId)
    const cart = await api(server.url, '/carts', { token: patientToken })
    const item = cart.body.data.cart.items[0]
    expect(
      (
        await api(server.url, `/carts/items/${item.id}/decision`, {
          method: 'PATCH',
          token: patientToken,
          body: { decision: 'ACCEPTED' },
        })
      ).status
    ).toBe(200)
    const paid = await api(server.url, '/carts/checkout-demo', { token: patientToken, body: {} })
    expect(paid.status, JSON.stringify(paid.body)).toBe(200)
    expect(
      (await adminDb.inventoryItem.findUniqueOrThrow({ where: { productId } })).quantityInStock
    ).toBeLessThan(10)

    // ── Still no website, and patients can book through the hosted pages ──
    expect(await adminDb.site.count({ where: { clinicId, publishedAt: { not: null } } })).toBe(0)
    expect((await api(server.url, `/public/clinics/${sub}`)).status).toBe(200)
    expect((await api(server.url, `/public/clinics/${clinicId}/services`)).status).toBe(200)
  })
})
