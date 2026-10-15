import assert from 'node:assert/strict'
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import stripe from '../config/stripe'
import * as auditService from '../services/auditService'
import * as cartService from '../services/cartService'
import * as invoiceService from '../services/invoiceService'
import * as paymentService from '../services/paymentService'
import * as appointmentController from '../controllers/appointmentController'
import * as appointmentService from '../services/appointmentService'
import * as webhookController from '../controllers/webhookController'
import * as commissionService from '../services/commissionService'
import * as emailService from '../services/emailService'

// Module namespace exports are getter-only; redefine instead of assigning.
const restore = <T extends object, K extends keyof T>(object: T, key: K, value: T[K]) => {
  Object.defineProperty(object, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  })
}

test('invoice finalize and pay path updates statuses cleanly', async () => {
  const originalFindFirst = prisma.invoice.findFirst
  const originalFindUnique = prisma.invoice.findUnique
  const originalUpdate = prisma.invoice.update
  const originalPaymentCreate = prisma.payment.create
  const originalTransaction = prisma.$transaction
  const originalLogAudit = auditService.logAudit

  const updatedStatuses: string[] = []
  const payments: any[] = []

  try {
    let currentStatus = 'DRAFT'
    ;(prisma.invoice.findFirst as any) = async () => ({
      id: 'invoice-1',
      clinicId: 'clinic-1',
      status: currentStatus,
      totalAmount: new Prisma.Decimal(125),
      items: [{ id: 'item-1' }],
      payments,
      patientId: 'patient-1',
      providerId: null,
      appointmentId: null,
    })
    ;(prisma.invoice.findUnique as any) = async () => ({
      id: 'invoice-1',
      clinicId: 'clinic-1',
      status: currentStatus,
      totalAmount: new Prisma.Decimal(125),
      items: [],
      appointment: null,
      patient: null,
      provider: null,
      payments,
      patientId: 'patient-1',
      providerId: null,
      appointmentId: null,
    })
    ;(prisma.invoice.update as any) = async ({ data }: { data: { status: string } }) => {
      currentStatus = data.status
      updatedStatuses.push(data.status)
      return {
        id: 'invoice-1',
        clinicId: 'clinic-1',
        status: data.status,
        totalAmount: new Prisma.Decimal(125),
        items: [],
        appointment: null,
        patient: null,
        provider: null,
        payments,
      }
    }
    ;(prisma.payment.create as any) = async ({ data }: any) => {
      const payment = { id: 'payment-1', ...data }
      payments.push(payment)
      return payment
    }
    ;(prisma.$transaction as any) = async (callback: (tx: any) => Promise<any>) =>
      callback({
        payment: {
          create: prisma.payment.create,
        },
        invoice: {
          findUnique: prisma.invoice.findUnique,
          update: prisma.invoice.update,
        },
        appointment: {
          update: async () => null,
        },
      })
    restore(auditService, 'logAudit', (async () => {}) as any)

    const finalized = await invoiceService.finalizeInvoice('invoice-1', 'clinic-1', 'user-1')
    assert.equal(finalized.status, 'FINALIZED')

    const paid = await invoiceService.payInvoice('invoice-1', 'clinic-1', 'user-1')
    assert.equal(paid.status, 'PAID')
    assert.equal(payments.length, 1)
    assert.equal(payments[0].paymentChannel, 'MANUAL')
    assert.deepEqual(updatedStatuses, ['FINALIZED', 'PAID'])
  } finally {
    restore(prisma.invoice, 'findFirst', originalFindFirst)
    restore(prisma.invoice, 'findUnique', originalFindUnique)
    restore(prisma.invoice, 'update', originalUpdate)
    restore(prisma.payment, 'create', originalPaymentCreate)
    restore(prisma, '$transaction', originalTransaction)
    restore(auditService, 'logAudit', originalLogAudit)
  }
})

test('membership cart add is rejected because recurring linkage is not supported', async () => {
  const originalCartFindFirst = prisma.cart.findFirst

  try {
    // getOrCreateCart is called inside cartService, so mock the query it makes.
    ;(prisma.cart.findFirst as any) = async () => ({ id: 'cart-1', items: [] })

    await assert.rejects(
      () =>
        cartService.addToCart('clinic-1', 'patient-1', {
          itemType: 'MEMBERSHIP',
          itemId: 'membership-1',
        } as any),
      (err: any) => err?.statusCode === 400 && err?.code === 'membership_checkout_unsupported'
    )
  } finally {
    restore(prisma.cart, 'findFirst', originalCartFindFirst)
  }
})

test('cart checkout creates a finalized invoice and pending payment ledger row', async () => {
  const originalCartFindFirst = prisma.cart.findFirst
  const originalInvoiceCreate = prisma.invoice.create
  const originalRecalculate = invoiceService.recalculateInvoiceTotals
  const originalInvoiceFindUnique = prisma.invoice.findUnique
  const originalStripeCreate = stripe.paymentIntents.create
  const originalTransaction = prisma.$transaction
  const originalInvoiceUpdate = prisma.invoice.update
  const originalPaymentCreate = prisma.payment.create
  const originalCartUpdate = prisma.cart.update
  const originalProviderFindFirst = prisma.provider.findFirst

  let createdInvoiceProviderId: string | null | undefined
  let invoiceFinalized = false
  let paymentCreateCount = 0
  let cartCheckedOut = false

  try {
    ;(prisma.cart.findFirst as any) = async () => ({
      id: 'cart-1',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      status: 'ACTIVE',
      items: [
        {
          id: 'item-1',
          itemType: 'PRODUCT',
          quantity: 2,
          unitPrice: new Prisma.Decimal(50),
          productId: 'product-1',
          serviceId: null,
          packageId: null,
          membershipId: null,
        },
      ],
    })
    ;(prisma.invoice.create as any) = async ({ data }: any) => {
      createdInvoiceProviderId = data.providerId
      return { id: 'invoice-1' }
    }
    restore(invoiceService, 'recalculateInvoiceTotals', (async () => {}) as any)
    ;(prisma.invoice.findUnique as any) = async () => ({
      id: 'invoice-1',
      totalAmount: { toNumber: () => 100 },
    })
    ;(stripe.paymentIntents.create as any) = async () => ({
      id: 'pi_cart_1',
      client_secret: 'secret_1',
    })
    ;(prisma.invoice.update as any) = async () => {
      invoiceFinalized = true
      return { id: 'invoice-1' }
    }
    ;(prisma.payment.create as any) = async () => {
      paymentCreateCount += 1
      return { id: 'payment-1' }
    }
    ;(prisma.cart.update as any) = async () => {
      cartCheckedOut = true
      return { id: 'cart-1' }
    }
    ;(prisma.$transaction as any) = async (operations: any[]) => Promise.all(operations)
    // Invoices require a provider; cart checkout bills the clinic's first active provider.
    ;(prisma.provider.findFirst as any) = async () => ({ id: 'provider-1' })

    const result = await cartService.checkoutCart('clinic-1', 'patient-1')

    assert.equal(createdInvoiceProviderId, 'provider-1')
    assert.equal(result.clientSecret, 'secret_1')
    assert.equal(invoiceFinalized, true)
    assert.equal(paymentCreateCount, 1)
    assert.equal(cartCheckedOut, true)
  } finally {
    restore(prisma.cart, 'findFirst', originalCartFindFirst)
    restore(prisma.invoice, 'create', originalInvoiceCreate)
    restore(invoiceService, 'recalculateInvoiceTotals', originalRecalculate)
    restore(prisma.invoice, 'findUnique', originalInvoiceFindUnique)
    restore(stripe.paymentIntents, 'create', originalStripeCreate)
    restore(prisma, '$transaction', originalTransaction)
    restore(prisma.invoice, 'update', originalInvoiceUpdate)
    restore(prisma.payment, 'create', originalPaymentCreate)
    restore(prisma.cart, 'update', originalCartUpdate)
    restore(prisma.provider, 'findFirst', originalProviderFindFirst)
  }
})

test('cart webhook payment handling is idempotent and provisions sale side effects once', async () => {
  const originalPaymentFindUnique = prisma.payment.findUnique
  const originalPaymentFindFirst = prisma.payment.findFirst
  const originalPaymentUpdate = prisma.payment.update
  const originalInvoiceFindUnique = prisma.invoice.findUnique
  const originalInvoiceUpdate = prisma.invoice.update
  const originalInventoryUpdateMany = prisma.inventoryItem.updateMany
  const originalPackageFindUnique = prisma.package.findUnique
  const originalPatientPackageFindFirst = prisma.patientPackage.findFirst
  const originalPatientPackageCreate = prisma.patientPackage.create
  const originalCalculateCommissions = commissionService.calculateCommissions
  const originalSendInvoiceEmail = emailService.sendInvoiceEmail

  let paymentStatus: string | null = 'PENDING'
  let invoiceStatus: string = 'FINALIZED'
  let inventoryDecrements = 0
  let patientPackageCreates = 0
  let commissionCalls = 0
  let emailCalls = 0

  try {
    ;(prisma.payment.findUnique as any) = async ({
      where,
    }: {
      where: { stripePaymentIntentId: string }
    }) =>
      paymentStatus
        ? {
            id: 'payment-1',
            status: paymentStatus,
            stripePaymentIntentId: where.stripePaymentIntentId,
          }
        : null
    ;(prisma.payment.findFirst as any) = async () => ({
      id: 'payment-1',
      status: 'PENDING',
    })
    ;(prisma.payment.update as any) = async ({ data }: any) => {
      paymentStatus = data.status
      return { id: 'payment-1' }
    }
    ;(prisma.invoice.findUnique as any) = async () => ({
      id: 'invoice-1',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      status: invoiceStatus,
      totalAmount: 75,
      patient: { email: 'patient@example.com', name: 'Patient One' },
      items: [
        { id: 'item-1', productId: 'product-1', packageId: null, quantity: 2 },
        { id: 'item-2', productId: null, packageId: 'package-1', quantity: 1 },
      ],
    })
    ;(prisma.invoice.update as any) = async ({ data }: any) => {
      invoiceStatus = data.status
      return { id: 'invoice-1' }
    }
    ;(prisma.inventoryItem.updateMany as any) = async () => {
      inventoryDecrements += 1
      return { count: 1 }
    }
    ;(prisma.package.findUnique as any) = async () => ({
      id: 'package-1',
      totalSessions: 5,
      expiresInDays: 30,
    })
    ;(prisma.patientPackage.findFirst as any) = async () =>
      patientPackageCreates > 0 ? { id: 'pp-1' } : null
    ;(prisma.patientPackage.create as any) = async () => {
      patientPackageCreates += 1
      return { id: 'pp-1' }
    }
    restore(commissionService, 'calculateCommissions', (async () => {
      commissionCalls += 1
    }) as any)
    restore(emailService, 'sendInvoiceEmail', (async () => {
      emailCalls += 1
    }) as any)

    const event = {
      id: 'evt_1',
      metadata: {
        invoiceId: 'invoice-1',
        clinicId: 'clinic-1',
        patientId: 'patient-1',
      },
      idempotencyKey: 'same',
      client_secret: 'secret',
    }

    await webhookController.handleCartCheckoutPaymentIntentSucceeded({
      id: 'pi_cart_paid',
      metadata: event.metadata,
      client_secret: 'secret',
    })
    await webhookController.handleCartCheckoutPaymentIntentSucceeded({
      id: 'pi_cart_paid',
      metadata: event.metadata,
      client_secret: 'secret',
    })

    assert.equal(invoiceStatus, 'PAID')
    assert.equal(inventoryDecrements, 1)
    assert.equal(patientPackageCreates, 1)
    assert.equal(commissionCalls, 1)
    assert.equal(emailCalls, 1)
  } finally {
    restore(prisma.payment, 'findUnique', originalPaymentFindUnique)
    restore(prisma.payment, 'findFirst', originalPaymentFindFirst)
    restore(prisma.payment, 'update', originalPaymentUpdate)
    restore(prisma.invoice, 'findUnique', originalInvoiceFindUnique)
    restore(prisma.invoice, 'update', originalInvoiceUpdate)
    restore(prisma.inventoryItem, 'updateMany', originalInventoryUpdateMany)
    restore(prisma.package, 'findUnique', originalPackageFindUnique)
    restore(prisma.patientPackage, 'findFirst', originalPatientPackageFindFirst)
    restore(prisma.patientPackage, 'create', originalPatientPackageCreate)
    restore(commissionService, 'calculateCommissions', originalCalculateCommissions)
    restore(emailService, 'sendInvoiceEmail', originalSendInvoiceEmail)
  }
})

test('stripe-backed refund updates local ledger and restocks inventory', async () => {
  const originalPaymentFindFirst = prisma.payment.findFirst
  const originalPaymentFindMany = prisma.payment.findMany
  const originalInvoiceFindUnique = prisma.invoice.findUnique
  const originalUsageCount = prisma.packageSessionUsage.count
  const originalStripeRefundCreate = stripe.refunds.create
  const originalTransaction = prisma.$transaction
  const originalLogAudit = auditService.logAudit

  let invoiceCancelled = false
  let originalPaymentRefunded = false
  let refundRowCreated = false
  let inventoryRestocked = false
  let packageCancelled = false
  let commissionsCancelled = false
  const invoicePayments: any[] = [
    {
      id: 'payment-1',
      amount: new Prisma.Decimal(120),
      status: 'PAID',
      refundForPaymentId: null,
    },
  ]

  try {
    ;(prisma.payment.findFirst as any) = async () => ({
      id: 'payment-1',
      clinicId: 'clinic-1',
      providerId: null,
      invoiceId: 'invoice-1',
      appointmentId: null,
      patientId: 'patient-1',
      amount: new Prisma.Decimal(120),
      status: 'PAID',
      stripePaymentIntentId: 'pi_paid_1',
      paymentChannel: 'STRIPE',
      paymentMethod: 'CARD',
    })
    ;(prisma.payment.findMany as any) = async () => []
    ;(prisma.invoice.findUnique as any) = async () => ({
      id: 'invoice-1',
      items: [{ id: 'item-1', productId: 'product-1', quantity: 2 }],
    })
    ;(prisma.packageSessionUsage.count as any) = async () => 0
    ;(stripe.refunds.create as any) = async ({ payment_intent }: any) => {
      assert.equal(payment_intent, 'pi_paid_1')
      return { id: 're_1' }
    }
    ;(prisma.$transaction as any) = async (callback: (tx: any) => Promise<any>) =>
      callback({
        payment: {
          create: async ({ data }: any) => {
            refundRowCreated = true
            const refund = { id: 'refund-1', ...data }
            invoicePayments.push(refund)
            return refund
          },
          update: async () => {
            originalPaymentRefunded = true
            invoicePayments[0].status = 'REFUNDED'
            return { id: 'payment-1' }
          },
        },
        appointment: {
          update: async () => null,
        },
        invoice: {
          findUnique: async () => ({
            id: 'invoice-1',
            status: invoiceCancelled ? 'CANCELLED' : 'PAID',
            totalAmount: new Prisma.Decimal(120),
            payments: invoicePayments,
          }),
          update: async () => {
            invoiceCancelled = true
            return { id: 'invoice-1' }
          },
        },
        commissionRecord: {
          updateMany: async () => {
            commissionsCancelled = true
            return { count: 1 }
          },
        },
        invoiceItem: {
          findMany: async () => [{ productId: 'product-1', quantity: 2 }],
        },
        inventoryItem: {
          updateMany: async () => {
            inventoryRestocked = true
            return { count: 1 }
          },
        },
        patientPackage: {
          updateMany: async () => {
            packageCancelled = true
            return { count: 1 }
          },
        },
      })
    restore(auditService, 'logAudit', (async () => {}) as any)

    const result = await paymentService.refundPayment('payment-1', 'user-1', undefined, {
      clinicId: 'clinic-1',
    })

    assert.equal(refundRowCreated, true)
    assert.equal(originalPaymentRefunded, true)
    assert.equal(invoiceCancelled, true)
    assert.equal(inventoryRestocked, true)
    assert.equal(packageCancelled, true)
    assert.equal(commissionsCancelled, true)
    assert.equal((result.refund as any).id, 'refund-1')
  } finally {
    restore(prisma.payment, 'findFirst', originalPaymentFindFirst)
    restore(prisma.payment, 'findMany', originalPaymentFindMany)
    restore(prisma.invoice, 'findUnique', originalInvoiceFindUnique)
    restore(prisma.packageSessionUsage, 'count', originalUsageCount)
    restore(stripe.refunds, 'create', originalStripeRefundCreate)
    restore(prisma, '$transaction', originalTransaction)
    restore(auditService, 'logAudit', originalLogAudit)
  }
})

test('duplicate refund is rejected safely', async () => {
  const originalPaymentFindFirst = prisma.payment.findFirst
  const originalPaymentFindMany = prisma.payment.findMany

  try {
    let refundLookupCount = 0
    ;(prisma.payment.findFirst as any) = async () => ({
      id: 'payment-1',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      amount: 100,
      status: 'PAID',
      stripePaymentIntentId: 'pi_1',
    })
    ;(prisma.payment.findMany as any) = async () => {
      refundLookupCount += 1
      return [{ id: 'refund-existing', status: 'REFUNDED', amount: -100 }]
    }

    await assert.rejects(
      () =>
        paymentService.refundPayment('payment-1', 'user-1', undefined, {
          clinicId: 'clinic-1',
        }),
      (err: any) => err?.code === 'already_refunded' && err?.statusCode === 400
    )
    assert.equal(refundLookupCount, 1)
  } finally {
    restore(prisma.payment, 'findFirst', originalPaymentFindFirst)
    restore(prisma.payment, 'findMany', originalPaymentFindMany)
  }
})

test('partial refund succeeds within remaining refundable amount for service-only invoice', async () => {
  const originalPaymentFindFirst = prisma.payment.findFirst
  const originalPaymentFindMany = prisma.payment.findMany
  const originalInvoiceFindUnique = prisma.invoice.findUnique
  const originalUsageCount = prisma.packageSessionUsage.count
  const originalStripeRefundCreate = stripe.refunds.create
  const originalTransaction = prisma.$transaction
  const originalLogAudit = auditService.logAudit

  let originalPaymentStatus = 'PAID'
  let refundAmountCreated = 0
  let commissionsCancelled = false
  let inventoryTouched = false
  let packageTouched = false

  try {
    ;(prisma.payment.findFirst as any) = async () => ({
      id: 'payment-1',
      clinicId: 'clinic-1',
      providerId: 'provider-1',
      invoiceId: 'invoice-1',
      appointmentId: null,
      patientId: 'patient-1',
      amount: new Prisma.Decimal(100),
      status: 'PAID',
      stripePaymentIntentId: 'pi_1',
      paymentChannel: 'STRIPE',
      paymentMethod: 'CARD',
    })
    ;(prisma.payment.findMany as any) = async () => []
    ;(prisma.invoice.findUnique as any) = async () => ({
      id: 'invoice-1',
      items: [
        { id: 'item-1', serviceId: 'service-1', productId: null, packageId: null, quantity: 1 },
      ],
    })
    ;(prisma.packageSessionUsage.count as any) = async () => 0
    ;(stripe.refunds.create as any) = async ({ amount }: any) => {
      assert.equal(amount, 3000)
      return { id: 're_partial_1' }
    }
    ;(prisma.$transaction as any) = async (callback: (tx: any) => Promise<any>) =>
      callback({
        payment: {
          create: async ({ data }: any) => {
            refundAmountCreated = Number(data.amount)
            return { id: 'refund-1', ...data }
          },
          update: async ({ data }: any) => {
            originalPaymentStatus = data.status
            return { id: 'payment-1' }
          },
        },
        appointment: {
          update: async () => null,
        },
        invoice: {
          findUnique: async () => ({
            id: 'invoice-1',
            status: 'FINALIZED',
            totalAmount: new Prisma.Decimal(100),
            payments: [
              {
                amount: new Prisma.Decimal(100),
                status: originalPaymentStatus,
                refundForPaymentId: null,
              },
              {
                amount: new Prisma.Decimal(-30),
                status: 'REFUNDED',
                refundForPaymentId: 'payment-1',
              },
            ],
          }),
          update: async () => ({ id: 'invoice-1' }),
        },
        commissionRecord: {
          updateMany: async () => {
            commissionsCancelled = true
            return { count: 1 }
          },
        },
        invoiceItem: {
          findMany: async () => [],
        },
        inventoryItem: {
          updateMany: async () => {
            inventoryTouched = true
            return { count: 1 }
          },
        },
        patientPackage: {
          updateMany: async () => {
            packageTouched = true
            return { count: 1 }
          },
        },
      })
    restore(auditService, 'logAudit', (async () => {}) as any)

    const result = await paymentService.refundPayment('payment-1', 'user-1', 30, {
      clinicId: 'clinic-1',
    })

    assert.equal(Number(result.refund.amount), -30)
    assert.equal(refundAmountCreated, -30)
    assert.equal(originalPaymentStatus, 'PARTIALLY_REFUNDED')
    assert.equal(commissionsCancelled, false)
    assert.equal(inventoryTouched, false)
    assert.equal(packageTouched, false)
  } finally {
    restore(prisma.payment, 'findFirst', originalPaymentFindFirst)
    restore(prisma.payment, 'findMany', originalPaymentFindMany)
    restore(prisma.invoice, 'findUnique', originalInvoiceFindUnique)
    restore(prisma.packageSessionUsage, 'count', originalUsageCount)
    restore(stripe.refunds, 'create', originalStripeRefundCreate)
    restore(prisma, '$transaction', originalTransaction)
    restore(auditService, 'logAudit', originalLogAudit)
  }
})

test('over-refund is rejected safely', async () => {
  const originalPaymentFindFirst = prisma.payment.findFirst
  const originalPaymentFindMany = prisma.payment.findMany

  try {
    ;(prisma.payment.findFirst as any) = async () => ({
      id: 'payment-1',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      amount: new Prisma.Decimal(100),
      status: 'PAID',
      stripePaymentIntentId: 'pi_1',
    })
    ;(prisma.payment.findMany as any) = async () => [
      { id: 'refund-1', amount: new Prisma.Decimal(-40), status: 'REFUNDED' },
    ]

    await assert.rejects(
      () =>
        paymentService.refundPayment('payment-1', 'user-1', 70, {
          clinicId: 'clinic-1',
        }),
      (err: any) => err?.code === 'over_refund' && err?.statusCode === 400
    )
  } finally {
    restore(prisma.payment, 'findFirst', originalPaymentFindFirst)
    restore(prisma.payment, 'findMany', originalPaymentFindMany)
  }
})

test('manual invoice payment records ledger state and leaves partial balance visible', async () => {
  const originalFindFirst = prisma.invoice.findFirst
  const originalFindUnique = prisma.invoice.findUnique
  const originalPaymentCreate = prisma.payment.create
  const originalTransaction = prisma.$transaction
  const originalLogAudit = auditService.logAudit

  const payments: any[] = []

  try {
    ;(prisma.invoice.findFirst as any) = async () => ({
      id: 'invoice-1',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      providerId: null,
      appointmentId: null,
      status: 'FINALIZED',
      totalAmount: new Prisma.Decimal(100),
      payments,
    })
    ;(prisma.invoice.findUnique as any) = async () => ({
      id: 'invoice-1',
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      providerId: null,
      appointmentId: null,
      status: 'FINALIZED',
      totalAmount: new Prisma.Decimal(100),
      items: [],
      appointment: null,
      patient: null,
      provider: null,
      payments,
    })
    ;(prisma.payment.create as any) = async ({ data }: any) => {
      const payment = { id: `payment-${payments.length + 1}`, ...data }
      payments.push(payment)
      return payment
    }
    ;(prisma.$transaction as any) = async (callback: (tx: any) => Promise<any>) =>
      callback({
        payment: {
          create: prisma.payment.create,
        },
        invoice: {
          findUnique: prisma.invoice.findUnique,
          update: async () => ({ id: 'invoice-1' }),
        },
        appointment: {
          update: async () => null,
        },
      })
    restore(auditService, 'logAudit', (async () => {}) as any)

    const result = await invoiceService.recordInvoiceManualPayment(
      'invoice-1',
      'clinic-1',
      'front-desk-1',
      { amount: 40, paymentMethod: 'CASH', notes: 'Collected at desk' }
    )

    assert.equal(result.payment.paymentChannel, 'MANUAL')
    assert.equal(result.payment.paymentMethod, 'CASH')
    assert.equal(result.invoice?.financialStatus, 'PARTIALLY_PAID')
    assert.equal(Number(result.invoice?.totalPaid), 40)
    assert.equal(Number(result.invoice?.outstandingAmount), 60)
  } finally {
    restore(prisma.invoice, 'findFirst', originalFindFirst)
    restore(prisma.invoice, 'findUnique', originalFindUnique)
    restore(prisma.payment, 'create', originalPaymentCreate)
    restore(prisma, '$transaction', originalTransaction)
    restore(auditService, 'logAudit', originalLogAudit)
  }
})

test('receivables summary computes outstanding and partial states from invoice ledger', async () => {
  const originalFindMany = prisma.invoice.findMany

  try {
    ;(prisma.invoice.findMany as any) = async () => [
      {
        id: 'invoice-unpaid',
        status: 'FINALIZED',
        totalAmount: new Prisma.Decimal(100),
        payments: [],
      },
      {
        id: 'invoice-partial',
        status: 'FINALIZED',
        totalAmount: new Prisma.Decimal(100),
        payments: [{ amount: new Prisma.Decimal(25), status: 'PAID' }],
      },
      {
        id: 'invoice-refunded',
        status: 'CANCELLED',
        totalAmount: new Prisma.Decimal(100),
        payments: [
          { amount: new Prisma.Decimal(100), status: 'REFUNDED' },
          { amount: new Prisma.Decimal(-100), status: 'REFUNDED' },
        ],
      },
    ]

    const summary = await invoiceService.getClinicReceivablesSummary('clinic-1')

    assert.equal(Number(summary.totalOutstandingAmount), 175)
    assert.equal(summary.outstandingInvoiceCount, 2)
    assert.equal(summary.unpaidCount, 1)
    assert.equal(summary.partiallyPaidCount, 1)
    assert.equal(summary.refundedCount, 1)
  } finally {
    restore(prisma.invoice, 'findMany', originalFindMany)
  }
})

test('appointment payment webhook is idempotent across repeated success events', async () => {
  const originalAppointmentFindUnique = prisma.appointment.findUnique
  const originalAppointmentUpdate = prisma.appointment.update
  const originalInvoiceFindFirst = prisma.invoice.findFirst
  const originalInvoiceUpdate = prisma.invoice.update
  const originalPaymentFindUnique = prisma.payment.findUnique
  const originalPaymentFindFirst = prisma.payment.findFirst
  const originalPaymentUpdate = prisma.payment.update
  const originalPaymentCreate = prisma.payment.create
  const originalSendConfirmation = emailService.sendAppointmentConfirmation
  const originalCalculateCommissions = commissionService.calculateCommissions

  let appointmentPaymentStatus = 'PENDING'
  let appointmentStatus = 'PENDING_PAYMENT'
  let invoiceStatus = 'FINALIZED'
  let existingIntentPaid = false
  let paymentUpdates = 0
  let paymentCreates = 0
  let appointmentUpdates = 0
  let invoiceUpdates = 0
  let emailCalls = 0
  let commissionCalls = 0

  try {
    ;(prisma.appointment.findUnique as any) = async () => ({
      id: 'appointment-1',
      clinicId: 'clinic-1',
      providerId: 'provider-1',
      patientId: 'patient-1',
      serviceId: 'service-1',
      paymentRequirementType: 'FULL',
      depositAmount: null,
      priceAtBooking: new Prisma.Decimal(75),
      approvalStatus: 'APPROVED',
      paymentStatus: appointmentPaymentStatus,
      status: appointmentStatus,
      startTime: new Date('2026-03-12T10:00:00.000Z'),
      service: { name: 'Consultation' },
      patient: { email: 'patient@example.com', name: 'Patient One' },
      provider: { firstName: 'Abhi', lastName: 'Verma', user: { name: 'Abhi Verma' } },
      location: { name: 'Online' },
    })
    ;(prisma.invoice.findFirst as any) = async () => ({
      id: 'invoice-1',
      status: invoiceStatus,
    })
    ;(prisma.payment.findUnique as any) = async () =>
      existingIntentPaid ? { id: 'payment-1', status: 'PAID', stripePaymentIntentId: 'pi_1' } : null
    ;(prisma.payment.findFirst as any) = async () => ({
      id: 'payment-1',
      status: existingIntentPaid ? 'PAID' : 'PENDING',
      paymentChannel: 'STRIPE',
      paymentMethod: 'CARD',
      recordedAt: null,
    })
    ;(prisma.payment.update as any) = async () => {
      existingIntentPaid = true
      paymentUpdates += 1
      return { id: 'payment-1' }
    }
    ;(prisma.payment.create as any) = async () => {
      paymentCreates += 1
      return { id: 'payment-created' }
    }
    ;(prisma.appointment.update as any) = async () => {
      appointmentPaymentStatus = 'PAID'
      appointmentStatus = 'CONFIRMED'
      appointmentUpdates += 1
      return { id: 'appointment-1' }
    }
    ;(prisma.invoice.update as any) = async () => {
      invoiceStatus = 'PAID'
      invoiceUpdates += 1
      return { id: 'invoice-1' }
    }
    restore(emailService, 'sendAppointmentConfirmation', (async () => {
      emailCalls += 1
    }) as any)
    restore(commissionService, 'calculateCommissions', (async () => {
      commissionCalls += 1
    }) as any)

    await webhookController.handleAppointmentPaymentIntentSucceeded({
      id: 'pi_1',
      metadata: { appointmentId: 'appointment-1' },
      client_secret: 'secret_1',
    })
    await webhookController.handleAppointmentPaymentIntentSucceeded({
      id: 'pi_1',
      metadata: { appointmentId: 'appointment-1' },
      client_secret: 'secret_1',
    })

    assert.equal(paymentUpdates, 1)
    assert.equal(paymentCreates, 0)
    assert.equal(appointmentUpdates, 1)
    assert.equal(invoiceUpdates, 1)
    assert.equal(emailCalls, 1)
    assert.equal(commissionCalls, 1)
  } finally {
    restore(prisma.appointment, 'findUnique', originalAppointmentFindUnique)
    restore(prisma.appointment, 'update', originalAppointmentUpdate)
    restore(prisma.invoice, 'findFirst', originalInvoiceFindFirst)
    restore(prisma.invoice, 'update', originalInvoiceUpdate)
    restore(prisma.payment, 'findUnique', originalPaymentFindUnique)
    restore(prisma.payment, 'findFirst', originalPaymentFindFirst)
    restore(prisma.payment, 'update', originalPaymentUpdate)
    restore(prisma.payment, 'create', originalPaymentCreate)
    restore(emailService, 'sendAppointmentConfirmation', originalSendConfirmation)
    restore(commissionService, 'calculateCommissions', originalCalculateCommissions)
  }
})

test('appointment controller forwards patientPackageId into booking context', async () => {
  const originalCreateAppointment = appointmentService.createAppointment

  let receivedContext: any = null

  try {
    restore(appointmentService, 'createAppointment', (async (
      _data: any,
      _clinicId: string,
      context: any
    ) => {
      receivedContext = context
      return { appointment: { id: 'appointment-1' } }
    }) as any)

    const req: any = {
      clinicId: 'clinic-1',
      body: {
        providerId: 'provider-1',
        serviceId: 'service-1',
        startTime: '2026-03-12T10:00:00.000Z',
        endTime: '2026-03-12T10:30:00.000Z',
        patientPackageId: 'package-use-1',
      },
      user: {
        id: 'patient-1',
        role: 'PATIENT',
      },
    }
    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json() {
        return this
      },
    }

    // asyncHandler returns void; let the wrapped handler settle before asserting.
    appointmentController.create(req, res, () => {})
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(receivedContext?.patientPackageId, 'package-use-1')
  } finally {
    restore(appointmentService, 'createAppointment', originalCreateAppointment)
  }
})

test('commission creation happens once per paid invoice item', async () => {
  const originalInvoiceFindUnique = prisma.invoice.findUnique
  const originalRulesFindMany = prisma.commissionRule.findMany
  const originalRecordFindFirst = prisma.commissionRecord.findFirst
  const originalRecordCreate = prisma.commissionRecord.create

  let createCount = 0

  try {
    ;(prisma.invoice.findUnique as any) = async () => ({
      id: 'invoice-1',
      clinicId: 'clinic-1',
      status: 'PAID',
      items: [
        {
          id: 'item-1',
          providerId: 'provider-1',
          serviceId: 'service-1',
          productId: null,
          packageId: null,
          totalPrice: 100,
        },
      ],
    })
    ;(prisma.commissionRule.findMany as any) = async () => [
      {
        id: 'rule-1',
        clinicId: 'clinic-1',
        providerId: 'provider-1',
        serviceId: 'service-1',
        productId: null,
        packageId: null,
        itemType: 'ALL',
        commissionType: 'PERCENTAGE',
        commissionValue: 10,
      },
    ]
    ;(prisma.commissionRecord.findFirst as any) = async () =>
      createCount > 0 ? { id: 'existing' } : null
    ;(prisma.commissionRecord.create as any) = async () => {
      createCount += 1
      return { id: 'record-1' }
    }

    await commissionService.calculateCommissions('invoice-1')
    await commissionService.calculateCommissions('invoice-1')

    assert.equal(createCount, 1)
  } finally {
    restore(prisma.invoice, 'findUnique', originalInvoiceFindUnique)
    restore(prisma.commissionRule, 'findMany', originalRulesFindMany)
    restore(prisma.commissionRecord, 'findFirst', originalRecordFindFirst)
    restore(prisma.commissionRecord, 'create', originalRecordCreate)
  }
})
