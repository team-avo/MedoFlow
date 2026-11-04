/**
 * Booking transactions under a slow (cross-region) database.
 *
 * - The slot hold reads availability on its own transaction connection, not
 *   on the global client (each global read is a separate RLS-wrapped
 *   transaction on another pooled connection).
 * - Stripe is called after the booking transaction commits.
 * - Interactive transactions default to a 15 s timeout, configurable by env.
 */
import assert from 'node:assert/strict'
import { PaymentStatus, Prisma } from '@prisma/client'
import prisma, { interactiveTransactionOptions } from '../config/prisma'
import stripe from '../config/stripe'
import * as slotHoldService from '../services/slotHoldService'
import * as appointmentService from '../services/appointmentService'

// Module namespace exports are getter-only; redefine instead of assigning.
const restore = <T extends object, K extends keyof T>(object: T, key: K, value: T[K]) => {
  Object.defineProperty(object, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  })
}

// Inside the booking window (minimum notice 0, max 365 days).
const inThirtyDays = (() => {
  const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  start.setUTCHours(10, 0, 0, 0)
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
  }
})()

const globalClientUsed = (what: string) => async () => {
  throw new Error(`global prisma.${what} used inside the transaction`)
}

describe('interactiveTransactionOptions', () => {
  it('defaults to maxWait 5 s and timeout 15 s', () => {
    assert.deepEqual(interactiveTransactionOptions({}), { maxWait: 5000, timeout: 15000 })
  })

  it('reads PRISMA_TX_MAX_WAIT_MS / PRISMA_TX_TIMEOUT_MS', () => {
    assert.deepEqual(
      interactiveTransactionOptions({
        PRISMA_TX_MAX_WAIT_MS: '8000',
        PRISMA_TX_TIMEOUT_MS: '30000',
      }),
      { maxWait: 8000, timeout: 30000 }
    )
  })

  it('ignores invalid values', () => {
    assert.deepEqual(
      interactiveTransactionOptions({ PRISMA_TX_MAX_WAIT_MS: 'abc', PRISMA_TX_TIMEOUT_MS: '-1' }),
      { maxWait: 5000, timeout: 15000 }
    )
  })
})

test('createSlotHold reads availability and writes its audit row on the transaction only', async () => {
  const originals = {
    transaction: prisma.$transaction,
    providerFindFirst: prisma.provider.findFirst,
    appointmentFindMany: prisma.appointment.findMany,
    slotHoldFindMany: prisma.slotHold.findMany,
    unavailabilityFindMany: prisma.providerUnavailability.findMany,
    auditCreate: prisma.auditLog.create,
  }
  const txCalls: string[] = []
  try {
    ;(prisma.provider.findFirst as any) = globalClientUsed('provider.findFirst')
    ;(prisma.appointment.findMany as any) = globalClientUsed('appointment.findMany')
    ;(prisma.slotHold.findMany as any) = globalClientUsed('slotHold.findMany')
    ;(prisma.providerUnavailability.findMany as any) = globalClientUsed(
      'providerUnavailability.findMany'
    )
    ;(prisma.auditLog.create as any) = globalClientUsed('auditLog.create')

    const tx = {
      $executeRaw: async () => 0,
      service: {
        findUnique: async () => {
          txCalls.push('service.findUnique')
          return { duration: 30 }
        },
      },
      provider: {
        findFirst: async () => {
          txCalls.push('provider.findFirst')
          return {
            id: 'provider-1',
            clinicId: 'clinic-1',
            isActive: true,
            bufferMinutes: 0,
            // Every weekday under either numbering, 09:00–17:00, any location.
            providerAvailability: [0, 1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
              weekday,
              locationId: null,
              startTime: '09:00',
              endTime: '17:00',
            })),
            locationAssignments: [{ locationId: 'loc-1', location: { timezone: 'UTC' } }],
            providerServices: [{ serviceId: 'service-1' }],
          }
        },
      },
      appointment: {
        findMany: async () => {
          txCalls.push('appointment.findMany')
          return []
        },
      },
      slotHold: {
        findMany: async () => {
          txCalls.push('slotHold.findMany')
          return []
        },
        create: async ({ data }: any) => {
          txCalls.push('slotHold.create')
          return { id: 'hold-1', ...data }
        },
      },
      providerUnavailability: {
        findMany: async () => {
          txCalls.push('providerUnavailability.findMany')
          return []
        },
      },
      auditLog: {
        create: async () => {
          txCalls.push('auditLog.create')
          return null
        },
      },
    }
    ;(prisma.$transaction as any) = async (callback: (tx: any) => Promise<any>) => callback(tx)

    const hold = await slotHoldService.createSlotHold({
      clinicId: 'clinic-1',
      providerId: 'provider-1',
      serviceId: 'service-1',
      locationId: 'loc-1',
      timezone: 'UTC',
      startTime: new Date('2099-01-05T10:00:00.000Z'),
      endTime: new Date('2099-01-05T10:30:00.000Z'),
      performedById: 'staff-1',
    })

    assert.equal(hold.id, 'hold-1')
    assert.equal(hold.status, 'ACTIVE')
    assert.deepEqual([...txCalls].sort(), [
      'appointment.findMany',
      'auditLog.create',
      'provider.findFirst',
      'providerUnavailability.findMany',
      'service.findUnique',
      'slotHold.create',
      'slotHold.findMany',
    ])
  } finally {
    restore(prisma, '$transaction', originals.transaction)
    restore(prisma.provider, 'findFirst', originals.providerFindFirst)
    restore(prisma.appointment, 'findMany', originals.appointmentFindMany)
    restore(prisma.slotHold, 'findMany', originals.slotHoldFindMany)
    restore(prisma.providerUnavailability, 'findMany', originals.unavailabilityFindMany)
    restore(prisma.auditLog, 'create', originals.auditCreate)
  }
})

test('createAppointment calls Stripe only after the booking transaction commits', async () => {
  const originals = {
    transaction: prisma.$transaction,
    paymentCreate: prisma.payment.create,
    intentCreate: stripe.paymentIntents.create,
  }
  const events: string[] = []
  let paymentData: any = null
  try {
    const tx = {
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
        create: async ({ data }: any) => ({ id: 'appointment-1', ...data }),
      },
      patientSubscription: { findMany: async () => [] },
      auditLog: { create: async () => null },
      payment: {
        create: async () => {
          events.push('tx.payment.create')
          return null
        },
      },
    }
    ;(prisma.$transaction as any) = async (callback: (tx: any) => Promise<any>) => {
      const result = await callback(tx)
      events.push('commit')
      return result
    }
    ;(stripe.paymentIntents.create as any) = async ({ amount }: any) => {
      events.push(`stripe:${amount}`)
      return { id: 'pi_1', client_secret: 'cs_1' }
    }
    ;(prisma.payment.create as any) = async ({ data }: any) => {
      events.push('payment.create')
      paymentData = data
      return { id: 'payment-1', ...data }
    }

    const result = await appointmentService.createAppointment(
      {
        providerId: 'provider-1',
        serviceId: 'service-1',
        patientId: 'patient-1',
        startTime: inThirtyDays.start,
        endTime: inThirtyDays.end,
      },
      'clinic-1'
    )

    assert.deepEqual(events, ['commit', 'stripe:10000', 'payment.create'])
    assert.equal(result.clientSecret, 'cs_1')
    assert.equal(result.appointment.id, 'appointment-1')
    assert.equal(paymentData.appointmentId, 'appointment-1')
    assert.equal(paymentData.amount, 100)
    assert.equal(paymentData.status, PaymentStatus.PENDING)
    assert.equal(paymentData.stripePaymentIntentId, 'pi_1')
  } finally {
    restore(prisma, '$transaction', originals.transaction)
    restore(prisma.payment, 'create', originals.paymentCreate)
    restore(stripe.paymentIntents, 'create', originals.intentCreate)
  }
})

test('a Stripe failure after commit still returns the booked appointment (PENDING_PAYMENT)', async () => {
  const originals = {
    transaction: prisma.$transaction,
    paymentCreate: prisma.payment.create,
    intentCreate: stripe.paymentIntents.create,
  }
  try {
    const tx = {
      $executeRaw: async () => 0,
      service: {
        findFirst: async () => ({
          id: 'service-1',
          clinicId: 'clinic-1',
          defaultPrice: new Prisma.Decimal(100),
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
            { priceOverride: null, service: { defaultPrice: new Prisma.Decimal(100) } },
          ],
        }),
      },
      location: { findFirst: async () => ({ id: 'location-1', timezone: 'UTC' }) },
      providerLocationAssignment: { findFirst: async () => ({ id: 'pla-1' }) },
      user: { findUnique: async () => ({ id: 'patient-1', role: 'PATIENT' }) },
      patientClinicMembership: { upsert: async () => ({}) },
      appointment: {
        findFirst: async () => null,
        create: async ({ data }: any) => ({ id: 'appointment-1', ...data }),
      },
      slotHold: { findFirst: async () => null },
      patientSubscription: { findMany: async () => [] },
      auditLog: { create: async () => null },
    }
    ;(prisma.$transaction as any) = async (callback: (tx: any) => Promise<any>) => callback(tx)
    ;(stripe.paymentIntents.create as any) = async () => {
      throw new Error('stripe down')
    }
    ;(prisma.payment.create as any) = async () => {
      throw new Error('no payment row without an intent')
    }

    const result = await appointmentService.createAppointment(
      {
        providerId: 'provider-1',
        serviceId: 'service-1',
        patientId: 'patient-1',
        startTime: inThirtyDays.start,
        endTime: inThirtyDays.end,
      },
      'clinic-1'
    )

    assert.equal(result.clientSecret, undefined)
    assert.equal(result.appointment.id, 'appointment-1')
    assert.equal(result.appointment.paymentStatus, PaymentStatus.PENDING)
  } finally {
    restore(prisma, '$transaction', originals.transaction)
    restore(prisma.payment, 'create', originals.paymentCreate)
    restore(stripe.paymentIntents, 'create', originals.intentCreate)
  }
})
