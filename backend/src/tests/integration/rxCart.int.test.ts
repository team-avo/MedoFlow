/**
 * Component 5 — Prescription → Cart over HTTP against Postgres (enforce + RLS).
 *
 *  B5.1 scribe orders are mapped to clinic SKUs; unmapped items are surfaced
 *  B5.2 no cart without an explicit, audited provider confirmation
 *  B5.3 "Approve & send" builds a cart with exactly the confirmed items
 *  B5.4 one-click checkout with the card + address on file from booking;
 *       decline and no-card fall back
 *  B5.5 prescription products are routed to e-prescribe, never the cart
 *  B5.6 cart writes are owner-scoped (IDOR) and audited
 *
 * Stripe is replaced in-process (the app runs in this process); nothing
 * leaves the machine.
 */
import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import stripe from '../../config/stripe'
import { adminDb, api, login, startServer, type TestServer } from './helpers'
import { createClinicFixture, type ClinicFixture } from './fixtures'

let server: TestServer
let A: ClinicFixture
let B: ClinicFixture
let aProvider = ''
let aPatient = ''
let bProvider = ''
let bPatient = ''
const products: Record<'mag' | 'arnica' | 'tramadol', string> = {
  mag: '',
  arnica: '',
  tramadol: '',
}

// Stripe ids are unique in the database, which persists between runs.
const run = crypto.randomBytes(4).toString('hex')
const PI_DECLINED = `pi_synthetic_declined_${run}`
const PI_ONE_CLICK = `pi_synthetic_one_click_${run}`

const realCreate = stripe.paymentIntents.create
const realRetrieve = stripe.paymentIntents.retrieve
const setStripe = (key: 'create' | 'retrieve', fn: (...args: any[]) => Promise<unknown>): void => {
  Object.defineProperty(stripe.paymentIntents, key, {
    value: fn,
    configurable: true,
    writable: true,
  })
}

/** A fresh appointment + open visit record for patient A (one note per visit). */
let visits = 0
async function newVisit(): Promise<string> {
  // Distinct past hours for the fixture's provider: never overlapping (B1.1).
  visits += 1
  const start = new Date(Date.now() - (visits * 2 + 24) * 3_600_000)
  start.setUTCMinutes(0, 0, 0)
  const appt = await adminDb.appointment.create({
    data: {
      clinicId: A.clinicId,
      providerId: A.providerId,
      serviceId: A.serviceId,
      patientId: A.users.patient.id,
      locationId: A.locationId,
      startTime: start,
      endTime: new Date(start.getTime() + 30 * 60_000),
      priceAtBooking: new Prisma.Decimal(100),
      status: 'COMPLETED',
    },
  })
  const visit = await adminDb.visitRecord.create({
    data: {
      clinicId: A.clinicId,
      appointmentId: appt.id,
      providerId: A.providerId,
      patientId: A.users.patient.id,
    },
  })
  return visit.id
}

/** Starts a scribe session and simulates it: DRAFT_GENERATED + a proposal. */
async function scribeSession(visitRecordId: string): Promise<string> {
  const started = await api(server.url, '/ai-scribe/session/start', {
    token: aProvider,
    body: { visitRecordId },
  })
  expect(started.status).toBe(201)
  const id = started.body.data.session.id as string
  const sim = await api(server.url, `/ai-scribe/session/${id}/simulate`, {
    token: aProvider,
    method: 'POST',
  })
  expect(sim.status).toBe(200)
  return id
}

interface Line {
  id: string
  rawText: string
  quantity: number
  matchedProductId: string | null
  matchStatus: string
  route: string
  decision: string
}

async function proposalFor(sessionId: string, token = aProvider) {
  const res = await api(server.url, `/rx-cart/sessions/${sessionId}/proposal`, { token })
  expect(res.status).toBe(200)
  return res.body.data.proposal as { id: string; status: string; lines: Line[] } | null
}

const lineFor = (lines: Line[], productId: string | null, text?: string) =>
  lines.find((l) => l.matchedProductId === productId && (!text || l.rawText.includes(text)))!

const auditActions = async (entityId: string) =>
  (await adminDb.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } })).map(
    (r) => r.action
  )

beforeAll(async () => {
  server = await startServer()
  A = await createClinicFixture('rx-a')
  B = await createClinicFixture('rx-b')
  const mk = (clinicId: string, name: string, sku: string, cls: string, price: number) =>
    adminDb.product.create({
      data: {
        clinicId,
        name,
        sku,
        price: new Prisma.Decimal(price),
        fulfillmentClass: cls as never,
        inventoryItem: { create: { clinicId, quantityInStock: 50 } },
      },
    })
  products.mag = (await mk(A.clinicId, 'Magnesium Glycinate', 'MAG-400', 'SUPPLEMENT', 24)).id
  products.arnica = (await mk(A.clinicId, 'Arnica Gel', 'ARN-75', 'OTC', 12.5)).id
  products.tramadol = (await mk(A.clinicId, 'Tramadol', 'TRAM-50', 'RX_SCHEDULED', 9)).id
  await mk(B.clinicId, 'Magnesium Glycinate', 'MAG-400', 'SUPPLEMENT', 20)

  aProvider = (await login(server.url, A.users.provider.email)).accessToken
  aPatient = (await login(server.url, A.users.patient.email)).accessToken
  bProvider = (await login(server.url, B.users.provider.email)).accessToken
  bPatient = (await login(server.url, B.users.patient.email)).accessToken
})

afterAll(async () => {
  setStripe('create', realCreate as never)
  setStripe('retrieve', realRetrieve as never)
  await server.close()
})

describe('B5.1 mapping scribe orders to the clinic catalog', () => {
  it('maps the detected orders to clinic SKUs and surfaces the unmapped one', async () => {
    const sessionId = await scribeSession(await newVisit())
    const proposal = await proposalFor(sessionId)
    expect(proposal?.status).toBe('PENDING')
    const lines = proposal!.lines
    expect(lines).toHaveLength(4) // one line per scribe order — none dropped

    expect(lineFor(lines, products.mag)).toMatchObject({ quantity: 2, route: 'CART' })
    expect(lineFor(lines, products.arnica)).toMatchObject({ quantity: 1, route: 'CART' })
    expect(lineFor(lines, products.tramadol)).toMatchObject({ route: 'EPRESCRIBE' })
    expect(lineFor(lines, null, 'Turmeric')).toMatchObject({
      matchStatus: 'UNMAPPED',
      route: 'MANUAL',
    })

    // Clinic A's products only: clinic B's identical SKU is never matched.
    const bMag = await adminDb.product.findFirstOrThrow({ where: { clinicId: B.clinicId } })
    expect(lines.some((l) => l.matchedProductId === bMag.id)).toBe(false)
  })

  it('stores the order text as ciphertext (PHI at rest)', async () => {
    const sessionId = await scribeSession(await newVisit())
    const proposal = await proposalFor(sessionId)
    const rows = await adminDb.$queryRaw<{ rawText: string }[]>`
      SELECT "rawText" FROM "RxOrderLine" WHERE "proposalId" = ${proposal!.id}`
    expect(rows.length).toBe(4)
    for (const r of rows) expect(r.rawText.startsWith('fle:v1:')).toBe(true)
    expect(rows.some((r) => r.rawText.includes('Magnesium'))).toBe(false)
  })

  it('another clinic cannot read or edit the proposal', async () => {
    const sessionId = await scribeSession(await newVisit())
    const proposal = await proposalFor(sessionId)
    expect(await proposalFor(sessionId, bProvider)).toBeNull()
    const edit = await api(server.url, `/rx-cart/proposals/${proposal!.id}/lines`, {
      token: bProvider,
      method: 'PUT',
      body: { add: [{ productId: products.mag }] },
    })
    expect(edit.status).toBe(404)
    const confirm = await api(server.url, `/rx-cart/proposals/${proposal!.id}/confirm`, {
      token: bProvider,
      body: { confirmedLineIds: [], acknowledged: true },
    })
    expect(confirm.status).toBe(404)
    // Patients never reach the provider endpoints.
    expect(
      (await api(server.url, `/rx-cart/sessions/${sessionId}/proposal`, { token: aPatient })).status
    ).toBe(403)
  })
})

describe('B5.2 / B5.3 clinician confirmation and "Approve & send"', () => {
  let sessionId = ''
  let proposalId = ''
  let lines: Line[] = []

  beforeAll(async () => {
    sessionId = await scribeSession(await newVisit())
    const p = await proposalFor(sessionId)
    proposalId = p!.id
    lines = p!.lines
  })

  const approve = (body: unknown) =>
    api(server.url, `/ai-scribe/session/${sessionId}/approve`, { token: aProvider, body })

  it('refuses a confirmation that is not explicitly acknowledged (400)', async () => {
    const res = await approve({
      rxConfirmation: { proposalId, confirmedLineIds: [lines[0]!.id], acknowledged: false },
    })
    expect(res.status).toBe(400)
  })

  it('refuses to confirm an unmapped item, and the note stays unapproved', async () => {
    const turmeric = lineFor(lines, null, 'Turmeric')
    const res = await approve({
      rxConfirmation: { proposalId, confirmedLineIds: [turmeric.id], acknowledged: true },
    })
    expect(res.status).toBe(422)
    const session = await adminDb.aIScribeSession.findUniqueOrThrow({ where: { id: sessionId } })
    expect(session.status).toBe('DRAFT_GENERATED') // the whole approval rolled back
    expect(await adminDb.cartItem.count({ where: { rxOrderLine: { proposalId } } })).toBe(0)
  })

  it('the provider can re-quantity and add items before sending', async () => {
    const mag = lineFor(lines, products.mag)
    const res = await api(server.url, `/rx-cart/proposals/${proposalId}/lines`, {
      token: aProvider,
      method: 'PUT',
      body: { lines: [{ id: mag.id, quantity: 3 }] },
    })
    expect(res.status).toBe(200)
    expect(lineFor(res.body.data.proposal.lines, products.mag).quantity).toBe(3)
    expect(await auditActions(proposalId)).toContain('RX_PROPOSAL_EDITED')
  })

  it('"Approve & send" builds a cart with exactly the confirmed items and quantities', async () => {
    const mag = lineFor(lines, products.mag)
    const arnica = lineFor(lines, products.arnica)
    const tramadol = lineFor(lines, products.tramadol)
    const res = await approve({
      rxConfirmation: {
        proposalId,
        confirmedLineIds: [mag.id, arnica.id, tramadol.id],
        acknowledged: true,
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.data.session.rxCart.cartItemIds).toHaveLength(2)

    const cart = await api(server.url, '/carts', { token: aPatient })
    const items = (cart.body.data.cart.items as any[]).filter((i) => i.rxOrderLineId)
    expect(items.map((i) => [i.productId, i.quantity, i.patientDecision]).sort()).toEqual(
      [
        [products.arnica, 1, 'PENDING'],
        [products.mag, 3, 'PENDING'],
      ].sort()
    )
    // Provenance: "Prescribed · Dr. X", minimum necessary.
    for (const i of items) {
      expect(i.prescribedBy).toEqual({
        id: A.providerId,
        firstName: 'Pat',
        lastName: expect.any(String),
      })
    }

    // B5.5: the scheduled Rx went to the e-prescribe queue, not the cart.
    const rx = await adminDb.prescription.findFirstOrThrow({
      where: { rxOrderLineId: tramadol.id },
    })
    expect(rx.status).toBe('PENDING_EPRESCRIBE')
    expect(items.some((i) => i.productId === products.tramadol)).toBe(false)

    // Not confirmed → not in the cart.
    const turmeric = await adminDb.rxOrderLine.findFirstOrThrow({
      where: { id: lineFor(lines, null, 'Turmeric').id },
    })
    expect(turmeric.decision).toBe('REMOVED')

    // Audited, ids and counts only.
    const actions = await auditActions(proposalId)
    expect(actions).toEqual(expect.arrayContaining(['RX_CART_CONFIRMED', 'RX_CART_BUILT']))
    const built = await adminDb.auditLog.findFirstOrThrow({
      where: { entityId: proposalId, action: 'RX_CART_BUILT' },
    })
    expect(JSON.stringify(built.newValue)).not.toMatch(/Magnesium|Arnica|Tramadol/)
  })

  it('a sent proposal cannot be confirmed again', async () => {
    const res = await api(server.url, `/rx-cart/proposals/${proposalId}/confirm`, {
      token: aProvider,
      body: { confirmedLineIds: [], acknowledged: true },
    })
    expect(res.status).toBe(409)
  })
})

describe('B5.2 approving without confirmation never builds a cart', () => {
  it('approve with no rxConfirmation: note final, proposal pending, no cart items', async () => {
    const sessionId = await scribeSession(await newVisit())
    const proposal = await proposalFor(sessionId)
    const res = await api(server.url, `/ai-scribe/session/${sessionId}/approve`, {
      token: aProvider,
      method: 'POST',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.session.rxCart).toBeNull()
    const after = await adminDb.rxOrderProposal.findUniqueOrThrow({ where: { id: proposal!.id } })
    expect(after.status).toBe('PENDING')
    expect(
      await adminDb.cartItem.count({ where: { rxOrderLine: { proposalId: proposal!.id } } })
    ).toBe(0)
    expect(await auditActions(proposal!.id)).not.toContain('RX_CART_BUILT')

    // Sending afterwards still needs the explicit confirmation.
    const unconfirmed = await api(server.url, `/rx-cart/proposals/${proposal!.id}/confirm`, {
      token: aProvider,
      body: { confirmedLineIds: [] },
    })
    expect(unconfirmed.status).toBe(400)
    const arnica = lineFor(proposal!.lines, products.arnica)
    const sent = await api(server.url, `/rx-cart/proposals/${proposal!.id}/confirm`, {
      token: aProvider,
      body: { confirmedLineIds: [arnica.id], acknowledged: true },
    })
    expect(sent.status).toBe(200)
    expect(sent.body.data.rxCart.cartItemIds).toHaveLength(1)
    expect(await auditActions(proposal!.id)).toEqual(
      expect.arrayContaining(['RX_CART_CONFIRMED', 'RX_CART_BUILT'])
    )
  })
})

describe('B5.5 / B5.6 cart guards', () => {
  it('a prescription product cannot be added to the cart or seen on the storefront', async () => {
    const add = await api(server.url, '/carts/items', {
      token: aPatient,
      body: { itemType: 'PRODUCT', itemId: products.tramadol, quantity: 1 },
    })
    expect(add.status).toBe(422)
    expect(add.body.code ?? add.body.error?.code ?? JSON.stringify(add.body)).toMatch(
      /RX_ROUTE_EPRESCRIBE/
    )
    const store = await api(server.url, `/public/clinics/${A.clinicId}/products`)
    const ids = (store.body.data.products as { id: string }[]).map((p) => p.id)
    expect(ids).toContain(products.mag)
    expect(ids).not.toContain(products.tramadol)
  })

  it("one patient cannot change or decide on another patient's cart item (IDOR)", async () => {
    const cart = await api(server.url, '/carts', { token: aPatient })
    const item = (cart.body.data.cart.items as any[]).find((i) => i.rxOrderLineId)
    const update = await api(server.url, `/carts/items/${item.id}`, {
      token: bPatient,
      method: 'PUT',
      body: { quantity: 40 },
    })
    expect(update.status).toBe(404)
    const remove = await api(server.url, `/carts/items/${item.id}`, {
      token: bPatient,
      method: 'DELETE',
    })
    expect(remove.status).toBe(404)
    const decide = await api(server.url, `/carts/items/${item.id}/decision`, {
      token: bPatient,
      method: 'PATCH',
      body: { decision: 'ACCEPTED' },
    })
    expect(decide.status).toBe(404)
    const still = await adminDb.cartItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(still.quantity).toBe(item.quantity)
    expect(still.patientDecision).toBe('PENDING')
  })

  it('cart writes are audited', async () => {
    const add = await api(server.url, '/carts/items', {
      token: aPatient,
      body: { itemType: 'PRODUCT', itemId: products.mag, quantity: 1 },
    })
    expect(add.status).toBe(201)
    const id = add.body.data.item.id as string
    const upd = await api(server.url, `/carts/items/${id}`, {
      token: aPatient,
      method: 'PUT',
      body: { quantity: 2 },
    })
    expect(upd.status).toBe(200)
    const del = await api(server.url, `/carts/items/${id}`, { token: aPatient, method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(await auditActions(id)).toEqual([
      'CART_ITEM_ADDED',
      'CART_ITEM_UPDATED',
      'CART_ITEM_REMOVED',
    ])
  })

  it('checkout waits for the patient to accept or decline prescribed items', async () => {
    const res = await api(server.url, '/carts/one-click-checkout', {
      token: aPatient,
      method: 'POST',
    })
    // No card yet → the no-card answer comes first; the regular checkout shows the decision rule.
    expect(res.status).toBe(409)
    const regular = await api(server.url, '/carts/checkout', { token: aPatient, method: 'POST' })
    expect(regular.status).toBe(409)
    expect(JSON.stringify(regular.body)).toMatch(/RX_DECISION_REQUIRED|Accept or decline/)
  })
})

describe('B5.4 card + address on file from booking, one-click checkout', () => {
  const card = {
    id: 'pm_synthetic_visa',
    type: 'card',
    card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
  }

  it('a patient without a card on file gets the fallback answer (409 NO_CARD_ON_FILE)', async () => {
    const onFile = await api(server.url, '/carts/one-click', { token: aPatient })
    expect(onFile.status).toBe(200)
    expect(onFile.body.data.onFile).toMatchObject({ eligible: false, reason: 'NO_CARD_ON_FILE' })
    const res = await api(server.url, '/carts/one-click-checkout', {
      token: aPatient,
      method: 'POST',
    })
    expect(res.status).toBe(409)
    expect(JSON.stringify(res.body)).toMatch(/NO_CARD_ON_FILE|No card on file/)
  })

  it('paying for a booking saves the card; the booking page saves the address (encrypted)', async () => {
    const start = new Date(Date.now() + 5 * 86_400_000)
    const appt = await adminDb.appointment.create({
      data: {
        clinicId: A.clinicId,
        providerId: A.providerId,
        serviceId: A.serviceId,
        patientId: A.users.patient.id,
        locationId: A.locationId,
        startTime: start,
        endTime: new Date(start.getTime() + 30 * 60_000),
        priceAtBooking: new Prisma.Decimal(100),
        status: 'PENDING_PAYMENT',
      },
    })
    await adminDb.payment.create({
      data: {
        clinicId: A.clinicId,
        appointmentId: appt.id,
        patientId: A.users.patient.id,
        amount: new Prisma.Decimal(100),
        status: 'PENDING',
        stripePaymentIntentId: `pi_booking_${appt.id}`,
        paymentChannel: 'STRIPE',
        paymentMethod: 'CARD',
      },
    })
    setStripe('retrieve', async (id: string) => ({
      id,
      status: 'succeeded',
      setup_future_usage: 'off_session',
      customer: 'cus_synthetic_a',
      metadata: { clinicId: A.clinicId, patientId: A.users.patient.id, type: 'APPOINTMENT' },
      payment_method: card,
    }))
    const confirm = await api(server.url, `/payments/${appt.id}/confirm`, {
      token: aPatient,
      method: 'POST',
    })
    expect(confirm.status).toBe(200)

    const address = await api(server.url, '/carts/shipping-address', {
      token: aPatient,
      method: 'PUT',
      body: {
        name: 'Synthetic Patient',
        line1: '100 Example Street',
        city: 'Testville',
        state: 'CA',
        postalCode: '90000',
        country: 'us',
      },
    })
    expect(address.status).toBe(200)

    const onFile = await api(server.url, '/carts/one-click', { token: aPatient })
    expect(onFile.body.data.onFile).toMatchObject({
      eligible: true,
      card: { brand: 'visa', last4: '4242' },
      shippingAddress: { line1: '100 Example Street', country: 'US' },
    })

    const [row] = await adminDb.$queryRaw<{ shippingLine1: string; cardLast4: string }[]>`
      SELECT "shippingLine1", "cardLast4" FROM "PatientCommerceProfile"
      WHERE "patientId" = ${A.users.patient.id}`
    expect(row!.shippingLine1.startsWith('fle:v1:')).toBe(true)
    expect(row!.cardLast4).toBe('4242')
    const profile = await adminDb.patientCommerceProfile.findFirstOrThrow({
      where: { patientId: A.users.patient.id },
    })
    expect(await auditActions(profile.id)).toEqual(
      expect.arrayContaining(['CARD_ON_FILE_SAVED', 'SHIPPING_ADDRESS_SAVED'])
    )
  })

  it('a declined card leaves the cart active and reports CARD_DECLINED (402)', async () => {
    const cart = await api(server.url, '/carts', { token: aPatient })
    const prescribed = (cart.body.data.cart.items as any[]).filter((i) => i.rxOrderLineId)
    // Accept magnesium, decline arnica (only the first build's items).
    for (const i of prescribed) {
      const decision = i.productId === products.mag ? 'ACCEPTED' : 'DECLINED'
      const res = await api(server.url, `/carts/items/${i.id}/decision`, {
        token: aPatient,
        method: 'PATCH',
        body: { decision },
      })
      expect(res.status).toBe(200)
    }
    setStripe('create', async () => {
      throw Object.assign(new Error('Your card was declined.'), {
        type: 'StripeCardError',
        code: 'card_declined',
        payment_intent: { id: PI_DECLINED },
      })
    })
    const res = await api(server.url, '/carts/one-click-checkout', {
      token: aPatient,
      method: 'POST',
    })
    expect(res.status).toBe(402)
    expect(JSON.stringify(res.body)).toMatch(/declined/i)
    const active = await adminDb.cart.findFirst({
      where: { clinicId: A.clinicId, patientId: A.users.patient.id, status: 'ACTIVE' },
    })
    expect(active).not.toBeNull()
    const failed = await adminDb.payment.findFirstOrThrow({
      where: { stripePaymentIntentId: PI_DECLINED },
    })
    expect(failed.status).toBe('FAILED')
  })

  it('a returning patient pays in one action with the card on file', async () => {
    let intentArgs: Record<string, any> = {}
    setStripe('create', async (args: Record<string, any>) => {
      intentArgs = args
      return { id: PI_ONE_CLICK, status: 'succeeded', metadata: args.metadata }
    })
    const cartBefore = await adminDb.cart.findFirstOrThrow({
      where: { clinicId: A.clinicId, patientId: A.users.patient.id, status: 'ACTIVE' },
      include: { items: true },
    })
    const res = await api(server.url, '/carts/one-click-checkout', {
      token: aPatient,
      method: 'POST',
    })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('succeeded')

    // Off-session charge of the saved card — no card details sent from the client.
    expect(intentArgs).toMatchObject({
      customer: 'cus_synthetic_a',
      payment_method: 'pm_synthetic_visa',
      off_session: true,
      confirm: true,
    })

    const invoice = await adminDb.invoice.findUniqueOrThrow({
      where: { id: res.body.data.invoiceId },
      include: { items: true },
    })
    expect(invoice.status).toBe('PAID')
    // Declined items (arnica) are not charged: only the accepted magnesium × 3.
    expect(cartBefore.items.some((i) => i.patientDecision === 'DECLINED')).toBe(true)
    expect(invoice.items.map((i) => [i.productId, i.quantity])).toEqual([[products.mag, 3]])
    // Attributed to the prescribing provider.
    expect(invoice.items[0]!.providerId).toBe(A.providerId)

    const paid = await adminDb.payment.findFirstOrThrow({
      where: { stripePaymentIntentId: PI_ONE_CLICK },
    })
    expect(paid.status).toBe('PAID')
    const closed = await adminDb.cart.findUniqueOrThrow({ where: { id: cartBefore.id } })
    expect(closed.status).toBe('CHECKED_OUT')
    expect(await auditActions(cartBefore.id)).toEqual(
      expect.arrayContaining(['CART_ONE_CLICK_FAILED', 'CART_CHECKOUT'])
    )
  })
})
