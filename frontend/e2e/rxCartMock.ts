/**
 * Stateful stand-in for the Prescription → Cart API (Component 5 e2e),
 * layered over installMockApi's auth contract with page.route() — later
 * routes run first, anything not handled here falls back to the auth mock.
 *
 *  provider: scribe session → detected-products proposal → map / confirm →
 *            "Approve & send" (records exactly what was sent)
 *  patient:  cart with provenance → accept / decline → card + address on
 *            file → one-click checkout (succeed or decline, via a knob)
 *
 * Every URL is recorded so specs can prove no patient detail or product
 * name lands in a URL. Synthetic data only.
 */
import { expect, type Page, type Route } from '@playwright/test'
import { MOCK_USERS, fail, ok } from './mockApi'

export const VISIT_ID = 'visit-e2e-1'
export const SESSION_ID = 'scribe-e2e-1'
export const PROVIDER = { id: 'prov-e2e-1', firstName: 'Avery', lastName: 'Stone' }

const product = (id: string, name: string, price: string, fulfillmentClass: string) => ({
  id,
  name,
  sku: null,
  price,
  fulfillmentClass,
})
export const PRODUCTS = {
  mag: product('p-mag', 'Magnesium Glycinate', '24.00', 'SUPPLEMENT'),
  arnica: product('p-arnica', 'Arnica Gel', '12.50', 'OTC'),
  tramadol: product('p-tram', 'Tramadol', '9.00', 'RX_SCHEDULED'),
  turmeric: product('p-turm', 'Turmeric Curcumin', '18.00', 'SUPPLEMENT'),
}

interface Line {
  id: string
  rawText: string
  quantity: number
  matchedProductId: string | null
  matchStatus: string
  route: string
  decision: string
  matchedProduct: ReturnType<typeof product> | null
}

export interface RxCartState {
  sessionStatus: 'DRAFT_GENERATED' | 'APPROVED'
  proposal: { id: string; status: 'PENDING' | 'CONFIRMED'; lines: Line[] }
  approveBodies: Record<string, unknown>[]
  cart: { id: string; status: string; items: Record<string, unknown>[] }
  onFile: Record<string, unknown>
  /** Knob: how the next one-click checkout answers. */
  oneClick: 'succeed' | 'decline'
  oneClickCalls: number
  calls: string[]
  urls: string[]
}

const line = (
  id: string,
  rawText: string,
  quantity: number,
  p: ReturnType<typeof product> | null,
  route: string
): Line => ({
  id,
  rawText,
  quantity,
  matchedProductId: p?.id ?? null,
  matchStatus: p ? 'MATCHED' : 'UNMAPPED',
  route,
  decision: 'PENDING',
  matchedProduct: p,
})

export const ON_FILE = {
  eligible: true,
  reason: null,
  card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
  shippingAddress: {
    name: MOCK_USERS.PATIENT.name,
    line1: '100 Example Street',
    line2: null,
    city: 'Testville',
    state: 'CA',
    postalCode: '90000',
    country: 'US',
  },
}

const prescribedItem = (id: string, p: ReturnType<typeof product>, quantity: number) => ({
  id,
  cartId: 'cart-e2e-1',
  itemType: 'PRODUCT',
  productId: p.id,
  quantity,
  unitPrice: p.price,
  rxOrderLineId: `line-${id}`,
  patientDecision: 'PENDING',
  prescribedBy: PROVIDER,
  product: p,
})

export async function installRxCartMock(
  page: Page,
  opts: { onFile?: Record<string, unknown> } = {}
): Promise<RxCartState> {
  const state: RxCartState = {
    sessionStatus: 'DRAFT_GENERATED',
    proposal: {
      id: 'proposal-e2e-1',
      status: 'PENDING',
      lines: [
        line('l-mag', 'Magnesium glycinate 400 mg', 2, PRODUCTS.mag, 'CART'),
        line('l-arnica', 'Arnica gel', 1, PRODUCTS.arnica, 'CART'),
        line('l-tram', 'Tramadol 50 mg', 1, PRODUCTS.tramadol, 'EPRESCRIBE'),
        line('l-turmeric', 'Turmeric complex', 1, null, 'MANUAL'),
      ],
    },
    approveBodies: [],
    cart: {
      id: 'cart-e2e-1',
      status: 'ACTIVE',
      items: [prescribedItem('ci-1', PRODUCTS.mag, 2), prescribedItem('ci-2', PRODUCTS.arnica, 1)],
    },
    onFile: opts.onFile ?? ON_FILE,
    oneClick: 'succeed',
    oneClickCalls: 0,
    calls: [],
    urls: [],
  }
  // Stripe.js is never needed: the card on file is charged server-side.
  await page.route('https://js.stripe.com/**', (r) => r.abort())
  page.on('request', (r) => state.urls.push(r.url()))
  page.on('framenavigated', (f) => state.urls.push(f.url()))

  const session = () => ({
    id: SESSION_ID,
    visitRecordId: VISIT_ID,
    providerId: PROVIDER.id,
    clinicId: 'clinic-e2e',
    audioUrl: null,
    transcript: 'Provider: synthetic conversation for the e2e run.',
    timeline: null,
    aiDraft: {
      subjective: 'Synthetic: lower back stiffness.',
      objective: 'Synthetic: restricted lumbar flexion.',
      assessment: 'Synthetic: lumbar strain, improving.',
      plan: 'Synthetic: core exercises, magnesium, arnica gel.',
    },
    patientSummary: state.sessionStatus === 'APPROVED' ? { diagnosis: 'Synthetic' } : null,
    patientSummaryPublished: false,
    status: state.sessionStatus,
    createdAt: '2026-10-17T09:00:00.000Z',
    updatedAt: '2026-10-17T09:00:00.000Z',
    visitRecord: {
      id: VISIT_ID,
      appointmentId: 'appt-e2e-1',
      isFinalized: state.sessionStatus === 'APPROVED',
    },
  })

  await page.route('http://127.0.0.1:3999/**', async (route: Route) => {
    const req = route.request()
    const method = req.method()
    if (method === 'OPTIONS') return route.fallback()
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, '')
    const body = (req.postDataJSON?.() ?? {}) as Record<string, any>
    const key = `${method} ${path}`

    // ── provider ──
    if (key === `GET /ai-scribe/session/visit/${VISIT_ID}`) return ok(route, { session: session() })
    if (key === `PUT /ai-scribe/session/${SESSION_ID}/draft`) {
      state.calls.push(key)
      return ok(route, { session: session() })
    }
    if (key === `POST /ai-scribe/session/${SESSION_ID}/approve`) {
      state.calls.push(key)
      state.approveBodies.push(body)
      state.sessionStatus = 'APPROVED'
      const rx = body.rxConfirmation as { confirmedLineIds: string[] } | undefined
      if (rx) {
        state.proposal.status = 'CONFIRMED'
        for (const l of state.proposal.lines) {
          l.decision = rx.confirmedLineIds.includes(l.id) ? 'CONFIRMED' : 'REMOVED'
        }
      }
      const cartLines = state.proposal.lines.filter(
        (l) => l.decision === 'CONFIRMED' && l.route === 'CART'
      )
      return ok(route, {
        session: {
          ...session(),
          rxCart: rx
            ? {
                cartId: 'cart-e2e-1',
                cartItemIds: cartLines.map((l) => `ci-${l.id}`),
                prescriptionIds: [],
              }
            : null,
        },
      })
    }
    if (key === `GET /rx-cart/sessions/${SESSION_ID}/proposal`) {
      return ok(route, { proposal: state.proposal })
    }
    if (key === 'GET /rx-cart/catalog') return ok(route, { products: Object.values(PRODUCTS) })
    if (key === `PUT /rx-cart/proposals/${state.proposal.id}/lines`) {
      state.calls.push(key)
      for (const change of (body.lines ?? []) as { id: string; productId?: string }[]) {
        const l = state.proposal.lines.find((x) => x.id === change.id)
        const p = Object.values(PRODUCTS).find((x) => x.id === change.productId)
        if (l && p) {
          l.matchedProduct = p
          l.matchedProductId = p.id
          l.matchStatus = 'MATCHED'
          l.route = p.fulfillmentClass.startsWith('RX') ? 'EPRESCRIBE' : 'CART'
        }
      }
      return ok(route, { proposal: state.proposal })
    }

    // ── patient ──
    if (key === 'GET /carts') {
      return ok(route, {
        cart:
          state.cart.status === 'ACTIVE' ? state.cart : { id: null, status: 'ACTIVE', items: [] },
      })
    }
    const decision = /^PATCH \/carts\/items\/([^/]+)\/decision$/.exec(key)
    if (decision) {
      state.calls.push(key)
      const item = state.cart.items.find((i) => i.id === decision[1])
      if (!item) return fail(route, 404, 'not_found', 'Cart item not found')
      item.patientDecision = body.decision
      return ok(route, { item })
    }
    if (key === 'GET /carts/one-click') return ok(route, { onFile: state.onFile })
    if (key === 'POST /carts/one-click-checkout') {
      state.calls.push(key)
      state.oneClickCalls += 1
      if (state.oneClick === 'decline') {
        return fail(
          route,
          402,
          'CARD_DECLINED',
          'Your card was declined. Try again or use a different card.'
        )
      }
      state.cart.status = 'CHECKED_OUT'
      return ok(route, { status: 'succeeded', invoiceId: 'inv-e2e-1', paymentIntentId: 'pi_e2e_1' })
    }
    if (key === 'POST /carts/checkout') {
      state.calls.push(key)
      return ok(route, { clientSecret: 'pi_e2e_fallback_secret_e2e' })
    }
    return route.fallback()
  })
  return state
}

/** No patient detail or product text ever appears in a URL. */
export function expectNoPhiInUrls(state: RxCartState) {
  const probes = [
    MOCK_USERS.PATIENT.name,
    ...MOCK_USERS.PATIENT.name.split(' '),
    MOCK_USERS.PATIENT.email,
    '100 Example Street',
    'Magnesium',
    'Tramadol',
    'Arnica',
  ]
  const decode = (u: string) => {
    try {
      return decodeURIComponent(u)
    } catch {
      return u
    }
  }
  expect(state.urls.length).toBeGreaterThan(0)
  const leaks = state.urls.filter((u) =>
    probes.some((p) => decode(u).toLowerCase().includes(p.toLowerCase()))
  )
  expect(leaks).toEqual([])
}
