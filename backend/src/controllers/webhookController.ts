import { Request, Response } from 'express'
import stripe from '../config/stripe'
import prisma from '../config/prisma'
import * as emailService from '../services/emailService'
import * as commissionService from '../services/commissionService'
import { PaymentStatus } from '@prisma/client'
import * as membershipService from '../services/membershipService'
import { syncInvoiceStatusFromPayments } from '../services/invoiceService'

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

export const handleAppointmentPaymentIntentSucceeded = async (paymentIntent: any) => {
  const { appointmentId } = paymentIntent.metadata || {}
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

  const nextStatus = appt.approvalStatus === 'PENDING' ? 'PENDING_PROVIDER_APPROVAL' : 'CONFIRMED'

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
        status: nextStatus as any,
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
}

export const handleCartCheckoutPaymentIntentSucceeded = async (paymentIntent: any) => {
  const { invoiceId, clinicId, patientId } = paymentIntent.metadata || {}
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

  let event

  if (endpointSecret) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret)
    } catch (err: any) {
      console.error(`Webhook Error: ${err.message}`)
      res.status(400).send(`Webhook Error: ${err.message}`)
      return
    }
  } else {
    event = req.body
  }

  // Event-level idempotency: Stripe retries and replays deliver the same
  // event id more than once. Claim the id before any side effect; a second
  // delivery is acknowledged without re-running the handler. If processing
  // fails the claim is released so Stripe's retry can run it again.
  if (typeof event?.id === 'string') {
    try {
      await prisma.processedStripeEvent.create({ data: { id: event.id, type: String(event.type) } })
    } catch (err: any) {
      if (err?.code === 'P2002') {
        res.json({ received: true, duplicate: true })
        return
      }
      throw err
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

const dispatchStripeEvent = async (event: any) => {
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as any
      const { type } = paymentIntent.metadata || {}

      if (type === 'APPOINTMENT') {
        await handleAppointmentPaymentIntentSucceeded(paymentIntent)
      }

      if (type === 'CART_CHECKOUT') {
        await handleCartCheckoutPaymentIntentSucceeded(paymentIntent)
      }
      break
    }

    case 'invoice.paid': {
      const invoiceObject = event.data.object as any
      if (invoiceObject.subscription) {
        await membershipService.recordPaidSubscriptionInvoice(invoiceObject)
      }
      break
    }

    case 'invoice.payment_failed': {
      const invoiceObject = event.data.object as any
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
      const deletedSub = event.data.object as any
      await membershipService.syncSubscriptionFromStripe(deletedSub)
      break
    }

    case 'customer.subscription.updated': {
      const updatedSub = event.data.object as any
      await membershipService.syncSubscriptionFromStripe(updatedSub)
      break
    }

    case 'customer.subscription.created': {
      const createdSub = event.data.object as any
      await membershipService.syncSubscriptionFromStripe(createdSub)
      break
    }

    case 'charge.refunded': {
      const charge = event.data.object as any
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
        const refundedAmount = charge.amount_refunded as number | undefined
        const originalAmount = charge.amount as number | undefined
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
