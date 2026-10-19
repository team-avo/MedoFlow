import type { Request, Response } from 'express'
import type Stripe from 'stripe'
import stripe from '../config/stripe'
import prisma from '../config/prisma'
import * as emailService from '../services/emailService'
import * as commissionService from '../services/commissionService'
import { AppointmentStatus, PaymentStatus } from '@prisma/client'
import * as membershipService from '../services/membershipService'
import * as patientCommerceService from '../services/patientCommerceService'
import { syncInvoiceStatusFromPayments } from '../services/invoiceService'

/**
 * The payment-intent fields the success handlers read. `Stripe.PaymentIntent`
 * satisfies it.
 */
export interface WebhookPaymentIntent {
  id: string
  client_secret?: string | null
  metadata?: Record<string, string | undefined> | null
}

const cancelCommissionRecords = async (invoiceId: string) => {
  await prisma.commissionRecord.updateMany({
    where: {
      invoiceId,
      status: 'PENDING',
    },
    data: {
      status: 'CANCELLED',
    },
  })
}

export const handleAppointmentPaymentIntentSucceeded = async (
  paymentIntent: WebhookPaymentIntent
) => {
  const metadata: Record<string, string | undefined> = paymentIntent.metadata || {}
  const { appointmentId } = metadata
  if (!appointmentId) return

  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      service: true,
      patient: true,
      provider: { include: { user: true } },
      location: true,
    },
  })

  if (!appt) return

  const existingInvoice = await prisma.invoice.findFirst({
    where: { appointmentId },
  })
  const existingIntentPayment = await prisma.payment.findUnique({
    where: { stripePaymentIntentId: paymentIntent.id },
  })
  const shouldSendConfirmation = appt.paymentStatus !== PaymentStatus.PAID

  // Idempotency: if a payment record already exists and is marked PAID for
  // this exact payment_intent, this event has already been fully processed.
  if (existingIntentPayment?.status === PaymentStatus.PAID) {
    return
  }

  const nextStatus =
    appt.approvalStatus === 'PENDING'
      ? AppointmentStatus.PENDING_PROVIDER_APPROVAL
      : AppointmentStatus.CONFIRMED

  const pendingPayment = await prisma.payment.findFirst({
    where: {
      appointmentId,
      OR: [{ stripePaymentIntentId: paymentIntent.id }, { status: PaymentStatus.PENDING }],
    },
    orderBy: { createdAt: 'desc' },
  })

  if (pendingPayment) {
    await prisma.payment.update({
      where: { id: pendingPayment.id },
      data: {
        status: PaymentStatus.PAID,
        stripePaymentIntentId: paymentIntent.id,
        stripeClientSecret: paymentIntent.client_secret ?? null,
        paymentChannel: pendingPayment.paymentChannel ?? 'STRIPE',
        paymentMethod: pendingPayment.paymentMethod ?? 'CARD',
        recordedAt: pendingPayment.recordedAt ?? new Date(),
      },
    })
  } else {
    await prisma.payment.create({
      data: {
        clinicId: appt.clinicId,
        providerId: appt.providerId,
        invoiceId: existingInvoice?.id ?? null,
        appointmentId: appt.id,
        patientId: appt.patientId,
        amount:
          appt.paymentRequirementType === 'DEPOSIT' && appt.depositAmount
            ? appt.depositAmount
            : appt.priceAtBooking,
        status: PaymentStatus.PAID,
        stripePaymentIntentId: paymentIntent.id,
        stripeClientSecret: paymentIntent.client_secret ?? null,
        paymentChannel: 'STRIPE',
        paymentMethod: 'CARD',
        recordedAt: new Date(),
      },
    })
  }

  if (appt.paymentStatus !== PaymentStatus.PAID || appt.status === 'PENDING_PAYMENT') {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        paymentStatus: 'PAID',
        status: nextStatus,
        slotHeldUntil: null,
        bookingHoldExpiresAt: null,
      },
    })
  }

  if (!existingInvoice) {
    await prisma.invoice.create({
      data: {
        clinicId: appt.clinicId,
        patientId: appt.patientId,
        providerId: appt.providerId,
        appointmentId: appt.id,
        status: 'PAID',
        subtotal: appt.priceAtBooking,
        taxAmount: 0,
        totalAmount: appt.priceAtBooking,
        items: {
          create: {
            serviceId: appt.serviceId,
            description: appt.service.name,
            unitPrice: appt.priceAtBooking,
            quantity: 1,
            totalPrice: appt.priceAtBooking,
          },
        },
      },
    })
  } else if (existingInvoice.status !== 'PAID') {
    await prisma.invoice.update({
      where: { id: existingInvoice.id },
      data: { status: 'PAID' },
    })
  }

  if (shouldSendConfirmation) {
    await emailService.sendAppointmentConfirmation({
      to: appt.patient.email,
      patientName: appt.patient.name,
      appointmentDate: appt.startTime.toLocaleString(),
      serviceName: appt.service.name,
      providerName: `${appt.provider.firstName} ${appt.provider.lastName}`,
      locationName: appt.location?.name || 'Clinic',
    })
  }

  const inv = await prisma.invoice.findFirst({ where: { appointmentId } })
  if (inv) await commissionService.calculateCommissions(inv.id)

  // B5.4: the booking card becomes the card on file for one-click purchases.
  await patientCommerceService
    .rememberCardFromPaymentIntent({
      paymentIntentId: paymentIntent.id,
      clinicId: appt.clinicId,
      patientId: appt.patientId,
      performedById: null,
    })
    .catch((err: unknown) => console.error('Saving card on file failed:', err))
}

export const handleCartCheckoutPaymentIntentSucceeded = async (
  paymentIntent: WebhookPaymentIntent
) => {
  const metadata: Record<string, string | undefined> = paymentIntent.metadata || {}
  const { invoiceId, clinicId, patientId } = metadata
  if (!invoiceId || !clinicId || !patientId) return

  const existingPaidPayment = await prisma.payment.findUnique({
    where: { stripePaymentIntentId: paymentIntent.id },
  })
  if (existingPaidPayment?.status === PaymentStatus.PAID) {
    return
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true, patient: true },
  })
  if (!invoice) return

  const wasAlreadyPaid = invoice.status === 'PAID'

  const pendingPayment = existingPaidPayment
    ? existingPaidPayment
    : await prisma.payment.findFirst({
        where: {
          invoiceId,
          patientId,
          clinicId,
          status: PaymentStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      })

  if (pendingPayment) {
    await prisma.payment.update({
      where: { id: pendingPayment.id },
      data: {
        status: PaymentStatus.PAID,
        stripePaymentIntentId: paymentIntent.id,
        stripeClientSecret: paymentIntent.client_secret ?? null,
        paymentChannel: pendingPayment.paymentChannel ?? 'STRIPE',
        paymentMethod: pendingPayment.paymentMethod ?? 'CARD',
        recordedAt: pendingPayment.recordedAt ?? new Date(),
      },
    })
  } else {
    await prisma.payment.create({
      data: {
        clinicId,
        providerId: null,
        invoiceId,
        patientId,
        amount: invoice.totalAmount,
        status: PaymentStatus.PAID,
        stripePaymentIntentId: paymentIntent.id,
        stripeClientSecret: paymentIntent.client_secret ?? null,
        paymentChannel: 'STRIPE',
        paymentMethod: 'CARD',
        recordedAt: new Date(),
      },
    })
  }

  if (wasAlreadyPaid) {
    return
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: 'PAID' },
  })

  for (const item of invoice.items) {
    if (item.productId) {
      await prisma.inventoryItem.updateMany({
        where: { productId: item.productId, clinicId: invoice.clinicId },
        data: { quantityInStock: { decrement: item.quantity } },
      })
    }

    if (item.packageId) {
      const pkg = await prisma.package.findUnique({ where: { id: item.packageId } })
      if (pkg) {
        const existingPackage = await prisma.patientPackage.findFirst({
          where: {
            invoiceId: invoice.id,
            patientId: invoice.patientId,
            packageId: pkg.id,
          },
        })

        if (!existingPackage) {
          await prisma.patientPackage.create({
            data: {
              clinicId: invoice.clinicId,
              patientId: invoice.patientId,
              packageId: pkg.id,
              invoiceId: invoice.id,
              totalSessions: pkg.totalSessions ?? 0,
              expiresAt: pkg.expiresInDays
                ? new Date(Date.now() + pkg.expiresInDays * 24 * 60 * 60 * 1000)
                : null,
            },
          })
        }
      }
    }
  }

  await commissionService.calculateCommissions(invoiceId)

  await emailService.sendInvoiceEmail({
    to: invoice.patient.email,
    patientName: invoice.patient.name,
    totalAmount: `$${Number(invoice.totalAmount).toFixed(2)}`,
    invoiceUrl: `${process.env.FRONTEND_URL}/?view=billing&invoice=${invoice.id}`,
  })
}

export const handleStripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET

  let event: Stripe.Event

  if (endpointSecret) {
    try {
      // express.raw() hands the route the raw payload (Buffer) for signature checks.
      event = stripe.webhooks.constructEvent(req.body as string | Buffer, sig, endpointSecret)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Webhook Error: ${message}`)
      res.status(400).send(`Webhook Error: ${message}`)
      return
    }
  } else {
    // No secret (local development only): the body is still the raw Buffer from express.raw().
    // The unsigned JSON is the untyped boundary; it is typed once as a Stripe event here.
    const body: unknown = req.body
    event = (Buffer.isBuffer(body) ? JSON.parse(body.toString('utf8')) : body) as Stripe.Event
  }

  // Event-level idempotency: Stripe retries and replays deliver the same
  // event id more than once. Claim the id before any side effect; a second
  // delivery is acknowledged without re-running the handler. If processing
  // fails the claim is released so Stripe's retry can run it again.
  if (typeof event?.id === 'string') {
    const claim = await prisma.processedStripeEvent.createMany({
      data: [{ id: event.id, type: String(event.type) }],
      skipDuplicates: true,
    })
    if (claim.count === 0) {
      res.json({ received: true, duplicate: true })
      return
    }
  }

  try {
    await dispatchStripeEvent(event)
  } catch (err) {
    if (typeof event?.id === 'string') {
      await prisma.processedStripeEvent.delete({ where: { id: event.id } }).catch(() => undefined)
    }
    throw err
  }

  res.json({ received: true })
}

const dispatchStripeEvent = async (event: Stripe.Event) => {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object
      const metadata: Record<string, string | undefined> = paymentIntent.metadata || {}
      const { type } = metadata

      if (type === 'APPOINTMENT') {
        await handleAppointmentPaymentIntentSucceeded(paymentIntent)
      }

      if (type === 'CART_CHECKOUT') {
        await handleCartCheckoutPaymentIntentSucceeded(paymentIntent)
      }
      break
    }

    case 'invoice.paid': {
      // Widened to the fields read here: Stripe's typings no longer model
      // `Invoice.subscription`, which the webhook payload still carries.
      const invoiceObject: membershipService.PaidSubscriptionInvoice = event.data.object
      if (invoiceObject.subscription) {
        await membershipService.recordPaidSubscriptionInvoice(invoiceObject)
      }
      break
    }

    case 'invoice.payment_failed': {
      // Widened to the fields read here: Stripe's typings no longer model
      // `Invoice.subscription`, which the webhook payload still carries.
      const invoiceObject: membershipService.PaidSubscriptionInvoice = event.data.object
      if (invoiceObject.subscription) {
        const subId =
          typeof invoiceObject.subscription === 'string'
            ? invoiceObject.subscription
            : invoiceObject.subscription.id
        await prisma.patientSubscription.updateMany({
          where: { stripeSubscriptionId: subId },
          data: { status: 'PAST_DUE' },
        })
      }
      break
    }

    case 'customer.subscription.deleted': {
      const deletedSub = event.data.object
      await membershipService.syncSubscriptionFromStripe(deletedSub)
      break
    }

    case 'customer.subscription.updated': {
      const updatedSub = event.data.object
      await membershipService.syncSubscriptionFromStripe(updatedSub)
      break
    }

    case 'customer.subscription.created': {
      const createdSub = event.data.object
      await membershipService.syncSubscriptionFromStripe(createdSub)
      break
    }

    case 'charge.refunded': {
      const charge = event.data.object
      const paymentIntentId = charge.payment_intent as string | undefined
      if (!paymentIntentId) break

      const payment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
      })
      if (!payment) break

      // Cancel pending commissions on any refund
      if (payment.invoiceId) {
        await cancelCommissionRecords(payment.invoiceId)
        // Sync the invoice's financial status to reflect the Stripe-side refund.
        // This matters when refunds are issued directly through the Stripe dashboard
        // rather than through the in-app refund flow.
        await syncInvoiceStatusFromPayments(payment.invoiceId)
      }

      // Sync appointment payment status if one is associated
      if (payment.appointmentId) {
        const refundedAmount: number | undefined = charge.amount_refunded
        const originalAmount: number | undefined = charge.amount
        const isFullRefund =
          refundedAmount != null && originalAmount != null && refundedAmount >= originalAmount
        await prisma.appointment.update({
          where: { id: payment.appointmentId },
          data: {
            paymentStatus: isFullRefund ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
          },
        })
      }
      break
    }

    default:
      console.warn(`Unhandled event type ${event.type}`)
  }
}
