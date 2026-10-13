import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import type { ApiError } from '../types/errors'
import { CommissionItemType, CommissionStatus, CommissionType, Prisma } from '@prisma/client'

const ZERO = new Prisma.Decimal(0)

const createApiError = (message: string, statusCode: number, code: string) => {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  err.code = code
  return err
}

export interface CreateRuleInput {
  providerId?: string
  itemType: CommissionItemType
  serviceId?: string
  productId?: string
  packageId?: string
  commissionType: CommissionType
  commissionValue: number
  isActive?: boolean
}

export interface CommissionRuleFilters {
  includeInactive?: boolean
}

export interface CommissionRecordFilters {
  providerId?: string
  status?: CommissionStatus
  dateFrom?: Date
  dateTo?: Date
}

const normalizeOptionalId = (value?: string | null) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const validateRuleShape = (input: CreateRuleInput) => {
  const serviceId = normalizeOptionalId(input.serviceId)
  const productId = normalizeOptionalId(input.productId)
  const packageId = normalizeOptionalId(input.packageId)
  const targetIds = [serviceId, productId, packageId].filter(Boolean)

  if (targetIds.length > 1) {
    throw createApiError(
      'A commission rule can target only one of service, product, or package',
      400,
      'commission_rule_multiple_targets'
    )
  }

  if (input.itemType === CommissionItemType.ALL && targetIds.length > 0) {
    throw createApiError(
      'ALL rules cannot target a specific service, product, or package',
      400,
      'commission_rule_invalid_target'
    )
  }

  if (input.itemType === CommissionItemType.SERVICE && !serviceId) {
    throw createApiError('SERVICE rules require serviceId', 400, 'commission_rule_missing_target')
  }

  if (input.itemType === CommissionItemType.PRODUCT && !productId) {
    throw createApiError('PRODUCT rules require productId', 400, 'commission_rule_missing_target')
  }

  if (input.itemType === CommissionItemType.PACKAGE && !packageId) {
    throw createApiError('PACKAGE rules require packageId', 400, 'commission_rule_missing_target')
  }

  if (input.itemType !== CommissionItemType.ALL && targetIds.length === 0) {
    throw createApiError(
      'A commission rule target is required for the selected item type',
      400,
      'commission_rule_missing_target'
    )
  }

  const value = new Prisma.Decimal(input.commissionValue)
  if (value.lte(ZERO)) {
    throw createApiError(
      'Commission value must be greater than zero',
      400,
      'commission_rule_invalid_value'
    )
  }

  if (input.commissionType === CommissionType.PERCENTAGE && (value.gt(100) || value.lte(ZERO))) {
    throw createApiError(
      'Percentage commission must be greater than 0 and no more than 100',
      400,
      'commission_rule_invalid_percentage'
    )
  }

  return {
    providerId: normalizeOptionalId(input.providerId) ?? null,
    itemType: input.itemType,
    serviceId: serviceId ?? null,
    productId: productId ?? null,
    packageId: packageId ?? null,
    commissionType: input.commissionType,
    commissionValue: value.toDecimalPlaces(2),
    isActive: input.isActive ?? true,
  }
}

const assertMatchingCatalogTarget = async (
  clinicId: string,
  normalized: ReturnType<typeof validateRuleShape>
) => {
  if (normalized.providerId) {
    const provider = await prisma.provider.findFirst({
      where: { id: normalized.providerId, clinicId },
      select: { id: true },
    })
    if (!provider) {
      throw createApiError('Provider not found', 404, 'commission_rule_provider_not_found')
    }
  }

  if (normalized.serviceId) {
    const service = await prisma.service.findFirst({
      where: { id: normalized.serviceId, clinicId },
      select: { id: true },
    })
    if (!service) {
      throw createApiError('Service not found', 404, 'commission_rule_service_not_found')
    }
  }

  if (normalized.productId) {
    const product = await prisma.product.findFirst({
      where: { id: normalized.productId, clinicId },
      select: { id: true },
    })
    if (!product) {
      throw createApiError('Product not found', 404, 'commission_rule_product_not_found')
    }
  }

  if (normalized.packageId) {
    const pkg = await prisma.package.findFirst({
      where: { id: normalized.packageId, clinicId },
      select: { id: true },
    })
    if (!pkg) {
      throw createApiError('Package not found', 404, 'commission_rule_package_not_found')
    }
  }
}

const assertNoConflictingActiveRule = async (
  clinicId: string,
  normalized: ReturnType<typeof validateRuleShape>,
  excludeRuleId?: string
) => {
  if (!normalized.isActive) return

  const existing = await prisma.commissionRule.findFirst({
    where: {
      clinicId,
      isActive: true,
      providerId: normalized.providerId,
      itemType: normalized.itemType,
      serviceId: normalized.serviceId,
      productId: normalized.productId,
      packageId: normalized.packageId,
      ...(excludeRuleId ? { id: { not: excludeRuleId } } : {}),
    },
    select: { id: true },
  })

  if (existing) {
    throw createApiError(
      'An active commission rule already exists for this provider/item target',
      409,
      'commission_rule_conflict'
    )
  }
}

export const getRules = async (clinicId: string, filters: CommissionRuleFilters = {}) => {
  return prisma.commissionRule.findMany({
    where: {
      clinicId,
      ...(filters.includeInactive ? {} : { isActive: true }),
    },
    include: { provider: true, service: true, product: true, package: true },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
  })
}

export const createRule = async (clinicId: string, input: CreateRuleInput) => {
  const normalized = validateRuleShape(input)
  await assertMatchingCatalogTarget(clinicId, normalized)
  await assertNoConflictingActiveRule(clinicId, normalized)

  return prisma.commissionRule.create({
    data: {
      clinicId,
      providerId: normalized.providerId,
      itemType: normalized.itemType,
      serviceId: normalized.serviceId,
      productId: normalized.productId,
      packageId: normalized.packageId,
      commissionType: normalized.commissionType,
      commissionValue: normalized.commissionValue,
      isActive: normalized.isActive,
    },
    include: { provider: true, service: true, product: true, package: true },
  })
}

export const updateRule = async (id: string, clinicId: string, input: Partial<CreateRuleInput>) => {
  const existing = await prisma.commissionRule.findFirst({
    where: { id, clinicId },
  })

  if (!existing) {
    throw createApiError('Commission rule not found', 404, 'commission_rule_not_found')
  }

  const normalized = validateRuleShape({
    providerId: input.providerId ?? existing.providerId ?? undefined,
    itemType: input.itemType ?? existing.itemType,
    serviceId: input.serviceId ?? existing.serviceId ?? undefined,
    productId: input.productId ?? existing.productId ?? undefined,
    packageId: input.packageId ?? existing.packageId ?? undefined,
    commissionType: input.commissionType ?? existing.commissionType,
    commissionValue:
      input.commissionValue !== undefined
        ? input.commissionValue
        : Number(existing.commissionValue),
    isActive: input.isActive ?? existing.isActive,
  })

  await assertMatchingCatalogTarget(clinicId, normalized)
  await assertNoConflictingActiveRule(clinicId, normalized, id)

  return prisma.commissionRule.update({
    where: { id, clinicId },
    data: {
      providerId: normalized.providerId,
      itemType: normalized.itemType,
      serviceId: normalized.serviceId,
      productId: normalized.productId,
      packageId: normalized.packageId,
      commissionType: normalized.commissionType,
      commissionValue: normalized.commissionValue,
      isActive: normalized.isActive,
    },
    include: { provider: true, service: true, product: true, package: true },
  })
}

const buildRecordWhere = (
  clinicId: string,
  filters: CommissionRecordFilters = {}
): Prisma.CommissionRecordWhereInput => ({
  clinicId,
  ...(filters.providerId ? { providerId: filters.providerId } : {}),
  ...(filters.status ? { status: filters.status } : {}),
  ...(filters.dateFrom || filters.dateTo
    ? {
        earnedAt: {
          ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
          ...(filters.dateTo ? { lte: filters.dateTo } : {}),
        },
      }
    : {}),
})

export const getRecords = async (clinicId: string, filters: CommissionRecordFilters = {}) => {
  const where = buildRecordWhere(clinicId, filters)
  const records = await prisma.commissionRecord.findMany({
    where,
    include: {
      provider: true,
      invoiceItem: {
        include: { service: true, product: true, package: true },
      },
      invoice: true,
      rule: true,
    },
    orderBy: [{ earnedAt: 'desc' }, { createdAt: 'desc' }],
  })

  const summary = {
    totalRecords: records.length,
    pendingCount: records.filter((record) => record.status === CommissionStatus.PENDING).length,
    paidCount: records.filter((record) => record.status === CommissionStatus.PAID).length,
    cancelledCount: records.filter((record) => record.status === CommissionStatus.CANCELLED).length,
    totalAmount: records
      .reduce((sum, record) => sum.plus(record.amount), ZERO)
      .toDecimalPlaces(2)
      .toFixed(2),
    pendingAmount: records
      .filter((record) => record.status === CommissionStatus.PENDING)
      .reduce((sum, record) => sum.plus(record.amount), ZERO)
      .toDecimalPlaces(2)
      .toFixed(2),
    paidAmount: records
      .filter((record) => record.status === CommissionStatus.PAID)
      .reduce((sum, record) => sum.plus(record.amount), ZERO)
      .toDecimalPlaces(2)
      .toFixed(2),
  }

  return { records, summary }
}

export const markPaid = async (clinicId: string, recordIds: string[]) => {
  return prisma.commissionRecord.updateMany({
    where: {
      clinicId,
      id: { in: recordIds },
      status: CommissionStatus.PENDING,
    },
    data: {
      status: CommissionStatus.PAID,
      paidOutAt: new Date(),
    },
  })
}

export const calculateCommissions = async (invoiceId: string) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId, ...clinicScope() },
    include: { items: true, clinic: true },
  })

  if (!invoice || invoice.status !== 'PAID') return

  const rules = await prisma.commissionRule.findMany({
    where: { clinicId: invoice.clinicId, isActive: true },
  })

  for (const item of invoice.items) {
    if (!item.providerId) continue

    const existingRecord = await prisma.commissionRecord.findFirst({
      where: { invoiceItemId: item.id, clinicId: invoice.clinicId },
      select: { id: true },
    })
    if (existingRecord) continue

    const matchingRule =
      rules.find(
        (r) =>
          r.providerId === item.providerId &&
          ((item.serviceId && r.serviceId === item.serviceId) ||
            (item.productId && r.productId === item.productId) ||
            (item.packageId && r.packageId === item.packageId))
      ) ||
      rules.find((r) => r.providerId === item.providerId && r.itemType === 'ALL') ||
      rules.find(
        (r) =>
          !r.providerId &&
          ((item.serviceId && r.serviceId === item.serviceId) ||
            (item.productId && r.productId === item.productId) ||
            (item.packageId && r.packageId === item.packageId))
      ) ||
      rules.find((r) => !r.providerId && r.itemType === 'ALL')

    if (!matchingRule) continue

    const basis = new Prisma.Decimal(item.totalPrice)
    const amount =
      matchingRule.commissionType === CommissionType.PERCENTAGE
        ? basis.mul(matchingRule.commissionValue).div(100).toDecimalPlaces(2)
        : new Prisma.Decimal(matchingRule.commissionValue).toDecimalPlaces(2)

    await prisma.commissionRecord.create({
      data: {
        clinicId: invoice.clinicId,
        providerId: item.providerId,
        invoiceId: invoice.id,
        invoiceItemId: item.id,
        ruleId: matchingRule.id,
        basisAmount: basis,
        amount,
        status: CommissionStatus.PENDING,
        earnedAt: new Date(),
      },
    })
  }
}
