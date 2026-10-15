import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import * as auditService from './auditService'
import type { AppointmentStatus } from '@prisma/client'
import { PaymentRequirementType, PaymentStatus, Prisma } from '@prisma/client'
import stripe from '../config/stripe'
import { computeInvoiceFinancials, syncInvoiceStatusFromPayments } from './invoiceService'
import * as commissionService from './commissionService'

const getAmountToCharge = (appointment: {
  paymentRequirementType: PaymentRequirementType
  depositAmount: { toString(): string } | null
  priceAtBooking: { toString(): string }
}) => {
  if (
    appointment.paymentRequirementType === PaymentRequirementType.DEPOSIT &&
    appointment.depositAmount
  ) {
    return Number(appointment.depositAmount)
  }
  return Number(appointment.priceAtBooking)
}

const getPendingPayment = async (appointmentId: string, clinicId: string) => {
  return prisma.payment.findFirst({
    where: { appointmentId, clinicId, status: PaymentStatus.PENDING },
    orderBy: { createdAt: 'desc' },
  })
}

export const ensurePaymentIntent = async (
  appointmentId: string,
  performedById: string,
  where?: { clinicId?: string; patientId?: string }
) => {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, ...clinicScope(), ...where },
    select: {
      id: true,
      clinicId: true,
      providerId: true,
      patientId: true,
      status: true,
      paymentStatus: true,
      paymentRequirementType: true,
      depositAmount: true,
      priceAtBooking: true,
      bookingHoldExpiresAt: true,
    },
  })

  if (!appointment) {
    const err = new Error('Appointment not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (appointment.status !== 'PENDING_PAYMENT') {
    const err = new Error('Appointment is not pending payment') as ApiError
    err.statusCode = 400
    err.code = 'invalid_state'
    throw err
  }

  if (
    appointment.bookingHoldExpiresAt &&
    appointment.bookingHoldExpiresAt.getTime() <= Date.now()
  ) {
    const err = new Error('Slot hold has expired') as ApiError
    err.statusCode = 400
    err.code = 'expired_hold'
    throw err
  }

  const existing = await getPendingPayment(appointmentId, appointment.clinicId)
  if (existing?.stripeClientSecret) {
    return {
      payment: existing,
      clientSecret: existing.stripeClientSecret,
      reused: true,
    }
  }

  if (existing?.stripePaymentIntentId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(existing.stripePaymentIntentId)
      const clientSecret = intent.client_secret ?? existing.stripeClientSecret
      if (clientSecret && clientSecret !== existing.stripeClientSecret) {
        await prisma.payment.update({
          where: { id: existing.id, clinicId: appointment.clinicId },
          data: { stripeClientSecret: clientSecret },
        })
      }
      return {
        payment: {
          ...existing,
          stripeClientSecret: clientSecret ?? existing.stripeClientSecret,
        },
        clientSecret,
        reused: true,
      }
    } catch (err) {
      console.error('Stripe PaymentIntent retrieve error:', err)
    }
  }

  const amountToCharge = getAmountToCharge(appointment)
  const amountInCents = Math.round(amountToCharge * 100)

  try {
    const intent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      metadata: {
        appointmentId: appointment.id,
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        type: 'APPOINTMENT',
      },
    })

    const payment = existing
      ? await prisma.payment.update({
          where: { id: existing.id, clinicId: appointment.clinicId },
          data: {
            stripePaymentIntentId: intent.id,
            stripeClientSecret: intent.client_secret ?? null,
            paymentChannel: 'STRIPE',
            paymentMethod: 'CARD',
          },
        })
      : await prisma.payment.create({
          data: {
            clinicId: appointment.clinicId,
            providerId: appointment.providerId,
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            amount: amountToCharge,
            status: PaymentStatus.PENDING,
            stripePaymentIntentId: intent.id,
            stripeClientSecret: intent.client_secret ?? null,
            paymentChannel: 'STRIPE',
            paymentMethod: 'CARD',
          },
        })

    await auditService.logAudit({
      clinicId: appointment.clinicId,
      entityType: 'Payment',
      entityId: payment.id,
      action: existing ? 'PAYMENT_INTENT_REUSED' : 'PAYMENT_INTENT_CREATED',
      newValue: {
        appointmentId: appointment.id,
        stripePaymentIntentId: intent.id,
      },
      performedById,
    })

    return {
      payment,
      clientSecret: intent.client_secret ?? null,
      reused: false,
    }
  } catch (err) {
    console.error('Stripe PaymentIntent create error:', err)
    return {
      payment: existing ?? null,
      clientSecret: null,
      reused: Boolean(existing),
    }
  }
}

export const confirmPayment = async (
  appointmentId: string,
  performedById: string,
  where?: { clinicId?: string; patientId?: string }
) => {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, ...clinicScope(), ...where },
    include: { service: true },
  })

  if (!appointment) {
    const err = new Error('Appointment not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (appointment.status !== 'PENDING_PAYMENT') {
    const err = new Error('Appointment is not pending payment') as ApiError
    err.statusCode = 400
    throw err
  }

  const now = new Date()
  if (appointment.slotHeldUntil && appointment.slotHeldUntil < now) {
    const err = new Error('Slot hold has expired') as ApiError
    err.statusCode = 400
    throw err
  }

  const amount = appointment.priceAtBooking

  const nextStatus: AppointmentStatus =
    appointment.approvalStatus === 'PENDING' ? 'PENDING_PROVIDER_APPROVAL' : 'CONFIRMED'

  const invoice = await prisma.invoice.findFirst({
    where: { appointmentId, clinicId: appointment.clinicId },
    select: { id: true },
  })

  const pendingPayment = await getPendingPayment(appointmentId, appointment.clinicId)

  const [payment, updatedAppointment] = await prisma.$transaction([
    pendingPayment
      ? prisma.payment.update({
          where: { id: pendingPayment.id, clinicId: appointment.clinicId },
          data: {
            invoiceId: invoice?.id ?? null,
            status: PaymentStatus.PAID,
            paymentChannel: pendingPayment.paymentChannel ?? 'STRIPE',
            paymentMethod: pendingPayment.paymentMethod ?? 'CARD',
            recordedAt: pendingPayment.recordedAt ?? new Date(),
            recordedById: pendingPayment.recordedById ?? performedById,
          },
        })
      : prisma.payment.create({
          data: {
            clinicId: appointment.clinicId,
            providerId: appointment.providerId,
            invoiceId: invoice?.id ?? null,
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            amount,
            status: PaymentStatus.PAID,
            paymentChannel: 'STRIPE',
            paymentMethod: 'CARD',
            recordedAt: new Date(),
            recordedById: performedById,
          },
        }),
    prisma.appointment.update({
      where: { id: appointmentId, clinicId: appointment.clinicId },
      data: {
        status: nextStatus,
        paymentStatus: PaymentStatus.PAID,
        paymentDueAt: null,
        slotHeldUntil: null,
        bookingHoldExpiresAt: null,
      },
      include: {
        clinic: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        provider: {
          include: {
            disciplines: { include: { discipline: { select: { id: true, name: true } } } },
            user: { select: { id: true, name: true } },
          },
        },
        service: { select: { id: true, name: true, duration: true } },
        patient: { select: { id: true, name: true, email: true } },
      },
    }),
  ])

  await auditService.logAudit({
    clinicId: appointment.clinicId,
    entityType: 'Payment',
    entityId: payment.id,
    action: 'PAYMENT_CONFIRMED',
    newValue: {
      appointmentId,
      amount: Number(amount),
      status: 'PAID',
    },
    performedById,
  })

  return { payment, appointment: updatedAppointment }
}

export const demoConfirmPayment = async (
  appointmentId: string,
  performedById: string,
  where?: { clinicId?: string; patientId?: string }
) => {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, ...clinicScope(), ...where },
    include: {
      service: true,
      patient: { select: { id: true, name: true, email: true } },
      provider: true,
      location: true,
    },
  })

  if (!appointment) {
    const err = new Error('Appointment not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const amount =
    appointment.paymentRequirementType === 'DEPOSIT' && appointment.depositAmount
      ? appointment.depositAmount
      : appointment.priceAtBooking

  const nextStatus: AppointmentStatus =
    appointment.approvalStatus === 'PENDING' ? 'PENDING_PROVIDER_APPROVAL' : 'CONFIRMED'

  const [payment, updatedAppointment] = await prisma.$transaction([
    prisma.payment.create({
      data: {
        clinicId: appointment.clinicId,
        providerId: appointment.providerId,
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        recordedById: performedById,
        amount,
        status: PaymentStatus.PAID,
        paymentChannel: 'DEMO',
        paymentMethod: 'DEMO_MODE',
        recordedAt: new Date(),
      },
    }),
    prisma.appointment.update({
      where: { id: appointmentId, clinicId: appointment.clinicId },
      data: {
        paymentStatus: PaymentStatus.PAID,
        status: nextStatus,
        slotHeldUntil: null,
        bookingHoldExpiresAt: null,
      },
      include: {
        clinic: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        provider: {
          include: {
            disciplines: { include: { discipline: { select: { id: true, name: true } } } },
            user: { select: { id: true, name: true } },
          },
        },
        service: { select: { id: true, name: true, duration: true } },
        patient: { select: { id: true, name: true, email: true } },
      },
    }),
  ])

  // Create invoice if not exists
  const existingInvoice = await prisma.invoice.findFirst({
    where: { appointmentId, clinicId: appointment.clinicId },
  })

  let invoiceId = existingInvoice?.id

  if (!existingInvoice) {
    const invoice = await prisma.invoice.create({
      data: {
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        providerId: appointment.providerId,
        locationId: appointment.locationId,
        appointmentId: appointment.id,
        status: 'PAID',
        subtotal: appointment.priceAtBooking,
        taxAmount: 0,
        totalAmount: appointment.priceAtBooking,
        items: {
          create: {
            serviceId: appointment.serviceId,
            providerId: appointment.providerId,
            description: appointment.service.name,
            unitPrice: appointment.priceAtBooking,
            quantity: 1,
            totalPrice: appointment.priceAtBooking,
          },
        },
      },
    })
    invoiceId = invoice.id
  } else {
    await prisma.invoice.update({
      where: { id: existingInvoice.id, clinicId: appointment.clinicId },
      data: { status: 'PAID' },
    })
  }

  if (invoiceId) {
    await commissionService.calculateCommissions(invoiceId)
  }

  return { payment, appointment: updatedAppointment }
}

export const failPayment = async (
  appointmentId: string,
  performedById: string,
  where?: { clinicId?: string; patientId?: string }
) => {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, ...clinicScope(), ...where },
  })

  if (!appointment) {
    const err = new Error('Appointment not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (appointment.status !== 'PENDING_PAYMENT') {
    const err = new Error('Appointment is not pending payment') as ApiError
    err.statusCode = 400
    throw err
  }

  const amount = appointment.priceAtBooking

  const invoice = await prisma.invoice.findFirst({
    where: { appointmentId, clinicId: appointment.clinicId },
    select: { id: true },
  })

  const pendingPayment = await getPendingPayment(appointmentId, appointment.clinicId)

  const [payment, updatedAppointment] = await prisma.$transaction([
    pendingPayment
      ? prisma.payment.update({
          where: { id: pendingPayment.id, clinicId: appointment.clinicId },
          data: {
            invoiceId: invoice?.id ?? null,
            status: PaymentStatus.FAILED,
            paymentChannel: pendingPayment.paymentChannel ?? 'STRIPE',
            paymentMethod: pendingPayment.paymentMethod ?? 'CARD',
          },
        })
      : prisma.payment.create({
          data: {
            clinicId: appointment.clinicId,
            providerId: appointment.providerId,
            invoiceId: invoice?.id ?? null,
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            amount,
            status: PaymentStatus.FAILED,
            paymentChannel: 'STRIPE',
            paymentMethod: 'CARD',
          },
        }),
    prisma.appointment.update({
      where: { id: appointmentId, clinicId: appointment.clinicId },
      data: { paymentStatus: PaymentStatus.FAILED, updatedById: performedById },
      include: {
        clinic: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        provider: {
          include: {
            disciplines: { include: { discipline: { select: { id: true, name: true } } } },
            user: { select: { id: true, name: true } },
          },
        },
        service: { select: { id: true, name: true, duration: true } },
        patient: { select: { id: true, name: true, email: true } },
      },
    }),
  ])

  await auditService.logAudit({
    clinicId: appointment.clinicId,
    entityType: 'Payment',
    entityId: payment.id,
    action: 'PAYMENT_FAILED',
    newValue: {
      appointmentId,
      amount: Number(amount),
      status: 'FAILED',
    },
    performedById,
  })

  return { payment, appointment: updatedAppointment }
}

export const releaseExpiredPendingPayments = async (): Promise<number> => {
  const now = new Date()

  const expired = await prisma.appointment.findMany({
    where: {
      status: 'PENDING_PAYMENT',
      bookingHoldExpiresAt: { lt: now },
    },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      providerId: true,
      priceAtBooking: true,
    },
  })

  if (expired.length === 0) return 0

  for (const apt of expired) {
    const invoice = await prisma.invoice.findFirst({
      where: { appointmentId: apt.id, clinicId: apt.clinicId },
      select: { id: true },
    })
    const pendingPayment = await getPendingPayment(apt.id, apt.clinicId)
    await prisma.$transaction([
      pendingPayment
        ? prisma.payment.update({
            where: { id: pendingPayment.id, clinicId: apt.clinicId },
            data: {
              invoiceId: invoice?.id ?? null,
              status: PaymentStatus.FAILED,
              paymentChannel: pendingPayment.paymentChannel ?? 'STRIPE',
              paymentMethod: pendingPayment.paymentMethod ?? 'CARD',
            },
          })
        : prisma.payment.create({
            data: {
              clinicId: apt.clinicId,
              providerId: apt.providerId,
              invoiceId: invoice?.id ?? null,
              appointmentId: apt.id,
              patientId: apt.patientId,
              amount: apt.priceAtBooking,
              status: PaymentStatus.FAILED,
              paymentChannel: 'STRIPE',
              paymentMethod: 'CARD',
            },
          }),
      prisma.appointment.update({
        where: { id: apt.id, clinicId: apt.clinicId },
        data: {
          status: 'CANCELLED',
          paymentStatus: PaymentStatus.FAILED,
          cancelledAt: now,
          cancellationReason: 'Payment not completed within slot hold window',
          slotHeldUntil: null,
          bookingHoldExpiresAt: null,
          paymentDueAt: null,
          updatedById: apt.patientId,
        },
      }),
    ])

    await auditService.logAudit({
      clinicId: apt.clinicId,
      entityType: 'Appointment',
      entityId: apt.id,
      action: 'APPOINTMENT_PAYMENT_EXPIRED',
      newValue: {
        expiredAt: now.toISOString(),
        reason: 'Slot hold expired',
      },
      performedById: apt.patientId,
    })
  }

  return expired.length
}

export const refundPayment = async (
  paymentId: string,
  performedById: string,
  amountInput?: number | string,
  where?: { clinicId?: string }
) => {
  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      status: PaymentStatus.PAID,
      ...(where?.clinicId ? { clinicId: where.clinicId } : clinicScope()),
    },
    include: {
      appointment: true,
    },
  })

  if (!payment) {
    const err = new Error('Successful payment not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (!payment.stripePaymentIntentId) {
    const err = new Error('Only Stripe-backed payments can be refunded') as ApiError
    err.statusCode = 400
    err.code = 'unsupported_refund'
    throw err
  }

  const existingRefund = await prisma.payment.findMany({
    where: {
      refundForPaymentId: payment.id,
      clinicId: payment.clinicId,
      status: PaymentStatus.REFUNDED,
    },
  })

  const refundedSoFar = existingRefund.reduce(
    (sum, refund) => sum.plus(new Prisma.Decimal(refund.amount).abs()),
    new Prisma.Decimal(0)
  )
  const originalAmount = new Prisma.Decimal(payment.amount)
  const remainingRefundable = originalAmount.minus(refundedSoFar)

  if (remainingRefundable.lte(0)) {
    const err = new Error('Payment already fully refunded') as ApiError
    err.statusCode = 400
    err.code = 'already_refunded'
    throw err
  }

  const refundAmount = amountInput !== undefined ? new Prisma.Decimal(amountInput) : originalAmount

  if (refundAmount.lte(0)) {
    const err = new Error('Refund amount must be greater than zero') as ApiError
    err.statusCode = 400
    err.code = 'invalid_amount'
    throw err
  }

  if (refundAmount.gt(remainingRefundable)) {
    const err = new Error('Refund amount exceeds remaining refundable amount') as ApiError
    err.statusCode = 400
    err.code = 'over_refund'
    throw err
  }

  const invoice = payment.invoiceId
    ? await prisma.invoice.findUnique({
        where: { id: payment.invoiceId, clinicId: payment.clinicId },
        include: { items: true },
      })
    : null

  if (invoice) {
    if (invoice.items.some((item) => Boolean(item.membershipId))) {
      const err = new Error(
        'Membership subscription refunds are not supported from the app'
      ) as ApiError
      err.statusCode = 400
      err.code = 'membership_refund_unsupported'
      throw err
    }
    const packageUsageCount = await prisma.packageSessionUsage.count({
      where: {
        patientPackage: {
          invoiceId: invoice.id,
        },
      },
    })
    if (packageUsageCount > 0) {
      const err = new Error(
        'Cannot refund an invoice after package sessions from that purchase have been consumed'
      ) as ApiError
      err.statusCode = 400
      err.code = 'refund_blocked_package_used'
      throw err
    }
  }

  const isPartialRefund = refundAmount.lt(remainingRefundable) || refundAmount.lt(originalAmount)
  if (isPartialRefund && invoice?.items.some((item) => Boolean(item.productId || item.packageId))) {
    const err = new Error(
      'Partial refunds are not supported for invoices with products or packages'
    ) as ApiError
    err.statusCode = 400
    err.code = 'partial_refund_unsupported'
    throw err
  }

  const stripeRefund = await stripe.refunds.create({
    payment_intent: payment.stripePaymentIntentId,
    amount: Math.round(Number(refundAmount) * 100),
  })

  const results = await prisma.$transaction(async (tx) => {
    const refund = await tx.payment.create({
      data: {
        clinicId: payment.clinicId,
        providerId: payment.providerId ?? null,
        invoiceId: payment.invoiceId ?? null,
        appointmentId: payment.appointmentId,
        patientId: payment.patientId,
        amount: refundAmount.mul(-1),
        status: PaymentStatus.REFUNDED,
        refundForPaymentId: payment.id,
        stripeRefundId: stripeRefund.id,
        paymentChannel: payment.paymentChannel ?? 'STRIPE',
        paymentMethod: payment.paymentMethod ?? 'CARD',
        recordedById: performedById,
        recordedAt: new Date(),
        notes: `Refund against payment ${payment.id}`,
      },
    })

    await tx.payment.update({
      where: { id: payment.id, clinicId: payment.clinicId },
      data: {
        status: refundAmount.eq(remainingRefundable)
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED,
      },
    })

    let updatedAppointment = null
    if (payment.appointmentId) {
      updatedAppointment = await tx.appointment.update({
        where: { id: payment.appointmentId, clinicId: payment.clinicId },
        data: { paymentStatus: PaymentStatus.REFUNDED, updatedById: performedById },
        include: {
          clinic: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          provider: {
            include: {
              disciplines: {
                include: { discipline: { select: { id: true, name: true } } },
              },
              user: { select: { id: true, name: true } },
            },
          },
          service: { select: { id: true, name: true, duration: true } },
          patient: { select: { id: true, name: true, email: true } },
        },
      })
    }

    if (payment.invoiceId) {
      if (refundAmount.eq(remainingRefundable)) {
        await tx.commissionRecord.updateMany({
          where: {
            invoiceId: payment.invoiceId,
            clinicId: payment.clinicId,
            status: 'PENDING',
          },
          data: {
            status: 'CANCELLED',
          },
        })

        const invoiceProducts = await tx.invoiceItem.findMany({
          where: { invoiceId: payment.invoiceId, productId: { not: null } },
        })
        for (const item of invoiceProducts) {
          if (item.productId) {
            await tx.inventoryItem.updateMany({
              where: { clinicId: payment.clinicId, productId: item.productId },
              data: { quantityInStock: { increment: item.quantity } },
            })
          }
        }

        await tx.patientPackage.updateMany({
          where: {
            invoiceId: payment.invoiceId,
            clinicId: payment.clinicId,
            usedSessions: 0,
            status: 'ACTIVE',
          },
          data: {
            status: 'CANCELLED',
          },
        })
      }

      await syncInvoiceStatusFromPayments(payment.invoiceId, tx)
    }

    return { refund, updatedAppointment }
  })

  const { refund, updatedAppointment } = results

  await auditService.logAudit({
    clinicId: payment.clinicId,
    entityType: 'Payment',
    entityId: payment.id,
    action: 'PAYMENT_REFUNDED',
    newValue: {
      refundPaymentId: refund.id,
      originalAmount: Number(payment.amount),
      refundAmount: Number(refund.amount),
      partial: refundAmount.lt(originalAmount),
    },
    performedById,
  })

  if (payment.invoiceId && payment.appointmentId) {
    const refreshedInvoice = await prisma.invoice.findUnique({
      where: { id: payment.invoiceId, clinicId: payment.clinicId },
      include: { payments: true },
    })
    if (refreshedInvoice) {
      const financials = computeInvoiceFinancials(refreshedInvoice)
      await prisma.appointment.update({
        where: { id: payment.appointmentId, clinicId: payment.clinicId },
        data: {
          paymentStatus: financials.outstandingAmount.lte(0)
            ? PaymentStatus.PAID
            : PaymentStatus.PENDING,
          updatedById: performedById,
        },
      })
    }
  }

  return { refund, appointment: updatedAppointment }
}
