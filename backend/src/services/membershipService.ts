import prisma from '../config/prisma'
import stripe from '../config/stripe'
import { clinicScope } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import { PaymentStatus, Prisma, SubscriptionStatus } from '@prisma/client'

const ZERO = new Prisma.Decimal(0)

const createApiError = (message: string, statusCode: number, code: string) => {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  err.code = code
  return err
}

const mapBillingPeriodToStripeInterval = (billingPeriod?: string): 'month' | 'year' => {
  const normalized = (billingPeriod ?? 'MONTHLY').toUpperCase()
  return normalized === 'YEARLY' || normalized === 'ANNUAL' ? 'year' : 'month'
}

export const mapStripeSubscriptionStatus = (status?: string | null): SubscriptionStatus => {
  switch (status) {
    case 'active':
      return SubscriptionStatus.ACTIVE
    case 'trialing':
      return SubscriptionStatus.TRIALING
    case 'past_due':
    case 'unpaid':
      return SubscriptionStatus.PAST_DUE
    case 'incomplete':
      return SubscriptionStatus.INCOMPLETE
    case 'incomplete_expired':
    case 'paused':
      return SubscriptionStatus.ENDED
    case 'canceled':
      return SubscriptionStatus.CANCELED
    default:
      return SubscriptionStatus.INCOMPLETE
  }
}

// A Stripe id reference: either the bare id or the expanded object.
type StripeRef = string | { id: string }

// The expanded payment intent on an invoice (`expand: ['latest_invoice.payment_intent']`).
interface ExpandedPaymentIntent {
  id: string
  client_secret?: string | null
}

// Current Stripe typings no longer model `Invoice.payment_intent` /
// `Invoice.subscription`; these are exactly the invoice fields read here.
interface InvoiceWithPaymentIntent {
  payment_intent?: string | ExpandedPaymentIntent | null
}

const hasPaymentIntentField = (value: unknown): value is InvoiceWithPaymentIntent =>
  typeof value === 'object' && value !== null && 'payment_intent' in value

/**
 * The subscription fields read when mirroring a Stripe subscription locally.
 * `Stripe.Subscription` satisfies it; the period fields are optional because
 * newer Stripe API versions moved them onto subscription items.
 */
export interface StripeSubscriptionLike {
  id: string
  customer?: StripeRef | null
  status?: string | null
  current_period_start?: number
  current_period_end?: number
  cancel_at_period_end: boolean
  metadata?: Record<string, string | undefined> | null
  latest_invoice?: unknown
}

const getPaymentIntentClientSecret = (subscription: StripeSubscriptionLike) => {
  const latestInvoice = subscription.latest_invoice
  const paymentIntent = hasPaymentIntentField(latestInvoice) ? latestInvoice.payment_intent : null
  return typeof paymentIntent === 'object' && paymentIntent
    ? (paymentIntent.client_secret ?? null)
    : null
}

// Number() keeps the implicit-coercion semantics of the arithmetic (undefined -> NaN).
const getSubscriptionPeriod = (subscription: StripeSubscriptionLike) => ({
  currentPeriodStart: new Date(Number(subscription.current_period_start) * 1000),
  currentPeriodEnd: new Date(Number(subscription.current_period_end) * 1000),
})

export const getMemberships = async (clinicId: string) => {
  return prisma.membership.findMany({
    where: { clinicId, isActive: true },
    orderBy: { createdAt: 'desc' },
  })
}

export const getMembershipById = async (id: string, clinicId: string) => {
  const membership = await prisma.membership.findFirst({
    where: { id, clinicId },
  })

  if (!membership) {
    throw createApiError('Membership not found', 404, 'membership_not_found')
  }

  return membership
}

export interface CreateMembershipInput {
  name: string
  description?: string
  monthlyPrice: number
  billingPeriod?: string
  serviceDiscountPercent?: number
}

export const createMembership = async (clinicId: string, input: CreateMembershipInput) => {
  return prisma.membership.create({
    data: {
      clinicId,
      name: input.name,
      description: input.description,
      monthlyPrice: input.monthlyPrice,
      billingPeriod: input.billingPeriod ?? 'MONTHLY',
      serviceDiscountPercent: input.serviceDiscountPercent ?? 0,
    },
  })
}

export interface UpdateMembershipInput {
  name?: string
  description?: string
  monthlyPrice?: number
  billingPeriod?: string
  serviceDiscountPercent?: number
  isActive?: boolean
}

export const updateMembership = async (
  id: string,
  clinicId: string,
  input: UpdateMembershipInput
) => {
  const existing = await prisma.membership.findFirst({
    where: { id, clinicId },
  })

  if (!existing) {
    throw createApiError('Membership not found', 404, 'membership_not_found')
  }

  return prisma.membership.update({
    where: { id, clinicId },
    data: input,
  })
}

export const deleteMembership = async (id: string, clinicId: string) => {
  const existing = await prisma.membership.findFirst({
    where: { id, clinicId },
  })

  if (!existing) {
    throw createApiError('Membership not found', 404, 'membership_not_found')
  }

  return prisma.membership.update({
    where: { id, clinicId },
    data: { isActive: false },
  })
}

export const listPatientSubscriptions = async (clinicId: string, patientId: string) => {
  return prisma.patientSubscription.findMany({
    where: { clinicId, patientId },
    include: {
      membership: true,
    },
    orderBy: { createdAt: 'desc' },
  })
}

export const getMembershipOperationalSummary = async (clinicId: string) => {
  const [subscriptions, recentSubscriptions] = await Promise.all([
    prisma.patientSubscription.findMany({
      where: { clinicId },
      include: { membership: true, patient: { select: { id: true, name: true, email: true } } },
    }),
    prisma.patientSubscription.findMany({
      where: { clinicId },
      include: { membership: true, patient: { select: { id: true, name: true, email: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    }),
  ])

  const statusCounts = subscriptions.reduce<Record<string, number>>((acc, subscription) => {
    acc[subscription.status] = (acc[subscription.status] ?? 0) + 1
    return acc
  }, {})

  return {
    totalSubscriptions: subscriptions.length,
    activeCount: statusCounts.ACTIVE ?? 0,
    trialingCount: statusCounts.TRIALING ?? 0,
    pastDueCount: statusCounts.PAST_DUE ?? 0,
    incompleteCount: statusCounts.INCOMPLETE ?? 0,
    canceledCount: statusCounts.CANCELED ?? 0,
    endedCount: statusCounts.ENDED ?? 0,
    cancelAtPeriodEndCount: subscriptions.filter((subscription) => subscription.cancelAtPeriodEnd)
      .length,
    recentSubscriptions,
  }
}

// The client or an interactive-transaction handle: only the subscription delegate is used.
type PrismaLike = Pick<typeof prisma, 'patientSubscription'>

export const getActiveMembershipBenefitWithExecutor = async (
  executor: PrismaLike,
  clinicId: string,
  patientId: string
) => {
  try {
    const subscriptions = await executor.patientSubscription.findMany({
      where: {
        clinicId,
        patientId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        currentPeriodEnd: { gt: new Date() },
      },
      include: {
        membership: {
          select: { id: true, name: true, serviceDiscountPercent: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!subscriptions || subscriptions.length === 0) return null

    const eligible = subscriptions.filter(
      (subscription) =>
        subscription.membership &&
        new Prisma.Decimal(subscription.membership.serviceDiscountPercent).gt(ZERO)
    )

    if (eligible.length === 0) return null

    return eligible.sort((left, right) =>
      new Prisma.Decimal(right.membership.serviceDiscountPercent)
        .minus(left.membership.serviceDiscountPercent)
        .toNumber()
    )[0]
  } catch (err) {
    console.error('Active Membership Benefit Query Error:', err)
    return null
  }
}

export const getActiveMembershipBenefit = async (clinicId: string, patientId: string) =>
  getActiveMembershipBenefitWithExecutor(prisma, clinicId, patientId)

export const getPatientEntitlementSummary = async (clinicId: string, patientId: string) => {
  const [packages, subscriptions] = await Promise.all([
    prisma.patientPackage.findMany({
      where: {
        clinicId,
        patientId,
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: { package: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.patientSubscription.findMany({
      where: {
        clinicId,
        patientId,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.INCOMPLETE,
          ],
        },
      },
      include: { membership: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const benefitEligibleStatuses: SubscriptionStatus[] = [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.TRIALING,
  ]
  const membershipBenefit = subscriptions.find((subscription) =>
    benefitEligibleStatuses.includes(subscription.status)
  )

  return {
    packages: packages.map((pkg) => ({
      id: pkg.id,
      status: pkg.status,
      totalSessions: pkg.totalSessions,
      usedSessions: pkg.usedSessions,
      remainingSessions: Math.max(pkg.totalSessions - pkg.usedSessions, 0),
      expiresAt: pkg.expiresAt,
      package: {
        id: pkg.package.id,
        name: pkg.package.name,
      },
    })),
    subscriptions: subscriptions.map((subscription) => ({
      id: subscription.id,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      membership: {
        id: subscription.membership.id,
        name: subscription.membership.name,
        billingPeriod: subscription.membership.billingPeriod,
        monthlyPrice: subscription.membership.monthlyPrice,
        serviceDiscountPercent: subscription.membership.serviceDiscountPercent,
      },
    })),
    activeMembershipBenefit: membershipBenefit
      ? {
          subscriptionId: membershipBenefit.id,
          membershipId: membershipBenefit.membershipId,
          membershipName: membershipBenefit.membership.name,
          serviceDiscountPercent: membershipBenefit.membership.serviceDiscountPercent,
        }
      : null,
  }
}

const findReusableCustomerId = async (clinicId: string, patientId: string) => {
  const existing = await prisma.patientSubscription.findFirst({
    where: {
      clinicId,
      patientId,
      stripeCustomerId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
  })

  return existing?.stripeCustomerId ?? null
}

export const syncSubscriptionFromStripe = async (stripeSubscription: StripeSubscriptionLike) => {
  const metadata = stripeSubscription.metadata ?? {}
  const clinicId = metadata.clinicId
  const patientId = metadata.patientId
  const membershipId = metadata.membershipId

  const existing = await prisma.patientSubscription.findUnique({
    where: { stripeSubscriptionId: stripeSubscription.id, ...clinicScope() },
  })

  if (!existing && (!clinicId || !patientId || !membershipId)) {
    return null
  }

  const period = getSubscriptionPeriod(stripeSubscription)
  const nextStatus = mapStripeSubscriptionStatus(stripeSubscription.status)

  return prisma.patientSubscription.upsert({
    where: { stripeSubscriptionId: stripeSubscription.id, ...clinicScope() },
    create: {
      clinicId: clinicId!,
      patientId: patientId!,
      membershipId: membershipId!,
      stripeSubscriptionId: stripeSubscription.id,
      stripeCustomerId:
        typeof stripeSubscription.customer === 'string'
          ? stripeSubscription.customer
          : (stripeSubscription.customer?.id ?? null),
      status: nextStatus,
      currentPeriodStart: period.currentPeriodStart,
      currentPeriodEnd: period.currentPeriodEnd,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    },
    update: {
      stripeCustomerId:
        typeof stripeSubscription.customer === 'string'
          ? stripeSubscription.customer
          : (stripeSubscription.customer?.id ?? null),
      status: nextStatus,
      currentPeriodStart: period.currentPeriodStart,
      currentPeriodEnd: period.currentPeriodEnd,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    },
    include: { membership: true },
  })
}

export const startMembershipPurchase = async (
  clinicId: string,
  patientId: string,
  membershipId: string
) => {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, clinicId, isActive: true },
  })

  if (!membership) {
    throw createApiError('Membership not found', 404, 'membership_not_found')
  }

  const patient = await prisma.user.findUnique({
    where: { id: patientId },
    select: { id: true, name: true, email: true },
  })
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true },
  })

  if (!patient || !clinic) {
    throw createApiError('Patient or clinic not found', 404, 'membership_context_missing')
  }

  const existingSubscriptions = await prisma.patientSubscription.findMany({
    where: {
      clinicId,
      patientId,
      status: {
        in: [
          SubscriptionStatus.ACTIVE,
          SubscriptionStatus.TRIALING,
          SubscriptionStatus.PAST_DUE,
          SubscriptionStatus.INCOMPLETE,
        ],
      },
    },
    include: { membership: true },
    orderBy: { createdAt: 'desc' },
  })

  const existingIncomplete = existingSubscriptions.find(
    (subscription) => subscription.status === SubscriptionStatus.INCOMPLETE
  )

  if (existingIncomplete?.stripeSubscriptionId) {
    const stripeSubscription = await stripe.subscriptions.retrieve(
      existingIncomplete.stripeSubscriptionId,
      { expand: ['latest_invoice.payment_intent'] }
    )

    return {
      subscription: await syncSubscriptionFromStripe(stripeSubscription),
      clientSecret: getPaymentIntentClientSecret(stripeSubscription),
      reused: true,
    }
  }

  const blockingSubscription = existingSubscriptions.find(
    (subscription) =>
      subscription.status !== SubscriptionStatus.INCOMPLETE &&
      subscription.currentPeriodEnd > new Date()
  )

  if (blockingSubscription) {
    throw createApiError(
      'The patient already has an active membership subscription for this clinic',
      409,
      'active_membership_exists'
    )
  }

  const stripeCustomerId =
    (await findReusableCustomerId(clinicId, patientId)) ??
    (
      await stripe.customers.create({
        email: patient.email,
        name: patient.name,
        metadata: {
          clinicId,
          patientId,
        },
      })
    ).id

  const stripeProduct = await stripe.products.create({
    name: `${clinic.name} Membership - ${membership.name}`,
    description: membership.description ?? undefined,
    metadata: {
      clinicId,
      membershipId: membership.id,
    },
  })

  const stripePrice = await stripe.prices.create({
    currency: 'usd',
    unit_amount: Math.round(Number(membership.monthlyPrice) * 100),
    recurring: {
      interval: mapBillingPeriodToStripeInterval(membership.billingPeriod),
    },
    product: stripeProduct.id,
  })

  const stripeSubscription = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    collection_method: 'charge_automatically',
    payment_behavior: 'default_incomplete',
    payment_settings: {
      save_default_payment_method: 'on_subscription',
    },
    metadata: {
      clinicId,
      patientId,
      membershipId: membership.id,
    },
    items: [
      {
        price: stripePrice.id,
      },
    ],
    expand: ['latest_invoice.payment_intent'],
  })

  const subscription = await syncSubscriptionFromStripe(stripeSubscription)

  return {
    subscription,
    clientSecret: getPaymentIntentClientSecret(stripeSubscription),
    reused: false,
  }
}

export const cancelMembershipAtPeriodEnd = async (
  clinicId: string,
  patientId: string,
  subscriptionId: string
) => {
  const subscription = await prisma.patientSubscription.findFirst({
    where: {
      id: subscriptionId,
      clinicId,
      patientId,
    },
    include: { membership: true },
  })

  if (!subscription || !subscription.stripeSubscriptionId) {
    throw createApiError('Membership subscription not found', 404, 'subscription_not_found')
  }

  const cancellableStatuses: SubscriptionStatus[] = [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.PAST_DUE,
  ]
  if (!cancellableStatuses.includes(subscription.status)) {
    throw createApiError(
      'Only active or trialing subscriptions can be canceled from the app',
      400,
      'subscription_cancel_unsupported'
    )
  }

  const updatedStripeSubscription = await stripe.subscriptions.update(
    subscription.stripeSubscriptionId,
    {
      cancel_at_period_end: true,
    }
  )

  return syncSubscriptionFromStripe(updatedStripeSubscription)
}

/** The invoice fields read when recording a paid membership invoice. */
export interface PaidSubscriptionInvoice extends InvoiceWithPaymentIntent {
  id: string
  subscription?: StripeRef | null
  amount_paid?: number | null
  period_start?: number | null
  period_end?: number | null
  status_transitions?: { paid_at?: number | null } | null
}

export const recordPaidSubscriptionInvoice = async (invoiceObject: PaidSubscriptionInvoice) => {
  if (!invoiceObject.subscription) return null

  const stripeSubscriptionId =
    typeof invoiceObject.subscription === 'string'
      ? invoiceObject.subscription
      : invoiceObject.subscription.id

  const subscription = await prisma.patientSubscription.findUnique({
    where: { stripeSubscriptionId },
    include: { membership: true },
  })

  if (!subscription) return null

  const amountPaid = new Prisma.Decimal((invoiceObject.amount_paid ?? 0) / 100)
  const stripeInvoiceId = invoiceObject.id
  const paymentIntentId =
    typeof invoiceObject.payment_intent === 'string'
      ? invoiceObject.payment_intent
      : (invoiceObject.payment_intent?.id ?? null)
  const clientSecret =
    typeof invoiceObject.payment_intent === 'object' &&
    invoiceObject.payment_intent &&
    'client_secret' in invoiceObject.payment_intent
      ? invoiceObject.payment_intent.client_secret
      : null

  const periodStart =
    invoiceObject.period_start != null
      ? new Date(invoiceObject.period_start * 1000)
      : subscription.currentPeriodStart
  const periodEnd =
    invoiceObject.period_end != null
      ? new Date(invoiceObject.period_end * 1000)
      : subscription.currentPeriodEnd

  const invoice = await prisma.invoice.upsert({
    where: { stripeInvoiceId },
    create: {
      clinicId: subscription.clinicId,
      patientId: subscription.patientId,
      providerId: null,
      stripeInvoiceId,
      status: 'PAID',
      subtotal: amountPaid,
      taxAmount: ZERO,
      totalAmount: amountPaid,
      items: {
        create: {
          membershipId: subscription.membershipId,
          description: `Membership renewal: ${subscription.membership.name}`,
          unitPrice: amountPaid,
          quantity: 1,
          totalPrice: amountPaid,
        },
      },
    },
    update: {
      status: 'PAID',
      subtotal: amountPaid,
      taxAmount: ZERO,
      totalAmount: amountPaid,
    },
  })

  if (paymentIntentId) {
    const existingPayment = await prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    })

    if (!existingPayment) {
      await prisma.payment.create({
        data: {
          clinicId: subscription.clinicId,
          providerId: null,
          invoiceId: invoice.id,
          patientId: subscription.patientId,
          amount: amountPaid,
          status: PaymentStatus.PAID,
          stripePaymentIntentId: paymentIntentId,
          stripeClientSecret: clientSecret,
          paymentChannel: 'STRIPE',
          paymentMethod: 'CARD',
          recordedAt: new Date(
            invoiceObject.status_transitions?.paid_at
              ? invoiceObject.status_transitions.paid_at * 1000
              : Date.now()
          ),
          notes: `Membership invoice ${stripeInvoiceId}`,
        },
      })
    }
  }

  await prisma.patientSubscription.update({
    where: { id: subscription.id },
    data: {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
  })

  return invoice
}
