import assert from 'node:assert/strict'
import {
  CommissionItemType,
  CommissionStatus,
  CommissionType,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client'
import prisma from '../config/prisma'
import * as commissionService from '../services/commissionService'
import * as invoiceService from '../services/invoiceService'
import * as membershipService from '../services/membershipService'
import * as packageService from '../services/packageService'

// Module namespace exports are getter-only; redefine instead of assigning.
const restore = <T extends object, K extends keyof T>(object: T, key: K, value: T[K]) => {
  Object.defineProperty(object, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  })
}

test('commission rule creation rejects conflicting active rules', async () => {
  const originalProviderFindFirst = prisma.provider.findFirst
  const originalRuleFindFirst = prisma.commissionRule.findFirst
  const originalRuleCreate = prisma.commissionRule.create

  try {
    ;(prisma.provider.findFirst as any) = async () => ({ id: 'provider-1' })
    ;(prisma.commissionRule.findFirst as any) = async () => ({ id: 'existing-rule' })
    ;(prisma.commissionRule.create as any) = async () => {
      throw new Error('should not create')
    }

    await assert.rejects(
      () =>
        commissionService.createRule('clinic-1', {
          providerId: 'provider-1',
          itemType: CommissionItemType.ALL,
          commissionType: CommissionType.PERCENTAGE,
          commissionValue: 20,
        }),
      (error: any) => error?.statusCode === 409 && error?.code === 'commission_rule_conflict'
    )
  } finally {
    restore(prisma.provider, 'findFirst', originalProviderFindFirst)
    restore(prisma.commissionRule, 'findFirst', originalRuleFindFirst)
    restore(prisma.commissionRule, 'create', originalRuleCreate)
  }
})

test('commission ledger summary respects filters and totals', async () => {
  const originalFindMany = prisma.commissionRecord.findMany

  try {
    ;(prisma.commissionRecord.findMany as any) = async ({ where }: any) => {
      assert.equal(where.providerId, 'provider-1')
      assert.equal(where.status, CommissionStatus.PENDING)
      return [
        {
          id: 'record-1',
          amount: new Prisma.Decimal(25),
          status: CommissionStatus.PENDING,
          earnedAt: new Date('2026-03-10T00:00:00.000Z'),
          createdAt: new Date('2026-03-10T00:00:00.000Z'),
          provider: { id: 'provider-1', firstName: 'Ada', lastName: 'Lovelace' },
          invoiceItem: {
            id: 'item-1',
            service: { id: 'service-1', name: 'Consult' },
            product: null,
            package: null,
          },
          invoice: { id: 'invoice-1' },
          rule: null,
        },
        {
          id: 'record-2',
          amount: new Prisma.Decimal(40),
          status: CommissionStatus.PENDING,
          earnedAt: new Date('2026-03-11T00:00:00.000Z'),
          createdAt: new Date('2026-03-11T00:00:00.000Z'),
          provider: { id: 'provider-1', firstName: 'Ada', lastName: 'Lovelace' },
          invoiceItem: {
            id: 'item-2',
            service: { id: 'service-2', name: 'Follow Up' },
            product: null,
            package: null,
          },
          invoice: { id: 'invoice-2' },
          rule: null,
        },
      ]
    }

    const result = await commissionService.getRecords('clinic-1', {
      providerId: 'provider-1',
      status: CommissionStatus.PENDING,
    })

    assert.equal(result.records.length, 2)
    assert.equal(result.summary.pendingCount, 2)
    assert.equal(result.summary.paidCount, 0)
    assert.equal(result.summary.totalAmount, '65.00')
    assert.equal(result.summary.pendingAmount, '65.00')
  } finally {
    restore(prisma.commissionRecord, 'findMany', originalFindMany)
  }
})

test('finance summary totals stay coherent across paid and refunded invoices', async () => {
  const originalFindMany = prisma.invoice.findMany

  try {
    ;(prisma.invoice.findMany as any) = async ({ where }: any) => {
      assert.equal(where.providerId, 'provider-1')
      return [
        {
          id: 'invoice-1',
          clinicId: 'clinic-1',
          status: 'PAID',
          totalAmount: new Prisma.Decimal(100),
          payments: [{ amount: new Prisma.Decimal(100), status: 'PAID' }],
          items: [],
          patient: null,
          provider: null,
          appointment: null,
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
        {
          id: 'invoice-2',
          clinicId: 'clinic-1',
          status: 'FINALIZED',
          totalAmount: new Prisma.Decimal(150),
          payments: [{ amount: new Prisma.Decimal(50), status: 'PAID' }],
          items: [],
          patient: null,
          provider: null,
          appointment: null,
          createdAt: new Date('2026-03-02T00:00:00.000Z'),
        },
        {
          id: 'invoice-3',
          clinicId: 'clinic-1',
          status: 'CANCELLED',
          totalAmount: new Prisma.Decimal(80),
          payments: [
            { amount: new Prisma.Decimal(80), status: 'PAID' },
            { amount: new Prisma.Decimal(-80), status: 'REFUNDED' },
          ],
          items: [],
          patient: null,
          provider: null,
          appointment: null,
          createdAt: new Date('2026-03-03T00:00:00.000Z'),
        },
      ]
    }

    const summary = await invoiceService.getClinicFinanceSummary('clinic-1', {
      providerId: 'provider-1',
    })

    assert.equal(summary.totalInvoiced, '330.00')
    assert.equal(summary.totalCollected, '230.00')
    assert.equal(summary.totalRefunded, '80.00')
    assert.equal(summary.totalOutstanding, '100.00')
    assert.equal(summary.paidCount, 1)
    assert.equal(summary.partiallyPaidCount, 1)
    assert.equal(summary.refundedCount, 1)
  } finally {
    restore(prisma.invoice, 'findMany', originalFindMany)
  }
})

test('membership operational summary reports current lifecycle buckets', async () => {
  const originalFindMany = prisma.patientSubscription.findMany

  try {
    let callCount = 0
    ;(prisma.patientSubscription.findMany as any) = async () => {
      callCount += 1
      return [
        {
          id: 'sub-1',
          status: SubscriptionStatus.ACTIVE,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z'),
          patient: { id: 'patient-1', name: 'A', email: 'a@example.com' },
          membership: { id: 'membership-1', name: 'Gold' },
        },
        {
          id: 'sub-2',
          status: SubscriptionStatus.PAST_DUE,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date('2026-04-15T00:00:00.000Z'),
          patient: { id: 'patient-2', name: 'B', email: 'b@example.com' },
          membership: { id: 'membership-2', name: 'Silver' },
        },
        {
          id: 'sub-3',
          status: SubscriptionStatus.CANCELED,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: new Date('2026-03-01T00:00:00.000Z'),
          patient: { id: 'patient-3', name: 'C', email: 'c@example.com' },
          membership: { id: 'membership-3', name: 'Bronze' },
        },
      ]
    }

    const summary = await membershipService.getMembershipOperationalSummary('clinic-1')

    assert.equal(callCount, 2)
    assert.equal(summary.activeCount, 1)
    assert.equal(summary.pastDueCount, 1)
    assert.equal(summary.canceledCount, 1)
    assert.equal(summary.cancelAtPeriodEndCount, 1)
    assert.equal(summary.recentSubscriptions.length, 3)
  } finally {
    restore(prisma.patientSubscription, 'findMany', originalFindMany)
  }
})

test('package operational summary reports exhausted and expiring packages', async () => {
  const originalPatientPackageFindMany = prisma.patientPackage.findMany
  const originalPackageCount = prisma.package.count

  try {
    ;(prisma.package.count as any) = async () => 4
    ;(prisma.patientPackage.findMany as any) = async () => [
      {
        id: 'patient-package-1',
        status: 'ACTIVE',
        totalSessions: 5,
        usedSessions: 2,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5),
        patient: { id: 'patient-1', name: 'A', email: 'a@example.com' },
        package: { id: 'package-1', name: 'Starter' },
      },
      {
        id: 'patient-package-2',
        status: 'EXHAUSTED',
        totalSessions: 3,
        usedSessions: 3,
        expiresAt: null,
        patient: { id: 'patient-2', name: 'B', email: 'b@example.com' },
        package: { id: 'package-2', name: 'Series' },
      },
    ]

    const summary = await packageService.getPackageOperationalSummary('clinic-1')

    assert.equal(summary.activeCatalogPackages, 4)
    assert.equal(summary.patientPackageCount, 2)
    assert.equal(summary.activePatientPackageCount, 1)
    assert.equal(summary.exhaustedCount, 1)
    assert.equal(summary.expiringSoonCount, 1)
    assert.equal(summary.remainingSessionsTotal, 3)
  } finally {
    restore(prisma.patientPackage, 'findMany', originalPatientPackageFindMany)
    restore(prisma.package, 'count', originalPackageCount)
  }
})
