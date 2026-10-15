import assert from 'node:assert/strict'
import { PaymentStatus, Prisma, SubscriptionStatus } from '@prisma/client'
import prisma from '../config/prisma'
import stripe from '../config/stripe'
import * as membershipService from '../services/membershipService'
import * as appointmentService from '../services/appointmentService'
import * as paymentService from '../services/paymentService'
import * as packageUsageService from '../services/packageUsageService'
import * as auditService from '../services/auditService'
import * as emailService from '../services/emailService'
import * as waitlistService from '../services/waitlistService'

// Module namespace exports are getter-only; redefine instead of assigning.
const restore = <T extends object, K extends keyof T>(object: T, key: K, value: T[K]) => {
  Object.defineProperty(object, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  })
}

test('membership purchase creates a real Stripe-linked local subscription record', async () => {
  const originalMembershipFindFirst = prisma.membership.findFirst
  const originalUserFindUnique = prisma.user.findUnique
  const originalClinicFindUnique = prisma.clinic.findUnique
  const originalSubscriptionFindMany = prisma.patientSubscription.findMany
  const originalSubscriptionFindFirst = prisma.patientSubscription.findFirst
  const originalSubscriptionFindUnique = prisma.patientSubscription.findUnique
  const originalSubscriptionUpsert = prisma.patientSubscription.upsert
  const originalCustomerCreate = stripe.customers.create
  const originalProductCreate = stripe.products.create
  const originalPriceCreate = stripe.prices.create
  const originalSubscriptionCreate = stripe.subscriptions.create

  try {
    ;(prisma.membership.findFirst as any) = async () => ({
      id: 'membership-1',
      clinicId: 'clinic-1',
      name: 'Wellness',
      description: 'Recurring plan',
      monthlyPrice: new Prisma.Decimal(49),
      billingPeriod: 'MONTHLY',
      isActive: true,
    })
    ;(prisma.user.findUnique as any) = async () => ({
      id: 'patient-1',
      name: 'Patient One',
      email: 'patient@example.com',
    })
    ;(prisma.clinic.findUnique as any) = async () => ({
      id: 'clinic-1',
      name: 'Clinic One',
    })
    ;(prisma.patientSubscription.findMany as any) = async () => []
    ;(prisma.patientSubscription.findFirst as any) = async () => null
    ;(prisma.patientSubscription.findUnique as any) = async () => null
    ;(prisma.patientSubscription.upsert as any) = async ({ create, update }: any) => ({
      id: 'sub-local-1',
      ...(create ?? update),
      membership: {
        id: 'membership-1',
        name: 'Wellness',
        serviceDiscountPercent: new Prisma.Decimal(10),
      },
    })
    ;(stripe.customers.create as any) = async () => ({ id: 'cus_1' })
    ;(stripe.products.create as any) = async () => ({ id: 'prod_1' })
    ;(stripe.prices.create as any) = async ({ unit_amount }: any) => {
      assert.equal(unit_amount, 4900)
      return { id: 'price_1' }
    }
    ;(stripe.subscriptions.create as any) = async () => ({
      id: 'sub_1',
      customer: 'cus_1',
      status: 'incomplete',
      current_period_start: 1710000000,
      current_period_end: 1712592000,
      cancel_at_period_end: false,
      metadata: {
        clinicId: 'clinic-1',
        patientId: 'patient-1',
        membershipId: 'membership-1',
      },
      latest_invoice: {
        payment_intent: {
          client_secret: 'seti_secret_1',
        },
      },
    })

    const result = await membershipService.startMembershipPurchase(
      'clinic-1',
      'patient-1',
      'membership-1'
    )

    assert.equal(result.reused, false)
    assert.equal(result.clientSecret, 'seti_secret_1')
    assert.equal(result.subscription?.stripeSubscriptionId, 'sub_1')
    assert.equal(result.subscription?.stripeCustomerId, 'cus_1')
    assert.equal(result.subscription?.status, SubscriptionStatus.INCOMPLETE)
  } finally {
    restore(prisma.membership, 'findFirst', originalMembershipFindFirst)
    restore(prisma.user, 'findUnique', originalUserFindUnique)
    restore(prisma.clinic, 'findUnique', originalClinicFindUnique)
    restore(prisma.patientSubscription, 'findMany', originalSubscriptionFindMany)
    restore(prisma.patientSubscription, 'findFirst', originalSubscriptionFindFirst)
    restore(prisma.patientSubscription, 'findUnique', originalSubscriptionFindUnique)
    restore(prisma.patientSubscription, 'upsert', originalSubscriptionUpsert)
    restore(stripe.customers, 'create', originalCustomerCreate)
    restore(stripe.products, 'create', originalProductCreate)
    restore(stripe.prices, 'create', originalPriceCreate)
    restore(stripe.subscriptions, 'create', originalSubscriptionCreate)
  }
})

test('repeated membership purchase attempts reuse an incomplete subscription safely', async () => {
  const originalMembershipFindFirst = prisma.membership.findFirst
  const originalUserFindUnique = prisma.user.findUnique
  const originalClinicFindUnique = prisma.clinic.findUnique
  const originalSubscriptionFindMany = prisma.patientSubscription.findMany
  const originalSubscriptionFindUnique = prisma.patientSubscription.findUnique
  const originalSubscriptionUpsert = prisma.patientSubscription.upsert
  const originalSubscriptionRetrieve = stripe.subscriptions.retrieve
  const originalSubscriptionCreate = stripe.subscriptions.create

  try {
    ;(prisma.membership.findFirst as any) = async () => ({
      id: 'membership-1',
      clinicId: 'clinic-1',
      monthlyPrice: new Prisma.Decimal(49),
      billingPeriod: 'MONTHLY',
      isActive: true,
    })
    ;(prisma.user.findUnique as any) = async () => ({
      id: 'patient-1',
      name: 'Patient One',
      email: 'patient@example.com',
    })
    ;(prisma.clinic.findUnique as any) = async () => ({
      id: 'clinic-1',
      name: 'Clinic One',
    })
    ;(prisma.patientSubscription.findMany as any) = async () => [
      {
        id: 'local-sub-1',
        clinicId: 'clinic-1',
        patientId: 'patient-1',
        membershipId: 'membership-1',
        stripeSubscriptionId: 'sub_1',
        status: SubscriptionStatus.INCOMPLETE,
        currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]
    ;(prisma.patientSubscription.findUnique as any) = async () => ({
      id: 'local-sub-1',
      stripeSubscriptionId: 'sub_1',
      status: SubscriptionStatus.INCOMPLETE,
    })
    ;(prisma.patientSubscription.upsert as any) = async ({ update }: any) => ({
      id: 'local-sub-1',
      ...update,
    })
    ;(stripe.subscriptions.retrieve as any) = async () => ({
      id: 'sub_1',
      customer: 'cus_1',
      status: 'incomplete',
      current_period_start: 1710000000,
      current_period_end: 1712592000,
      cancel_at_period_end: false,
      metadata: {
        clinicId: 'clinic-1',
        patientId: 'patient-1',
        membershipId: 'membership-1',
      },
      latest_invoice: {
        payment_intent: {
          client_secret: 'existing_secret',
        },
      },
    })
    ;(stripe.subscriptions.create as any) = async () => {
      throw new Error('should not create a second subscription')
    }

    const result = await membershipService.startMembershipPurchase(
      'clinic-1',
      'patient-1',
      'membership-1'
    )

    assert.equal(result.reused, true)
    assert.equal(result.clientSecret, 'existing_secret')
  } finally {
    restore(prisma.membership, 'findFirst', originalMembershipFindFirst)
    restore(prisma.user, 'findUnique', originalUserFindUnique)
    restore(prisma.clinic, 'findUnique', originalClinicFindUnique)
    restore(prisma.patientSubscription, 'findMany', originalSubscriptionFindMany)
    restore(prisma.patientSubscription, 'findUnique', originalSubscriptionFindUnique)
    restore(prisma.patientSubscription, 'upsert', originalSubscriptionUpsert)
    restore(stripe.subscriptions, 'retrieve', originalSubscriptionRetrieve)
    restore(stripe.subscriptions, 'create', originalSubscriptionCreate)
  }
})

test('subscription webhook mapping updates local state honestly', async () => {
  const originalFindUnique = prisma.patientSubscription.findUnique
  const originalUpsert = prisma.patientSubscription.upsert

  try {
    ;(prisma.patientSubscription.findUnique as any) = async () => null
    ;(prisma.patientSubscription.upsert as any) = async ({ create }: any) => create

    const result = await membershipService.syncSubscriptionFromStripe({
      id: 'sub_1',
      customer: 'cus_1',
      status: 'trialing',
      current_period_start: 1710000000,
      current_period_end: 1712592000,
      cancel_at_period_end: false,
      metadata: {
        clinicId: 'clinic-1',
        patientId: 'patient-1',
        membershipId: 'membership-1',
      },
    })

    assert.equal(result?.status, SubscriptionStatus.TRIALING)
    assert.equal(result?.stripeSubscriptionId, 'sub_1')
  } finally {
    restore(prisma.patientSubscription, 'findUnique', originalFindUnique)
    restore(prisma.patientSubscription, 'upsert', originalUpsert)
  }
})

test('membership invoice paid handling is idempotent for ledger creation', async () => {
  const originalSubFindUnique = prisma.patientSubscription.findUnique
  const originalInvoiceUpsert = prisma.invoice.upsert
  const originalPaymentFindUnique = prisma.payment.findUnique
  const originalPaymentCreate = prisma.payment.create
  const originalSubUpdate = prisma.patientSubscription.update

  let paymentCreateCount = 0
  let firstLookup = true

  try {
    ;(prisma.patientSubscription.findUnique as any) = async () => ({
      id: 'local-sub-1',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      membershipId: 'membership-1',
      currentPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z'),
      membership: { id: 'membership-1', name: 'Wellness' },
    })
    ;(prisma.invoice.upsert as any) = async ({ create }: any) => ({
      id: 'invoice-1',
      ...(create ?? {}),
    })
    ;(prisma.payment.findUnique as any) = async () => {
      if (firstLookup) {
        firstLookup = false
        return null
      }
      return { id: 'payment-1' }
    }
    ;(prisma.payment.create as any) = async () => {
      paymentCreateCount += 1
      return { id: 'payment-1' }
    }
    ;(prisma.patientSubscription.update as any) = async () => ({ id: 'local-sub-1' })

    const invoiceObject = {
      id: 'in_1',
      subscription: 'sub_1',
      payment_intent: 'pi_1',
      amount_paid: 4900,
      period_start: 1710000000,
      period_end: 1712592000,
      status_transitions: { paid_at: 1710000300 },
    }

    await membershipService.recordPaidSubscriptionInvoice(invoiceObject as any)
    await membershipService.recordPaidSubscriptionInvoice(invoiceObject as any)

    assert.equal(paymentCreateCount, 1)
  } finally {
    restore(prisma.patientSubscription, 'findUnique', originalSubFindUnique)
    restore(prisma.invoice, 'upsert', originalInvoiceUpsert)
    restore(prisma.payment, 'findUnique', originalPaymentFindUnique)
    restore(prisma.payment, 'create', originalPaymentCreate)
    restore(prisma.patientSubscription, 'update', originalSubUpdate)
  }
})

test('package remaining sessions are exposed in entitlement summary', async () => {
  const originalPackageFindMany = prisma.patientPackage.findMany
  const originalSubscriptionFindMany = prisma.patientSubscription.findMany

  try {
    ;(prisma.patientPackage.findMany as any) = async () => [
      {
        id: 'pkg-1',
        status: 'ACTIVE',
        totalSessions: 6,
        usedSessions: 2,
        expiresAt: null,
        package: { id: 'package-1', name: 'Care Pack' },
      },
    ]
    ;(prisma.patientSubscription.findMany as any) = async () => []

    const result = await membershipService.getPatientEntitlementSummary('clinic-1', 'patient-1')

    assert.equal(result.packages[0]?.remainingSessions, 4)
    assert.equal(result.activeMembershipBenefit, null)
  } finally {
    restore(prisma.patientPackage, 'findMany', originalPackageFindMany)
    restore(prisma.patientSubscription, 'findMany', originalSubscriptionFindMany)
  }
})

test('package-covered booking applies the supported benefit and reduces charge to zero', async () => {
  const originalTransaction = prisma.$transaction
  try {
    ;(prisma.$transaction as any) = async (callback: (tx: any) => Promise<any>) =>
      callback({
        $executeRaw: async () => 0,
        slotHold: { findFirst: async () => null, update: async () => null },
        service: {
          findFirst: async () => ({
            id: 'service-1',
            clinicId: 'clinic-1',
            name: 'Consultation',
            defaultPrice: new Prisma.Decimal(100),
            duration: 30,
            isActive: true,
            isArchived: false,
            discipline: null,
            minimumNoticeMinutes: 0,
            maxFutureBookingDays: 365,
            requirePrepayment: true,
            prepaymentType: 'FULL',
            depositAmount: null,
            requireProviderApproval: false,
          }),
        },
        provider: {
          findFirst: async () => ({
            id: 'provider-1',
            providerServices: [
              {
                priceOverride: null,
                service: { id: 'service-1', defaultPrice: new Prisma.Decimal(100) },
              },
            ],
          }),
        },
        location: { findFirst: async () => ({ id: 'location-1', timezone: 'UTC' }) },
        providerLocationAssignment: { findFirst: async () => ({ id: 'pla-1' }) },
        user: { findUnique: async () => ({ id: 'patient-1', role: 'PATIENT' }) },
        patientClinicMembership: { upsert: async () => ({}) },
        appointment: {
          findFirst: async () => null,
          create: async ({ data }: any) => ({
            id: 'appointment-1',
            ...data,
            clinic: { id: 'clinic-1', name: 'Clinic One' },
            location: { id: 'location-1', name: 'Online' },
            provider: {
              id: 'provider-1',
              firstName: 'A',
              lastName: 'B',
              disciplines: [],
              user: { id: 'u1', name: 'Provider' },
            },
            service: { id: 'service-1', name: 'Consultation', duration: 30 },
            patient: { id: 'patient-1', name: 'Patient One', email: 'patient@example.com' },
          }),
          update: async () => null,
        },
        patientPackage: {
          findFirst: async () => ({
            id: 'package-use-1',
            patientId: 'patient-1',
            clinicId: 'clinic-1',
            status: 'ACTIVE',
            usedSessions: 0,
            totalSessions: 5,
          }),
          update: async () => ({ id: 'package-use-1', usedSessions: 1, totalSessions: 5 }),
        },
        patientSubscription: {
          findMany: async () => [],
        },
        packageSessionUsage: { create: async () => null },
        auditLog: { create: async () => null },
        payment: { create: async () => null },
      })

    const result = await appointmentService.createAppointment(
      {
        providerId: 'provider-1',
        serviceId: 'service-1',
        patientId: 'patient-1',
        startTime: '2026-03-20T10:00:00.000Z',
        endTime: '2026-03-20T10:30:00.000Z',
      },
      'clinic-1',
      {
        patientPackageId: 'package-use-1',
      }
    )

    assert.equal(Number(result.appointment.priceAtBooking), 0)
    assert.equal(result.appointment.paymentStatus, PaymentStatus.PAID)
    assert.equal(result.appointment.paymentRequirementType, 'NONE')
  } finally {
    restore(prisma, '$transaction', originalTransaction)
  }
})

test('membership discount applies correctly when no package is used', async () => {
  const originalTransaction = prisma.$transaction

  try {
    ;(prisma.$transaction as any) = async (callback: (tx: any) => Promise<any>) =>
      callback({
        $executeRaw: async () => 0,
        slotHold: { findFirst: async () => null, update: async () => null },
        service: {
          findFirst: async () => ({
            id: 'service-1',
            clinicId: 'clinic-1',
            name: 'Consultation',
            defaultPrice: new Prisma.Decimal(100),
            duration: 30,
            isActive: true,
            isArchived: false,
            discipline: null,
            minimumNoticeMinutes: 0,
            maxFutureBookingDays: 365,
            requirePrepayment: false,
            prepaymentType: 'NONE',
            depositAmount: null,
            requireProviderApproval: false,
          }),
        },
        provider: {
          findFirst: async () => ({
            id: 'provider-1',
            providerServices: [
              {
                priceOverride: null,
                service: { id: 'service-1', defaultPrice: new Prisma.Decimal(100) },
              },
            ],
          }),
        },
        location: { findFirst: async () => ({ id: 'location-1', timezone: 'UTC' }) },
        providerLocationAssignment: { findFirst: async () => ({ id: 'pla-1' }) },
        user: { findUnique: async () => ({ id: 'patient-1', role: 'PATIENT' }) },
        patientClinicMembership: { upsert: async () => ({}) },
        appointment: {
          findFirst: async () => null,
          create: async ({ data }: any) => ({
            id: 'appointment-1',
            ...data,
            clinic: { id: 'clinic-1', name: 'Clinic One' },
            location: { id: 'location-1', name: 'Online' },
            provider: {
              id: 'provider-1',
              firstName: 'A',
              lastName: 'B',
              disciplines: [],
              user: { id: 'u1', name: 'Provider' },
            },
            service: { id: 'service-1', name: 'Consultation', duration: 30 },
            patient: { id: 'patient-1', name: 'Patient One', email: 'patient@example.com' },
          }),
          update: async () => null,
        },
        patientPackage: {
          findFirst: async () => null,
          update: async () => ({ id: 'unused' }),
        },
        patientSubscription: {
          findMany: async () => [
            {
              id: 'sub-1',
              status: SubscriptionStatus.ACTIVE,
              currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z'),
              membership: {
                serviceDiscountPercent: new Prisma.Decimal(10),
              },
            },
          ],
        },
        packageSessionUsage: { create: async () => null },
        auditLog: { create: async () => null },
        payment: { create: async () => null },
      })

    const result = await appointmentService.createAppointment(
      {
        providerId: 'provider-1',
        serviceId: 'service-1',
        patientId: 'patient-1',
        startTime: '2026-03-20T10:00:00.000Z',
        endTime: '2026-03-20T10:30:00.000Z',
      },
      'clinic-1'
    )

    assert.equal(Number(result.appointment.priceAtBooking), 90)
  } finally {
    restore(prisma, '$transaction', originalTransaction)
  }
})

test('package coverage takes precedence over membership discount', async () => {
  const originalTransaction = prisma.$transaction

  try {
    ;(prisma.$transaction as any) = async (callback: (tx: any) => Promise<any>) =>
      callback({
        $executeRaw: async () => 0,
        slotHold: { findFirst: async () => null, update: async () => null },
        service: {
          findFirst: async () => ({
            id: 'service-1',
            clinicId: 'clinic-1',
            name: 'Consultation',
            defaultPrice: new Prisma.Decimal(100),
            duration: 30,
            isActive: true,
            isArchived: false,
            discipline: null,
            minimumNoticeMinutes: 0,
            maxFutureBookingDays: 365,
            requirePrepayment: false,
            prepaymentType: 'NONE',
            depositAmount: null,
            requireProviderApproval: false,
          }),
        },
        provider: {
          findFirst: async () => ({
            id: 'provider-1',
            providerServices: [
              {
                priceOverride: null,
                service: { id: 'service-1', defaultPrice: new Prisma.Decimal(100) },
              },
            ],
          }),
        },
        location: { findFirst: async () => ({ id: 'location-1', timezone: 'UTC' }) },
        providerLocationAssignment: { findFirst: async () => ({ id: 'pla-1' }) },
        user: { findUnique: async () => ({ id: 'patient-1', role: 'PATIENT' }) },
        patientClinicMembership: { upsert: async () => ({}) },
        appointment: {
          findFirst: async () => null,
          create: async ({ data }: any) => ({
            id: 'appointment-1',
            ...data,
            clinic: { id: 'clinic-1', name: 'Clinic One' },
            location: { id: 'location-1', name: 'Online' },
            provider: {
              id: 'provider-1',
              firstName: 'A',
              lastName: 'B',
              disciplines: [],
              user: { id: 'u1', name: 'Provider' },
            },
            service: { id: 'service-1', name: 'Consultation', duration: 30 },
            patient: { id: 'patient-1', name: 'Patient One', email: 'patient@example.com' },
          }),
          update: async () => null,
        },
        patientPackage: {
          findFirst: async () => ({
            id: 'package-use-1',
            patientId: 'patient-1',
            clinicId: 'clinic-1',
            status: 'ACTIVE',
            usedSessions: 0,
            totalSessions: 5,
          }),
          update: async () => ({ id: 'package-use-1', usedSessions: 1, totalSessions: 5 }),
        },
        patientSubscription: {
          findMany: async () => [
            {
              id: 'sub-1',
              status: SubscriptionStatus.ACTIVE,
              currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z'),
              membership: {
                serviceDiscountPercent: new Prisma.Decimal(20),
              },
            },
          ],
        },
        packageSessionUsage: { create: async () => null },
        auditLog: { create: async () => null },
        payment: { create: async () => null },
      })

    const result = await appointmentService.createAppointment(
      {
        providerId: 'provider-1',
        serviceId: 'service-1',
        patientId: 'patient-1',
        startTime: '2026-03-20T10:00:00.000Z',
        endTime: '2026-03-20T10:30:00.000Z',
      },
      'clinic-1',
      { patientPackageId: 'package-use-1' }
    )

    assert.equal(Number(result.appointment.priceAtBooking), 0)
  } finally {
    restore(prisma, '$transaction', originalTransaction)
  }
})

test('membership refund combinations fail safely', async () => {
  const originalPaymentFindFirst = prisma.payment.findFirst
  const originalPaymentFindMany = prisma.payment.findMany
  const originalInvoiceFindUnique = prisma.invoice.findUnique

  try {
    ;(prisma.payment.findFirst as any) = async () => ({
      id: 'payment-1',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      invoiceId: 'invoice-1',
      amount: new Prisma.Decimal(49),
      status: PaymentStatus.PAID,
      stripePaymentIntentId: 'pi_1',
    })
    ;(prisma.payment.findMany as any) = async () => []
    ;(prisma.invoice.findUnique as any) = async () => ({
      id: 'invoice-1',
      items: [{ membershipId: 'membership-1', productId: null, packageId: null }],
    })

    await assert.rejects(
      () =>
        paymentService.refundPayment('payment-1', 'user-1', undefined, {
          clinicId: 'clinic-1',
        }),
      (err: any) => err?.code === 'membership_refund_unsupported' && err?.statusCode === 400
    )
  } finally {
    restore(prisma.payment, 'findFirst', originalPaymentFindFirst)
    restore(prisma.payment, 'findMany', originalPaymentFindMany)
    restore(prisma.invoice, 'findUnique', originalInvoiceFindUnique)
  }
})

test('package session is restored on appointment cancellation', async () => {
  const originalFindFirst = prisma.appointment.findFirst
  const originalUpdate = prisma.appointment.update
  const originalAuditLog = auditService.logAudit
  const originalSendCancellation = emailService.sendAppointmentCancellation
  const originalOfferWaitlist = waitlistService.offerSlotToWaitlist
  const originalReleasePackage = packageUsageService.releasePackageSession

  let releaseCalls = 0

  try {
    ;(prisma.appointment.findFirst as any) = async () => ({
      id: 'appointment-1',
      clinicId: 'clinic-1',
      providerId: 'provider-1',
      serviceId: 'service-1',
      locationId: 'location-1',
      status: 'CONFIRMED',
      priceAtBooking: new Prisma.Decimal(0),
      startTime: new Date('2026-03-20T10:00:00.000Z'),
      endTime: new Date('2026-03-20T10:30:00.000Z'),
      service: {
        name: 'Consultation',
        cancellationWindowHours: 24,
        cancellationFeeType: 'NONE',
        cancellationFeeValue: null,
      },
    })
    ;(prisma.appointment.update as any) = async () => ({
      id: 'appointment-1',
      clinic: { id: 'clinic-1', name: 'Clinic One' },
      location: { id: 'location-1', name: 'Online' },
      provider: { disciplines: [], user: { id: 'u1', name: 'Provider' } },
      service: { id: 'service-1', name: 'Consultation', duration: 30 },
      patient: { id: 'patient-1', name: 'Patient One', email: 'patient@example.com' },
      startTime: new Date('2026-03-20T10:00:00.000Z'),
      status: 'CANCELLED',
    })
    restore(auditService, 'logAudit', (async () => {}) as any)
    restore(emailService, 'sendAppointmentCancellation', (async () => {}) as any)
    restore(waitlistService, 'offerSlotToWaitlist', (async () => {}) as any)
    restore(packageUsageService, 'releasePackageSession', (async () => {
      releaseCalls += 1
      return { id: 'patient-package-1' }
    }) as any)

    await appointmentService.cancelAppointment(
      'appointment-1',
      'Patient requested cancellation',
      'user-1',
      { clinicId: 'clinic-1' }
    )

    assert.equal(releaseCalls, 1)
  } finally {
    restore(prisma.appointment, 'findFirst', originalFindFirst)
    restore(prisma.appointment, 'update', originalUpdate)
    restore(auditService, 'logAudit', originalAuditLog)
    restore(emailService, 'sendAppointmentCancellation', originalSendCancellation)
    restore(waitlistService, 'offerSlotToWaitlist', originalOfferWaitlist)
    restore(packageUsageService, 'releasePackageSession', originalReleasePackage)
  }
})
