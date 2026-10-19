/**
 * Card + shipping address on file, and one-click checkout (B5.4).
 *
 *  booking  ── PaymentIntent with customer + setup_future_usage=off_session
 *           ── on success: rememberCardFromPaymentIntent() stores the Stripe
 *              payment-method id, brand, last 4 and expiry (never the card)
 *           ── the booking page saves a shipping address
 *  cart     ── oneClickCheckout(): off-session charge of the saved card,
 *              no re-entry. No card / address on file → 409, and the client
 *              falls back to the normal Elements checkout.
 *
 * Only Stripe ids and the card summary are stored, so the card data stays in
 * Stripe's PCI scope (SAQ-A). The shipping address is sealed by field-level
 * encryption. Stripe receives the clinic and patient ids only — no name or
 * email (minimum necessary).
 */
import type Stripe from 'stripe'
import { PaymentStatus } from '@prisma/client'
import prisma from '../config/prisma'
import stripe from '../config/stripe'
import { withTenantBypass } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import type { ShippingAddressInput } from '../validation/rxCartSchemas'
import * as auditService from './auditService'
import * as cartService from './cartService'
import { handleCartCheckoutPaymentIntentSucceeded } from '../controllers/webhookController'

const apiError = (status: number, message: string, code: string): ApiError => {
  const err = new Error(message) as ApiError
  err.statusCode = status
  err.code = code
  return err
}

const getProfile = (clinicId: string, patientId: string) =>
  prisma.patientCommerceProfile.findFirst({ where: { clinicId, patientId } })

/**
 * The patient's Stripe customer in this clinic, created on first use.
 * Reuses a customer an earlier membership created.
 */
export async function ensureStripeCustomer(clinicId: string, patientId: string): Promise<string> {
  const profile = await getProfile(clinicId, patientId)
  if (profile?.stripeCustomerId) return profile.stripeCustomerId

  const fromSubscription = await prisma.patientSubscription.findFirst({
    where: { clinicId, patientId, stripeCustomerId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { stripeCustomerId: true },
  })
  const customerId =
    fromSubscription?.stripeCustomerId ??
    (await stripe.customers.create({ metadata: { clinicId, patientId } })).id

  await prisma.patientCommerceProfile.upsert({
    where: { clinicId_patientId: { clinicId, patientId }, clinicId },
    create: { clinicId, patientId, stripeCustomerId: customerId },
    update: { stripeCustomerId: customerId },
  })
  return customerId
}

/**
 * After a booking payment succeeds: keep the card it was paid with for
 * off-session use. Safe to call more than once (webhook + confirm).
 */
export async function rememberCardFromPaymentIntent(params: {
  paymentIntentId: string
  clinicId: string
  patientId: string
  performedById: string | null
}): Promise<boolean> {
  const { paymentIntentId, clinicId, patientId } = params
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['payment_method'],
  })
  if (intent.status !== 'succeeded') return false
  if (intent.setup_future_usage !== 'off_session' || !intent.customer) return false
  if (intent.metadata?.patientId !== patientId || intent.metadata?.clinicId !== clinicId) {
    return false
  }
  const pm = intent.payment_method
  if (!pm || typeof pm === 'string' || pm.type !== 'card' || !pm.card) return false

  const customerId = typeof intent.customer === 'string' ? intent.customer : intent.customer.id
  const card = {
    stripeCustomerId: customerId,
    defaultPaymentMethodId: pm.id,
    cardBrand: pm.card.brand,
    cardLast4: pm.card.last4,
    cardExpMonth: pm.card.exp_month,
    cardExpYear: pm.card.exp_year,
  }
  const existing = await getProfile(clinicId, patientId)
  if (existing?.defaultPaymentMethodId === pm.id) return true

  const profile = await prisma.patientCommerceProfile.upsert({
    where: { clinicId_patientId: { clinicId, patientId }, clinicId },
    create: { clinicId, patientId, ...card },
    update: card,
  })
  await auditService.logAudit({
    clinicId,
    entityType: 'PatientCommerceProfile',
    entityId: profile.id,
    action: 'CARD_ON_FILE_SAVED',
    newValue: { brand: card.cardBrand, last4: card.cardLast4, source: 'booking' },
    performedById: params.performedById,
  })
  return true
}

/** Saves the shipping address used for one-click orders. */
export async function saveShippingAddress(
  clinicId: string,
  patientId: string,
  input: ShippingAddressInput,
  actor: cartService.Actor
) {
  const address = {
    shippingName: input.name,
    shippingLine1: input.line1,
    shippingLine2: input.line2 ?? null,
    shippingCity: input.city,
    shippingState: input.state,
    shippingPostalCode: input.postalCode,
    shippingCountry: input.country,
  }
  const profile = await prisma.patientCommerceProfile.upsert({
    where: { clinicId_patientId: { clinicId, patientId }, clinicId },
    create: { clinicId, patientId, ...address },
    update: address,
  })
  await auditService.logAudit({
    clinicId,
    entityType: 'PatientCommerceProfile',
    entityId: profile.id,
    action: 'SHIPPING_ADDRESS_SAVED',
    performedById: actor.userId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  })
  return toOnFile(profile)
}

type Profile = NonNullable<Awaited<ReturnType<typeof getProfile>>>

export interface OnFile {
  eligible: boolean
  reason: 'NO_CARD_ON_FILE' | 'NO_SHIPPING_ADDRESS' | null
  card: { brand: string; last4: string; expMonth: number | null; expYear: number | null } | null
  shippingAddress: {
    name: string | null
    line1: string
    line2: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    country: string | null
  } | null
}

const toOnFile = (profile: Profile | null): OnFile => {
  const card =
    profile?.defaultPaymentMethodId && profile.stripeCustomerId && profile.cardLast4
      ? {
          brand: profile.cardBrand ?? 'card',
          last4: profile.cardLast4,
          expMonth: profile.cardExpMonth,
          expYear: profile.cardExpYear,
        }
      : null
  const shippingAddress = profile?.shippingLine1
    ? {
        name: profile.shippingName,
        line1: profile.shippingLine1,
        line2: profile.shippingLine2,
        city: profile.shippingCity,
        state: profile.shippingState,
        postalCode: profile.shippingPostalCode,
        country: profile.shippingCountry,
      }
    : null
  const reason = !card ? 'NO_CARD_ON_FILE' : !shippingAddress ? 'NO_SHIPPING_ADDRESS' : null
  return { eligible: reason === null, reason, card, shippingAddress }
}

/** What the cart shows: the card and address on file from booking (F5.3). */
export async function getOnFile(clinicId: string, patientId: string): Promise<OnFile> {
  return toOnFile(await getProfile(clinicId, patientId))
}

export type OneClickResult =
  | { status: 'succeeded'; invoiceId: string; paymentIntentId: string }
  | { status: 'processing'; invoiceId: string; paymentIntentId: string }

const isStripeError = (
  err: unknown
): err is { type: string; code?: string; payment_intent?: { id: string } } =>
  typeof err === 'object' && err !== null && typeof (err as { type?: unknown }).type === 'string'

/**
 * One-click "Pay with card on file" (B5.4). Charges the saved card off
 * session. A decline or a required authentication leaves the cart ACTIVE so
 * the patient can retry or use another card.
 */
export async function oneClickCheckout(
  clinicId: string,
  patientId: string,
  actor: cartService.Actor
): Promise<OneClickResult> {
  const onFile = await getProfile(clinicId, patientId)
  const status = toOnFile(onFile)
  if (!status.eligible || !onFile) {
    throw apiError(
      409,
      status.reason === 'NO_SHIPPING_ADDRESS'
        ? 'Add a shipping address to pay in one click'
        : 'No card on file. Use the regular checkout.',
      status.reason ?? 'NO_CARD_ON_FILE'
    )
  }

  const prepared = await cartService.preparePayableCart(clinicId, patientId)
  const invoice = await cartService.createCartInvoice(clinicId, patientId, prepared)
  const metadata = {
    cartId: prepared.cart.id,
    invoiceId: invoice.id,
    clinicId,
    patientId,
    type: 'CART_CHECKOUT',
    channel: 'ONE_CLICK',
  }

  let intent: Stripe.PaymentIntent
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: Math.round(invoice.totalAmount.toNumber() * 100),
        currency: 'usd',
        customer: onFile.stripeCustomerId!,
        payment_method: onFile.defaultPaymentMethodId!,
        off_session: true,
        confirm: true,
        metadata,
      },
      { idempotencyKey: `one-click-${invoice.id}` }
    )
  } catch (err) {
    const declined = isStripeError(err) && err.type === 'StripeCardError'
    await prisma.$transaction([
      prisma.invoice.update({ where: { id: invoice.id, clinicId }, data: { status: 'CANCELLED' } }),
      prisma.payment.create({
        data: {
          clinicId,
          providerId: prepared.fallbackProviderId,
          invoiceId: invoice.id,
          patientId,
          amount: invoice.totalAmount,
          status: PaymentStatus.FAILED,
          stripePaymentIntentId: declined ? (err.payment_intent?.id ?? null) : null,
          paymentChannel: 'STRIPE',
          paymentMethod: 'CARD_ON_FILE',
        },
      }),
    ])
    const code = declined
      ? err.code === 'authentication_required'
        ? 'AUTHENTICATION_REQUIRED'
        : 'CARD_DECLINED'
      : 'payment_intent_failed'
    await auditService.logAudit({
      clinicId,
      entityType: 'Cart',
      entityId: prepared.cart.id,
      action: 'CART_ONE_CLICK_FAILED',
      newValue: { invoiceId: invoice.id, reason: code },
      performedById: actor.userId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    })
    if (!declined) console.error('One-click PaymentIntent error:', err)
    throw apiError(
      declined ? 402 : 502,
      code === 'AUTHENTICATION_REQUIRED'
        ? 'Your bank needs you to confirm this payment. Use the regular checkout.'
        : declined
          ? 'Your card was declined. Try again or use a different card.'
          : 'Unable to take the payment right now',
      code
    )
  }

  await prisma.$transaction([
    prisma.invoice.update({ where: { id: invoice.id, clinicId }, data: { status: 'FINALIZED' } }),
    prisma.payment.create({
      data: {
        clinicId,
        providerId: prepared.fallbackProviderId,
        invoiceId: invoice.id,
        patientId,
        amount: invoice.totalAmount,
        status: PaymentStatus.PENDING,
        stripePaymentIntentId: intent.id,
        paymentChannel: 'STRIPE',
        paymentMethod: 'CARD_ON_FILE',
      },
    }),
    prisma.cart.update({
      where: { id: prepared.cart.id, clinicId },
      data: { status: 'CHECKED_OUT' },
    }),
  ])

  await auditService.logAudit({
    clinicId,
    entityType: 'Cart',
    entityId: prepared.cart.id,
    action: 'CART_CHECKOUT',
    newValue: { invoiceId: invoice.id, channel: 'ONE_CLICK', stripeStatus: intent.status },
    performedById: actor.userId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  })

  if (intent.status === 'succeeded') {
    // Stripe confirmed the charge server-to-server, so fulfil now with the
    // same idempotent handler the webhook runs; the later webhook is a no-op.
    await withTenantBypass('cart.one-click-fulfilment', () =>
      handleCartCheckoutPaymentIntentSucceeded({ id: intent.id, metadata })
    )
    return { status: 'succeeded', invoiceId: invoice.id, paymentIntentId: intent.id }
  }
  return { status: 'processing', invoiceId: invoice.id, paymentIntentId: intent.id }
}
