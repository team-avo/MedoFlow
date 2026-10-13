import assert from 'node:assert/strict'
import { AppointmentStatus, Prisma, Role } from '@prisma/client'
import prisma from '../config/prisma'
import * as analyticsService from '../services/analyticsService'
import * as analyticsController from '../controllers/analyticsController'

// Module namespace exports are getter-only; redefine instead of assigning.
const restore = <T extends object, K extends keyof T>(object: T, key: K, value: T[K]) => {
  Object.defineProperty(object, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  })
}

test('parseAnalyticsDateRange defaults to the last 30 days', () => {
  const range = analyticsService.parseAnalyticsDateRange()
  const diffDays = Math.round(
    (range.dateTo.getTime() - range.dateFrom.getTime()) / (1000 * 60 * 60 * 24)
  )
  assert.equal(diffDays, 30)
})

test('provider analytics scope always resolves to the authenticated provider', async () => {
  const originalFindUnique = prisma.provider.findUnique

  try {
    ;(prisma.provider.findUnique as any) = async ({ where }: any) => {
      assert.equal(where.userId, 'user-1')
      return { id: 'provider-1' }
    }

    const scope = await analyticsService.resolveAnalyticsScope({
      clinicId: 'clinic-1',
      role: Role.PROVIDER,
      userId: 'user-1',
      requestedProviderId: 'provider-999',
    })

    assert.equal(scope.providerId, 'provider-1')
  } finally {
    restore(prisma.provider, 'findUnique', originalFindUnique)
  }
})

test('aggregate analytics computes finance, rates, patient value, and utilization from real ledger inputs', async () => {
  const originalAppointmentFindMany = prisma.appointment.findMany
  const originalProviderFindMany = prisma.provider.findMany
  const originalInvoiceFindMany = prisma.invoice.findMany
  const originalCommissionFindMany = prisma.commissionRecord.findMany
  const originalSubscriptionFindMany = prisma.patientSubscription.findMany
  const originalPackageFindMany = prisma.patientPackage.findMany
  const originalWaitlistFindMany = prisma.waitlistEntry.findMany
  const originalAppointmentCount = prisma.appointment.count
  const originalCartCount = prisma.cart.count

  try {
    ;(prisma.appointment.findMany as any) = async ({ where, select }: any) => {
      if (select?.patientId) {
        return [
          {
            id: 'historic-1',
            patientId: 'patient-1',
            providerId: 'provider-1',
            startTime: new Date('2026-01-10T10:00:00.000Z'),
            endTime: new Date('2026-01-10T10:30:00.000Z'),
            serviceId: 'service-1',
          },
          {
            id: 'historic-2',
            patientId: 'patient-1',
            providerId: 'provider-1',
            startTime: new Date('2026-03-10T10:00:00.000Z'),
            endTime: new Date('2026-03-10T10:30:00.000Z'),
            serviceId: 'service-1',
          },
          {
            id: 'historic-3',
            patientId: 'patient-2',
            providerId: 'provider-1',
            startTime: new Date('2025-10-01T10:00:00.000Z'),
            endTime: new Date('2025-10-01T10:30:00.000Z'),
            serviceId: 'service-1',
          },
        ]
      }

      assert.equal(where.providerId, 'provider-1')
      return [
        {
          id: 'appt-1',
          clinicId: 'clinic-1',
          providerId: 'provider-1',
          patientId: 'patient-1',
          startTime: new Date('2026-03-10T10:00:00.000Z'),
          endTime: new Date('2026-03-10T10:30:00.000Z'),
          status: AppointmentStatus.COMPLETED,
          provider: { id: 'provider-1', firstName: 'Ada', lastName: 'Lovelace' },
          service: { id: 'service-1', name: 'Consult', disciplineId: 'discipline-1' },
          patient: { id: 'patient-1', name: 'Patient One', email: 'one@example.com' },
        },
        {
          id: 'appt-2',
          clinicId: 'clinic-1',
          providerId: 'provider-1',
          patientId: 'patient-2',
          startTime: new Date('2026-03-11T10:00:00.000Z'),
          endTime: new Date('2026-03-11T11:00:00.000Z'),
          status: AppointmentStatus.CANCELLED,
          provider: { id: 'provider-1', firstName: 'Ada', lastName: 'Lovelace' },
          service: { id: 'service-1', name: 'Consult', disciplineId: 'discipline-1' },
          patient: { id: 'patient-2', name: 'Patient Two', email: 'two@example.com' },
        },
        {
          id: 'appt-3',
          clinicId: 'clinic-1',
          providerId: 'provider-1',
          patientId: 'patient-3',
          startTime: new Date('2026-03-12T10:00:00.000Z'),
          endTime: new Date('2026-03-12T10:45:00.000Z'),
          status: AppointmentStatus.NO_SHOW,
          provider: { id: 'provider-1', firstName: 'Ada', lastName: 'Lovelace' },
          service: { id: 'service-1', name: 'Consult', disciplineId: 'discipline-1' },
          patient: { id: 'patient-3', name: 'Patient Three', email: 'three@example.com' },
        },
      ]
    }
    ;(prisma.provider.findMany as any) = async () => [
      {
        id: 'provider-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        providerAvailability: [
          { weekday: 1, startTime: '09:00', endTime: '12:00' },
          { weekday: 2, startTime: '09:00', endTime: '12:00' },
          { weekday: 3, startTime: '09:00', endTime: '12:00' },
        ],
      },
    ]
    ;(prisma.invoice.findMany as any) = async ({ where, include }: any) => {
      if (include?.patient && include?.payments && !include?.items) {
        return [
          {
            id: 'ltv-1',
            clinicId: 'clinic-1',
            patientId: 'patient-1',
            patient: { id: 'patient-1', name: 'Patient One', email: 'one@example.com' },
            status: 'PAID',
            totalAmount: new Prisma.Decimal(100),
            createdAt: new Date('2026-03-10T00:00:00.000Z'),
            payments: [{ amount: new Prisma.Decimal(100), status: 'PAID' }],
            items: [],
          },
          {
            id: 'ltv-2',
            clinicId: 'clinic-1',
            patientId: 'patient-2',
            patient: { id: 'patient-2', name: 'Patient Two', email: 'two@example.com' },
            status: 'PAID',
            totalAmount: new Prisma.Decimal(50),
            createdAt: new Date('2026-03-11T00:00:00.000Z'),
            payments: [{ amount: new Prisma.Decimal(50), status: 'PAID' }],
            items: [],
          },
        ]
      }

      assert.equal(where.providerId, 'provider-1')
      return [
        {
          id: 'invoice-1',
          clinicId: 'clinic-1',
          patientId: 'patient-1',
          providerId: 'provider-1',
          appointmentId: 'appt-1',
          status: 'PAID',
          totalAmount: new Prisma.Decimal(100),
          createdAt: new Date('2026-03-10T00:00:00.000Z'),
          payments: [
            {
              amount: new Prisma.Decimal(100),
              status: 'PAID',
              paymentChannel: 'STRIPE',
              paymentMethod: 'CARD',
            },
          ],
          items: [
            {
              totalPrice: new Prisma.Decimal(80),
              quantity: 1,
              serviceId: 'service-1',
              productId: null,
              packageId: null,
              membershipId: null,
              disciplineId: 'discipline-1',
              service: { id: 'service-1', name: 'Consult' },
              product: null,
              package: null,
              membership: null,
            },
            {
              totalPrice: new Prisma.Decimal(20),
              quantity: 1,
              serviceId: null,
              productId: 'product-1',
              packageId: null,
              membershipId: null,
              disciplineId: null,
              service: null,
              product: { id: 'product-1', name: 'Vitamin' },
              package: null,
              membership: null,
            },
          ],
          patient: { id: 'patient-1', name: 'Patient One', email: 'one@example.com' },
          provider: { id: 'provider-1', firstName: 'Ada', lastName: 'Lovelace' },
        },
        {
          id: 'invoice-2',
          clinicId: 'clinic-1',
          patientId: 'patient-2',
          providerId: 'provider-1',
          appointmentId: null,
          status: 'FINALIZED',
          totalAmount: new Prisma.Decimal(50),
          createdAt: new Date('2026-03-11T00:00:00.000Z'),
          payments: [
            {
              amount: new Prisma.Decimal(20),
              status: 'PAID',
              paymentChannel: 'MANUAL',
              paymentMethod: 'CASH',
            },
          ],
          items: [
            {
              totalPrice: new Prisma.Decimal(50),
              quantity: 1,
              serviceId: null,
              productId: null,
              packageId: 'package-1',
              membershipId: null,
              disciplineId: null,
              service: null,
              product: null,
              package: { id: 'package-1', name: 'Series' },
              membership: null,
            },
          ],
          patient: { id: 'patient-2', name: 'Patient Two', email: 'two@example.com' },
          provider: { id: 'provider-1', firstName: 'Ada', lastName: 'Lovelace' },
        },
      ]
    }
    ;(prisma.commissionRecord.findMany as any) = async () => [
      {
        amount: new Prisma.Decimal(10),
        status: 'PENDING',
        provider: { id: 'provider-1', firstName: 'Ada', lastName: 'Lovelace' },
        invoiceItem: { service: { name: 'Consult' }, product: null, package: null },
      },
      {
        amount: new Prisma.Decimal(5),
        status: 'PAID',
        provider: { id: 'provider-1', firstName: 'Ada', lastName: 'Lovelace' },
        invoiceItem: { service: { name: 'Consult' }, product: null, package: null },
      },
    ]
    ;(prisma.patientSubscription.findMany as any) = async () => [
      {
        status: 'ACTIVE',
        currentPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z'),
        cancelAtPeriodEnd: false,
        membership: { id: 'membership-1', name: 'Gold' },
        patient: { id: 'patient-1', name: 'Patient One', email: 'one@example.com' },
      },
      {
        status: 'CANCELED',
        currentPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-03-20T00:00:00.000Z'),
        cancelAtPeriodEnd: true,
        membership: { id: 'membership-2', name: 'Silver' },
        patient: { id: 'patient-2', name: 'Patient Two', email: 'two@example.com' },
      },
    ]
    ;(prisma.patientPackage.findMany as any) = async () => [
      {
        id: 'patient-package-1',
        status: 'ACTIVE',
        totalSessions: 5,
        usedSessions: 2,
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        package: { id: 'package-1', name: 'Series' },
        patient: { id: 'patient-1', name: 'Patient One', email: 'one@example.com' },
      },
    ]
    ;(prisma.waitlistEntry.findMany as any) = async () => [
      { status: 'WAITING' },
      { status: 'BOOKED' },
    ]
    ;(prisma.appointment.count as any) = async () => 1
    ;(prisma.cart.count as any) = async () => 0

    const result = await analyticsService.aggregateAnalytics(
      { clinicId: 'clinic-1', role: Role.PROVIDER, providerId: 'provider-1' },
      {
        dateFrom: new Date('2026-03-01T00:00:00.000Z'),
        dateTo: new Date('2026-03-31T23:59:59.000Z'),
      }
    )

    assert.equal(result.summary.totalRevenue, 150)
    assert.equal(result.summary.netCollectedRevenue, 120)
    assert.equal(result.summary.outstandingReceivables, 30)
    assert.equal(result.summary.cancellationRate.toFixed(1), '33.3')
    assert.equal(result.summary.noShowRate.toFixed(1), '33.3')
    assert.equal(result.summary.averageRevenuePerVisit, 120)
    assert.equal(result.summary.productRevenue, 20)
    assert.equal(result.summary.packageRevenue, 50)
    assert.equal(result.summary.commissionSummary.owed, 10)
    assert.equal(result.summary.membershipSummary.churnRate, 50)
    assert.equal(result.summary.patientSummary.repeatVisitRate, 100)
    assert.equal(result.summary.providerUtilization[0]?.availableMinutes, 2700)
  } finally {
    restore(prisma.appointment, 'findMany', originalAppointmentFindMany)
    restore(prisma.provider, 'findMany', originalProviderFindMany)
    restore(prisma.invoice, 'findMany', originalInvoiceFindMany)
    restore(prisma.commissionRecord, 'findMany', originalCommissionFindMany)
    restore(prisma.patientSubscription, 'findMany', originalSubscriptionFindMany)
    restore(prisma.patientPackage, 'findMany', originalPackageFindMany)
    restore(prisma.waitlistEntry, 'findMany', originalWaitlistFindMany)
    restore(prisma.appointment, 'count', originalAppointmentCount)
    restore(prisma.cart, 'count', originalCartCount)
  }
})

test('business alerts trigger on revenue decline and low utilization', () => {
  const alerts = analyticsService.buildAlerts({
    current: {
      netCollectedRevenue: 70,
      outstandingReceivables: 150,
      cancellationRate: 18,
      noShowRate: 8,
      membershipChurnRate: 12,
      providerUtilization: [
        {
          provider: { id: 'provider-1', firstName: 'Ada', lastName: 'Lovelace' },
          utilizationRate: 25,
          availableMinutes: 600,
        },
      ] as any,
    },
    previous: {
      netCollectedRevenue: 100,
      outstandingReceivables: 100,
      cancellationRate: 10,
      noShowRate: 4,
      membershipChurnRate: 5,
    },
    packageSummary: { exhaustedCount: 1, expiringSoonCount: 1 },
  })

  assert.equal(
    alerts.some((alert) => alert.id === 'revenue_down'),
    true
  )
  assert.equal(
    alerts.some((alert) => alert.id === 'receivables_up'),
    true
  )
  assert.equal(
    alerts.some((alert) => alert.id === 'package_pressure'),
    true
  )
  assert.equal(
    alerts.some((alert) => alert.id === 'utilization_provider-1'),
    true
  )
})

test('provider export controller rejects non-provider export types', async () => {
  const originalFindUnique = prisma.provider.findUnique
  const req = {
    clinicId: 'clinic-1',
    query: { type: 'finance' },
    user: { id: 'user-1', role: Role.PROVIDER },
  } as any
  const res = {} as any
  let capturedError: any = null
  try {
    ;(prisma.provider.findUnique as any) = async () => ({ id: 'provider-1' })
    await new Promise<void>((resolve) => {
      analyticsController.exportReport(req, res, ((error: any) => {
        capturedError = error
        resolve()
      }) as any)
    })
    assert.equal(capturedError?.statusCode, 403)
    assert.equal(capturedError?.code, 'forbidden')
  } finally {
    restore(prisma.provider, 'findUnique', originalFindUnique)
  }
})
