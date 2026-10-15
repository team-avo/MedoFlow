/**
 * B0.5.3 integration suites:
 *  - booking race: two concurrent requests for one slot → exactly one booking, the other 409
 *  - invoice state machine: draft → finalized (unpaid) → partially paid → paid → partially/fully refunded
 *  - webhook idempotency: the same Stripe event delivered twice has one effect;
 *    with STRIPE_WEBHOOK_SECRET set, unsigned/forged events are rejected and a
 *    correctly signed raw body is accepted (regression test for the raw-body bug)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Stripe from 'stripe'
import { Prisma } from '@prisma/client'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, slot, type ClinicFixture } from './fixtures'

let server: TestServer
let C: ClinicFixture
let frontDesk: string
let patient: string

beforeAll(async () => {
  server = await startServer()
  C = await createClinicFixture('money')
  frontDesk = (await login(server.url, C.users.frontDesk.email)).accessToken
  patient = (await login(server.url, C.users.patient.email)).accessToken
})
afterAll(() => server.close())

describe('booking race (B1.4 / B0.5.3)', () => {
  it('two concurrent bookings of one slot → exactly one succeeds, the other gets 409', async () => {
    const s = slot(10, 14)
    const book = (token: string) =>
      api(server.url, '/appointments', {
        token,
        body: {
          providerId: C.providerId,
          serviceId: C.serviceId,
          locationId: C.locationId,
          patientId: C.users.patient.id,
          ...s,
        },
      })
    const results = await Promise.all([book(frontDesk), book(frontDesk)])
    const codes = results.map((r) => r.status).sort()
    expect(codes, JSON.stringify(results.map((r) => r.body))).toEqual([201, 409])

    const count = await adminDb.appointment.count({
      where: {
        providerId: C.providerId,
        startTime: new Date(s.startTime),
        status: { not: 'CANCELLED' },
      },
    })
    expect(count).toBe(1)
  })

  it('a patient booking for themselves at their clinic works (no false positive)', async () => {
    const res = await api(server.url, '/appointments', {
      token: patient,
      body: {
        providerId: C.providerId,
        serviceId: C.serviceId,
        locationId: C.locationId,
        ...slot(11, 15),
      },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
  })
})

describe('invoice state machine (B0.5.3)', () => {
  let invoiceId = ''
  const financial = async () => {
    const res = await api(server.url, `/invoices/${invoiceId}`, { token: frontDesk })
    expect(res.status).toBe(200)
    return res.body.data.invoice as {
      status: string
      financialStatus: string
      outstandingAmount: string | number
    }
  }

  it('draft: created, itemised, but not payable', async () => {
    const created = await api(server.url, '/invoices', {
      token: frontDesk,
      body: { patientId: C.users.patient.id },
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    invoiceId = created.body.data.invoice.id
    const item = await api(server.url, `/invoices/${invoiceId}/items`, {
      token: frontDesk,
      body: { serviceId: C.serviceId, quantity: 1 },
    })
    expect(item.status, JSON.stringify(item.body)).toBe(201)
    expect((await financial()).financialStatus).toBe('DRAFT')

    const early = await api(server.url, `/invoices/${invoiceId}/payments/manual`, {
      token: frontDesk,
      body: { amount: 10, paymentMethod: 'CASH' },
    })
    expect(early.status).toBe(400)
    expect(early.body.code).toBe('invalid_state')
  })

  it('minimum necessary (F0.3.4): the invoice carries only id/name/email of the patient — never credentials', async () => {
    const res = await api(server.url, `/invoices/${invoiceId}`, { token: frontDesk })
    expect(res.status).toBe(200)
    expect(Object.keys(res.body.data.invoice.patient).sort()).toEqual(['email', 'id', 'name'])
    const raw = JSON.stringify(res.body)
    for (const secret of ['password', 'mfaSecret', 'mfaRecoveryCodes', 'mfaPendingSecret']) {
      expect(raw).not.toContain(secret)
    }
  })

  it('finalized → unpaid → partially paid → paid; overpayment is refused', async () => {
    expect(
      (
        await api(server.url, `/invoices/${invoiceId}/finalize`, {
          method: 'PUT',
          token: frontDesk,
        })
      ).status
    ).toBe(200)
    let inv = await financial()
    expect(inv.status).toBe('FINALIZED')
    expect(inv.financialStatus).toBe('UNPAID')
    const total = Number(inv.outstandingAmount)
    expect(total).toBeGreaterThan(0)

    const pay = (amount: number) =>
      api(server.url, `/invoices/${invoiceId}/payments/manual`, {
        token: frontDesk,
        body: { amount, paymentMethod: 'CASH' },
      })

    expect((await pay(40)).status).toBe(200)
    inv = await financial()
    expect(inv.financialStatus).toBe('PARTIALLY_PAID')
    expect(Number(inv.outstandingAmount)).toBeCloseTo(total - 40, 2)

    const over = await pay(total)
    expect(over.status).toBe(400)
    expect(over.body.code).toBe('overpayment')

    expect((await pay(total - 40)).status).toBe(200)
    inv = await financial()
    expect(inv.financialStatus).toBe('PAID')
    expect(inv.status).toBe('PAID')
  })

  it('refunds move the invoice to partially refunded, then refunded', async () => {
    const paid = await adminDb.payment.findMany({
      where: { invoiceId, status: 'PAID' },
      orderBy: { createdAt: 'asc' },
    })
    const refund = (of: (typeof paid)[number], amount: number) =>
      adminDb.payment.create({
        data: {
          clinicId: C.clinicId,
          invoiceId,
          patientId: C.users.patient.id,
          amount: new Prisma.Decimal(-amount),
          status: 'REFUNDED',
          refundForPaymentId: of.id,
          paymentChannel: 'MANUAL',
        },
      })
    await refund(paid[0]!, 40)
    expect((await financial()).financialStatus).toBe('PARTIALLY_REFUNDED')
    await refund(paid[1]!, Number(paid[1]!.amount))
    expect((await financial()).financialStatus).toBe('REFUNDED')
  })
})

describe('Stripe webhook idempotency and signature (B0.5.3, B4)', () => {
  const event = (id: string, paymentIntentId: string, appointmentId: string) => ({
    id,
    object: 'event',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: paymentIntentId,
        object: 'payment_intent',
        amount: 10000,
        client_secret: null,
        metadata: { type: 'APPOINTMENT', appointmentId },
      },
    },
  })

  it('replaying the same event id is a no-op: one PAID payment, one processed-event row', async () => {
    const appt = await adminDb.appointment.create({
      data: {
        clinicId: C.clinicId,
        providerId: C.providerId,
        serviceId: C.serviceId,
        patientId: C.users.patient.id,
        locationId: C.locationId,
        startTime: new Date(Date.now() + 20 * 86_400_000),
        endTime: new Date(Date.now() + 20 * 86_400_000 + 1_800_000),
        priceAtBooking: new Prisma.Decimal(100),
        status: 'PENDING_PAYMENT',
        paymentStatus: 'PENDING',
      },
    })
    await adminDb.payment.create({
      data: {
        clinicId: C.clinicId,
        appointmentId: appt.id,
        patientId: C.users.patient.id,
        amount: new Prisma.Decimal(100),
        status: 'PENDING',
        stripePaymentIntentId: `pi_test_${appt.id}`,
      },
    })
    const evt = event(`evt_test_${appt.id}`, `pi_test_${appt.id}`, appt.id)

    const first = await api(server.url, '/webhooks/stripe', { body: evt })
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    const second = await api(server.url, '/webhooks/stripe', { body: evt })
    expect(second.status).toBe(200)
    expect(second.body.duplicate).toBe(true)

    expect(await adminDb.processedStripeEvent.count({ where: { id: evt.id } })).toBe(1)
    const payments = await adminDb.payment.findMany({ where: { appointmentId: appt.id } })
    expect(payments.filter((p) => p.status === 'PAID')).toHaveLength(1)
    expect(payments).toHaveLength(1)
  })

  it('with STRIPE_WEBHOOK_SECRET set: unsigned → 400, forged → 400, correctly signed raw body → 200', async () => {
    const secret = 'whsec_integration_test_secret'
    process.env.STRIPE_WEBHOOK_SECRET = secret
    try {
      const evt = event(`evt_sig_${Date.now()}`, 'pi_unknown', 'no-such-appointment')
      const payload = JSON.stringify(evt)

      expect((await api(server.url, '/webhooks/stripe', { body: payload })).status).toBe(400)
      expect(
        (
          await api(server.url, '/webhooks/stripe', {
            body: payload,
            headers: { 'stripe-signature': 't=1,v1=deadbeef' },
          })
        ).status
      ).toBe(400)

      const header = Stripe.webhooks.generateTestHeaderString({ payload, secret })
      const ok = await api(server.url, '/webhooks/stripe', {
        body: payload,
        headers: { 'stripe-signature': header },
      })
      expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET
    }
  })
})
