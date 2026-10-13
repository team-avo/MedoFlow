import prisma from '../config/prisma'
import { clinicScope } from '../config/tenantContext'
import { ApiError } from '../types/errors'
import { PaymentStatus, Prisma } from '@prisma/client'
import * as auditService from './auditService'
import * as membershipService from './membershipService'

const DEFAULT_TAX_RATE = 0.13 // 13% - configurable via env if needed

const ZERO = new Prisma.Decimal(0)

export const createInvoice = async (
  appointmentId: string | undefined | null,
  clinicId: string,
  providerId: string | undefined | null,
  performedById: string,
  patientId?: string,
  locationId?: string
) => {
  let finalPatientId = patientId
  let finalLocationId = locationId

  if (appointmentId) {
    const appointment = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId, providerId: providerId ?? undefined },
      select: { patientId: true, locationId: true },
    })

    if (!appointment) {
      const err = new Error(
        'Appointment not found or does not belong to this clinic/provider'
      ) as ApiError
      err.statusCode = 404
      throw err
    }

    const existing = await prisma.invoice.findFirst({
      where: { appointmentId, clinicId, status: { not: 'CANCELLED' } },
    })

    if (existing) {
      const err = new Error('An active invoice already exists for this appointment') as ApiError
      err.statusCode = 409
      throw err
    }

    finalPatientId = appointment.patientId
    finalLocationId = appointment.locationId ?? undefined
  }

  if (!finalPatientId) {
    const err = new Error(
      'patientId is required when creating an invoice without an appointment'
    ) as ApiError
    err.statusCode = 400
    throw err
  }

  let finalProviderId = providerId
  if (!finalProviderId) {
    const fallbackProvider = await prisma.provider.findFirst({
      where: { clinicId, isActive: true },
      select: { id: true },
    })
    if (fallbackProvider) {
      finalProviderId = fallbackProvider.id
    }
  }

  if (!finalProviderId) {
    const err = new Error('A provider is required for billing operations') as ApiError
    err.statusCode = 400
    throw err
  }

  const invoice = await prisma.invoice.create({
    data: {
      clinicId,
      appointmentId: appointmentId ?? null,
      patientId: finalPatientId,
      providerId: finalProviderId,
      locationId: finalLocationId ?? null,
      status: 'DRAFT',
      subtotal: ZERO,
      taxAmount: ZERO,
      totalAmount: ZERO,
    },
    include: {
      items: { include: { service: true } },
      appointment: true,
      patient: true,
      provider: true,
    },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'Invoice',
    entityId: invoice.id,
    action: 'INVOICE_CREATED',
    newValue: {
      appointmentId: appointmentId ?? null,
      providerId: providerId ?? null,
      patientId: finalPatientId,
    },
    performedById,
  })

  return invoice
}

export const getInvoicesByPatient = async (patientId: string, clinicId: string) => {
  const invoices = await prisma.invoice.findMany({
    where: { patientId, clinicId, status: { not: 'CANCELLED' } },
    include: {
      items: {
        include: { product: true, service: true, package: true, membership: true },
      },
      payments: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return invoices.map((invoice) => enrichInvoice(invoice))
}

const FINANCIAL_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.REFUNDED,
  PaymentStatus.PARTIALLY_REFUNDED,
]

export type InvoiceFinancialStatus =
  | 'DRAFT'
  | 'CANCELLED'
  | 'UNPAID'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'

const sumPaymentAmounts = (payments: Array<{ amount: Prisma.Decimal | number }>) =>
  payments.reduce((sum, payment) => sum.plus(payment.amount), ZERO)

export const computeInvoiceFinancials = (invoice: {
  status: string
  totalAmount: Prisma.Decimal | number
  payments?: Array<{
    amount: Prisma.Decimal | number
    status: PaymentStatus
    refundForPaymentId?: string | null
  }>
}) => {
  const totalAmount = new Prisma.Decimal(invoice.totalAmount)
  const payments = (invoice.payments ?? []).filter((payment) =>
    FINANCIAL_PAYMENT_STATUSES.includes(payment.status)
  )

  const totalPaid = sumPaymentAmounts(
    payments.filter((payment) => new Prisma.Decimal(payment.amount).gte(ZERO))
  )
  const totalRefunded = sumPaymentAmounts(
    payments
      .filter((payment) => new Prisma.Decimal(payment.amount).lt(ZERO))
      .map((payment) => ({ amount: new Prisma.Decimal(payment.amount).abs() }))
  )
  const netCollected = payments.reduce((sum, payment) => sum.plus(payment.amount), ZERO)
  const outstandingRaw = totalAmount.minus(netCollected)
  let outstandingAmount = (outstandingRaw.lt(ZERO) ? ZERO : outstandingRaw).toDecimalPlaces(2)

  let financialStatus: InvoiceFinancialStatus
  if (invoice.status === 'DRAFT') {
    financialStatus = 'DRAFT'
  } else if (invoice.status === 'CANCELLED' && netCollected.lte(ZERO)) {
    financialStatus = totalRefunded.gt(ZERO) ? 'REFUNDED' : 'CANCELLED'
  } else if (totalRefunded.gte(totalAmount) && netCollected.lte(ZERO)) {
    financialStatus = 'REFUNDED'
  } else if (totalRefunded.gt(ZERO)) {
    financialStatus = outstandingAmount.gt(ZERO) ? 'PARTIALLY_REFUNDED' : 'PAID'
  } else if (netCollected.lte(ZERO)) {
    financialStatus = 'UNPAID'
  } else if (outstandingAmount.gt(ZERO)) {
    financialStatus = 'PARTIALLY_PAID'
  } else {
    financialStatus = 'PAID'
  }

  if (financialStatus === 'REFUNDED' || financialStatus === 'CANCELLED') {
    outstandingAmount = ZERO
  }

  return {
    totalPaid: totalPaid.toDecimalPlaces(2),
    totalRefunded: totalRefunded.toDecimalPlaces(2),
    netCollected: netCollected.toDecimalPlaces(2),
    outstandingAmount,
    financialStatus,
  }
}

export const syncInvoiceStatusFromPayments = async (
  invoiceId: string,
  txClient?: Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>
) => {
  const executor = txClient || prisma
  const invoice = await executor.invoice.findUnique({
    where: { id: invoiceId, ...clinicScope() },
    include: { payments: true },
  })

  if (!invoice || invoice.status === 'DRAFT') return invoice

  const financials = computeInvoiceFinancials(invoice)
  const nextStatus =
    financials.totalRefunded.gte(invoice.totalAmount) && financials.netCollected.lte(ZERO)
      ? 'CANCELLED'
      : financials.outstandingAmount.lte(ZERO)
        ? 'PAID'
        : 'FINALIZED'

  if (invoice.status !== nextStatus) {
    return executor.invoice.update({
      where: { id: invoiceId, clinicId: invoice.clinicId },
      data: { status: nextStatus as any },
      include: { payments: true },
    })
  }

  return invoice
}

export interface CatalogInvoiceItemInput {
  itemType: 'SERVICE' | 'PRODUCT' | 'PACKAGE'
  itemId: string
  description?: string
  unitPrice?: number | string | Prisma.Decimal
  quantity?: number
}

export const addCatalogInvoiceItem = async (
  invoiceId: string,
  input: CatalogInvoiceItemInput,
  performedById: string
) => {
  const { itemType, itemId, quantity = 1 } = input
  const qty = Math.max(1, Math.floor(quantity))

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, ...clinicScope() },
    include: {
      provider: {
        include: {
          providerServices: {
            where: itemType === 'SERVICE' ? { serviceId: itemId } : undefined,
            include: { service: true },
          },
        },
      },
    },
  })

  if (!invoice) {
    const err = new Error('Invoice not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (invoice.status !== 'DRAFT') {
    const err = new Error('Cannot add items to a finalized or paid invoice') as ApiError
    err.statusCode = 400
    throw err
  }

  let expectedPrice = ZERO
  let finalDescription = input.description?.trim() || ''
  let createData: Record<string, unknown> = {
    invoiceId,
    quantity: qty,
    providerId: itemType === 'SERVICE' ? (invoice.providerId ?? null) : null,
  }

  if (itemType === 'SERVICE') {
    const service = await prisma.service.findFirst({
      where: { id: itemId, clinicId: invoice.clinicId },
    })
    if (!service) {
      const err = new Error('Service not found or does not belong to this clinic') as ApiError
      err.statusCode = 404
      throw err
    }
    expectedPrice = invoice.provider?.providerServices[0]?.priceOverride ?? service.defaultPrice
    const membershipBenefit = await membershipService.getActiveMembershipBenefit(
      invoice.clinicId,
      invoice.patientId
    )
    if (membershipBenefit) {
      const discountPercent = new Prisma.Decimal(
        membershipBenefit.membership.serviceDiscountPercent
      )
      const discountAmount = expectedPrice.mul(discountPercent).div(100)
      expectedPrice = expectedPrice.minus(discountAmount).toDecimalPlaces(2)
    }
    finalDescription ||= service.name
    createData = {
      ...createData,
      serviceId: service.id,
      disciplineId: service.disciplineId ?? null,
    }
  } else if (itemType === 'PRODUCT') {
    const product = await prisma.product.findFirst({
      where: { id: itemId, clinicId: invoice.clinicId, isActive: true },
    })
    if (!product) {
      const err = new Error('Product not found or does not belong to this clinic') as ApiError
      err.statusCode = 404
      throw err
    }
    expectedPrice = product.price
    finalDescription ||= product.name
    createData = {
      ...createData,
      productId: product.id,
    }
  } else {
    const pkg = await prisma.package.findFirst({
      where: { id: itemId, clinicId: invoice.clinicId, isActive: true },
    })
    if (!pkg) {
      const err = new Error('Package not found or does not belong to this clinic') as ApiError
      err.statusCode = 404
      throw err
    }
    expectedPrice = pkg.price
    finalDescription ||= pkg.name
    createData = {
      ...createData,
      packageId: pkg.id,
    }
  }

  const unitPrice =
    input.unitPrice !== undefined
      ? typeof input.unitPrice === 'object' && 'toNumber' in input.unitPrice
        ? input.unitPrice
        : new Prisma.Decimal(input.unitPrice)
      : expectedPrice

  const priceDiffers =
    new Prisma.Decimal(unitPrice).toDecimalPlaces(2).toString() !==
    new Prisma.Decimal(expectedPrice).toDecimalPlaces(2).toString()

  if (priceDiffers) {
    await auditService.logAudit({
      clinicId: invoice.clinicId,
      entityType: 'InvoiceItem',
      entityId: invoice.id,
      action: 'INVOICE_PRICE_OVERRIDE',
      fieldChanged: 'unitPrice',
      oldValue: Number(expectedPrice),
      newValue: Number(unitPrice),
      performedById,
    })
  }

  const totalPrice = new Prisma.Decimal(unitPrice).times(qty)

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.invoiceItem.create({
      data: {
        ...createData,
        description: finalDescription,
        unitPrice: new Prisma.Decimal(unitPrice),
        totalPrice,
      } as Prisma.InvoiceItemUncheckedCreateInput,
    })

    await recalculateInvoiceTotals(invoiceId, tx)
    return created
  })

  return item
}

export interface AddInvoiceItemInput {
  serviceId: string
  description: string
  unitPrice: number | string | Prisma.Decimal
  quantity?: number
}

export const addInvoiceItem = async (
  invoiceId: string,
  input: AddInvoiceItemInput,
  performedById: string
) => {
  return addCatalogInvoiceItem(
    invoiceId,
    {
      itemType: 'SERVICE',
      itemId: input.serviceId,
      description: input.description,
      unitPrice: input.unitPrice,
      quantity: input.quantity,
    },
    performedById
  )
}

export interface UpdateInvoiceItemInput {
  unitPrice?: number | string | Prisma.Decimal
  quantity?: number
}

export const updateInvoiceItem = async (
  invoiceId: string,
  itemId: string,
  input: UpdateInvoiceItemInput,
  performedById: string
) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, ...clinicScope() },
    include: {
      items: { where: { id: itemId }, include: { service: true } },
      provider: {
        include: {
          providerServices: {
            include: { service: true },
          },
        },
      },
    },
  })

  if (!invoice) {
    const err = new Error('Invoice not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (invoice.status !== 'DRAFT') {
    const err = new Error('Cannot edit items on a finalized or paid invoice') as ApiError
    err.statusCode = 400
    throw err
  }

  const item = invoice.items[0]
  if (!item) {
    const err = new Error('Invoice item not found') as ApiError
    err.statusCode = 404
    throw err
  }

  const providerService = invoice.provider?.providerServices.find(
    (ps) => ps.serviceId === item.serviceId
  )
  const expectedPrice = providerService?.priceOverride ?? item.service?.defaultPrice ?? ZERO

  let unitPrice = item.unitPrice
  let quantity = item.quantity

  if (input.unitPrice !== undefined) {
    unitPrice =
      typeof input.unitPrice === 'object' && 'toNumber' in input.unitPrice
        ? input.unitPrice
        : new Prisma.Decimal(input.unitPrice)
    const priceDiffers =
      unitPrice.toDecimalPlaces(2).toString() !==
      new Prisma.Decimal(expectedPrice).toDecimalPlaces(2).toString()
    if (priceDiffers) {
      await auditService.logAudit({
        clinicId: invoice.clinicId,
        entityType: 'InvoiceItem',
        entityId: itemId,
        action: 'INVOICE_PRICE_OVERRIDE',
        fieldChanged: 'unitPrice',
        oldValue: Number(expectedPrice),
        newValue: Number(unitPrice),
        performedById,
      })
    }
  }

  if (input.quantity !== undefined) {
    quantity = Math.max(1, Math.floor(input.quantity))
  }

  const totalPrice =
    typeof unitPrice === 'object' && 'times' in unitPrice
      ? unitPrice.times(quantity)
      : new Prisma.Decimal(unitPrice).times(quantity)

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.invoiceItem.update({
      where: { id: itemId },
      data: { unitPrice, quantity, totalPrice },
      include: { service: true },
    })
    await recalculateInvoiceTotals(invoiceId, tx)
    return result
  })

  return updated
}

export const deleteInvoiceItem = async (
  invoiceId: string,
  itemId: string,
  performedById: string
) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, ...clinicScope() },
    include: { items: { where: { id: itemId } } },
  })

  if (!invoice) {
    const err = new Error('Invoice not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (invoice.status !== 'DRAFT') {
    const err = new Error('Cannot delete items from a finalized or paid invoice') as ApiError
    err.statusCode = 400
    throw err
  }

  const item = invoice.items[0]
  if (!item) {
    const err = new Error('Invoice item not found') as ApiError
    err.statusCode = 404
    throw err
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoiceItem.delete({ where: { id: itemId } })
    await recalculateInvoiceTotals(invoiceId, tx)
  })

  return null
}

export async function recalculateInvoiceTotals(
  invoiceId: string,
  txClient?: Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>
) {
  const executor = txClient || prisma
  const invoice = await executor.invoice.findUnique({
    where: { id: invoiceId, ...clinicScope() },
    include: {
      items: {
        include: {
          service: true,
          product: true,
          package: true,
        },
      },
    },
  })

  if (!invoice) return

  let subtotal = new Prisma.Decimal(0)
  let taxableAmount = new Prisma.Decimal(0)

  for (const item of invoice.items) {
    subtotal = subtotal.plus(item.totalPrice)

    const isTaxable =
      item.service?.taxApplicable || item.product?.taxApplicable || item.package?.taxApplicable

    if (isTaxable) {
      taxableAmount = taxableAmount.plus(item.totalPrice)
    }
  }

  const taxAmount = taxableAmount.times(DEFAULT_TAX_RATE).toDecimalPlaces(2)
  const totalAmount = subtotal.plus(taxAmount).toDecimalPlaces(2)

  await executor.invoice.update({
    where: { id: invoiceId, clinicId: invoice.clinicId },
    data: {
      subtotal: subtotal.toDecimalPlaces(2),
      taxAmount,
      totalAmount,
    },
  })
}

export const finalizeInvoice = async (
  invoiceId: string,
  clinicId: string,
  performedById: string
) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, clinicId },
    include: { items: true },
  })

  if (!invoice) {
    const err = new Error('Invoice not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (invoice.status !== 'DRAFT') {
    const err = new Error(
      `Invoice cannot be finalized (current status: ${invoice.status})`
    ) as ApiError
    err.statusCode = 400
    throw err
  }

  if (invoice.items.length === 0) {
    const err = new Error('Cannot finalize invoice with no items') as ApiError
    err.statusCode = 400
    throw err
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId, clinicId },
    data: { status: 'FINALIZED' },
    include: {
      items: { include: { service: true } },
      appointment: true,
      patient: true,
      provider: true,
    },
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'Invoice',
    entityId: invoiceId,
    action: 'INVOICE_FINALIZED',
    oldValue: { status: 'DRAFT' },
    newValue: { status: 'FINALIZED', totalAmount: Number(updated.totalAmount) },
    performedById,
  })

  return updated
}

export interface EnrichedInvoiceFinancials {
  totalPaid: string
  totalRefunded: string
  outstandingAmount: string
  netCollected: string
  financialStatus: InvoiceFinancialStatus
}

const enrichInvoice = <
  T extends { totalAmount: Prisma.Decimal | number; status: string; payments?: any[] },
>(
  invoice: T
): T & EnrichedInvoiceFinancials => {
  const financials = computeInvoiceFinancials(invoice)
  return {
    ...invoice,
    totalPaid: financials.totalPaid.toFixed(2),
    totalRefunded: financials.totalRefunded.toFixed(2),
    outstandingAmount: financials.outstandingAmount.toFixed(2),
    netCollected: financials.netCollected.toFixed(2),
    financialStatus: financials.financialStatus,
  }
}

export const payInvoice = async (invoiceId: string, clinicId: string, performedById: string) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, clinicId },
    include: { payments: true },
  })

  if (!invoice) {
    const err = new Error('Invoice not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (invoice.status !== 'FINALIZED' && invoice.status !== 'PAID') {
    const err = new Error(
      `Invoice must be finalized before payment (current status: ${invoice.status})`
    ) as ApiError
    err.statusCode = 400
    throw err
  }

  const financials = computeInvoiceFinancials(invoice)
  if (financials.outstandingAmount.lte(ZERO)) {
    const refreshed = await getInvoiceById(invoiceId, clinicId)
    return refreshed!
  }

  const result = await recordInvoiceManualPayment(invoiceId, clinicId, performedById, {
    amount: financials.outstandingAmount,
    paymentMethod: 'OTHER',
    notes: 'Legacy invoice pay action',
  })

  return result.invoice!
}

export const recordInvoiceManualPayment = async (
  invoiceId: string,
  clinicId: string,
  performedById: string,
  input: {
    amount: number | string | Prisma.Decimal
    paymentMethod: string
    notes?: string
  }
) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, clinicId },
    include: { payments: true },
  })

  if (!invoice) {
    const err = new Error('Invoice not found') as ApiError
    err.statusCode = 404
    throw err
  }

  if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
    const err = new Error('Invoice is not ready for manual payment collection') as ApiError
    err.statusCode = 400
    err.code = 'invalid_state'
    throw err
  }

  const amount = new Prisma.Decimal(input.amount)
  if (amount.lte(ZERO)) {
    const err = new Error('Manual payment amount must be greater than zero') as ApiError
    err.statusCode = 400
    err.code = 'invalid_amount'
    throw err
  }

  const financials = computeInvoiceFinancials(invoice)
  if (amount.gt(financials.outstandingAmount)) {
    const err = new Error('Manual payment exceeds outstanding balance') as ApiError
    err.statusCode = 400
    err.code = 'overpayment'
    throw err
  }

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        clinicId: invoice.clinicId,
        providerId: invoice.providerId ?? null,
        invoiceId: invoice.id,
        appointmentId: invoice.appointmentId ?? null,
        patientId: invoice.patientId,
        amount,
        status: PaymentStatus.PAID,
        paymentChannel: 'MANUAL',
        paymentMethod: input.paymentMethod,
        recordedById: performedById,
        recordedAt: new Date(),
        notes: input.notes?.trim() || null,
      },
    })

    const syncedInvoice = await syncInvoiceStatusFromPayments(invoice.id, tx)

    if (invoice.appointmentId) {
      const refreshed = await tx.invoice.findUnique({
        where: { id: invoice.id, clinicId: invoice.clinicId },
        include: { payments: true },
      })
      const refreshedFinancials = refreshed ? computeInvoiceFinancials(refreshed) : null
      await tx.appointment.update({
        where: { id: invoice.appointmentId, clinicId: invoice.clinicId },
        data: {
          paymentStatus:
            refreshedFinancials && refreshedFinancials.outstandingAmount.lte(ZERO)
              ? PaymentStatus.PAID
              : PaymentStatus.PENDING,
          updatedById: performedById,
        },
      })
    }

    return { payment, invoice: syncedInvoice }
  })

  await auditService.logAudit({
    clinicId,
    entityType: 'Payment',
    entityId: result.payment.id,
    action: 'MANUAL_PAYMENT_RECORDED',
    newValue: {
      invoiceId,
      amount: Number(amount),
      paymentMethod: input.paymentMethod,
      notes: input.notes?.trim() || null,
    },
    performedById,
  })

  const invoiceWithPayments = await prisma.invoice.findUnique({
    where: { id: invoiceId, clinicId },
    include: {
      items: { include: { service: true, product: true, package: true } },
      appointment: true,
      patient: true,
      provider: true,
      payments: true,
    },
  })

  return {
    payment: result.payment,
    invoice: invoiceWithPayments ? enrichInvoice(invoiceWithPayments) : null,
  }
}

export const getInvoiceById = async (id: string, clinicId?: string) => {
  const where: { id: string; clinicId?: string | { in: string[] } } = { id, ...clinicScope() }
  if (clinicId) where.clinicId = clinicId

  return prisma.invoice
    .findFirst({
      where,
      include: {
        items: { include: { service: true, product: true, package: true } },
        appointment: true,
        patient: true,
        provider: true,
        payments: true,
      },
    })
    .then((invoice) => (invoice ? enrichInvoice(invoice) : invoice))
}

export const getInvoicesByClinic = async (
  clinicId: string,
  status?: string,
  financialStatus?: string,
  filters?: {
    providerId?: string
    dateFrom?: Date
    dateTo?: Date
  }
) => {
  const where: Prisma.InvoiceWhereInput = {
    clinicId,
    ...(filters?.providerId ? { providerId: filters.providerId } : {}),
    ...(filters?.dateFrom || filters?.dateTo
      ? {
          createdAt: {
            ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters?.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  }
  if (status && status !== 'ALL')
    where.status = status as 'DRAFT' | 'FINALIZED' | 'PAID' | 'CANCELLED'

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      items: true,
      patient: { select: { id: true, name: true, email: true } },
      provider: { select: { id: true, firstName: true, lastName: true } },
      appointment: { select: { id: true, startTime: true } },
      payments: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const enriched = invoices.map((invoice) => enrichInvoice(invoice))
  if (!financialStatus || financialStatus === 'ALL') return enriched
  return enriched.filter((invoice) => invoice.financialStatus === financialStatus)
}

export const getInvoicesByAppointment = async (appointmentId: string, clinicId: string) => {
  const invoices = await prisma.invoice.findMany({
    where: { appointmentId, clinicId },
    include: {
      items: { include: { service: true, product: true, package: true } },
      patient: true,
      provider: true,
      payments: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return invoices.map((invoice) => enrichInvoice(invoice))
}

export const getClinicReceivablesSummary = async (clinicId: string) => {
  const invoices = await prisma.invoice.findMany({
    where: {
      clinicId,
      status: { not: 'DRAFT' },
    },
    include: { payments: true },
  })

  const enriched = invoices.map((invoice) => enrichInvoice(invoice))
  const outstandingInvoices = enriched.filter((invoice) =>
    new Prisma.Decimal(invoice.outstandingAmount).gt(ZERO)
  )

  return {
    totalOutstandingAmount: outstandingInvoices
      .reduce((sum, invoice) => sum + Number(invoice.outstandingAmount), 0)
      .toFixed(2),
    outstandingInvoiceCount: outstandingInvoices.length,
    partiallyPaidCount: enriched.filter((invoice) => invoice.financialStatus === 'PARTIALLY_PAID')
      .length,
    partiallyRefundedCount: enriched.filter(
      (invoice) => invoice.financialStatus === 'PARTIALLY_REFUNDED'
    ).length,
    unpaidCount: enriched.filter((invoice) => invoice.financialStatus === 'UNPAID').length,
    paidCount: enriched.filter((invoice) => invoice.financialStatus === 'PAID').length,
    refundedCount: enriched.filter((invoice) => invoice.financialStatus === 'REFUNDED').length,
  }
}

export const getClinicFinanceSummary = async (
  clinicId: string,
  filters?: {
    providerId?: string
    dateFrom?: Date
    dateTo?: Date
  }
) => {
  const invoices = await getInvoicesByClinic(clinicId, undefined, undefined, filters)

  const summary = invoices.reduce(
    (acc, invoice) => {
      acc.totalInvoiced += Number(invoice.totalAmount)
      acc.totalCollected += Number(invoice.totalPaid)
      acc.totalRefunded += Number(invoice.totalRefunded)
      acc.totalOutstanding += Number(invoice.outstandingAmount)
      acc.invoiceCount += 1
      acc.byFinancialStatus[invoice.financialStatus] =
        (acc.byFinancialStatus[invoice.financialStatus] ?? 0) + 1
      return acc
    },
    {
      totalInvoiced: 0,
      totalCollected: 0,
      totalRefunded: 0,
      totalOutstanding: 0,
      invoiceCount: 0,
      byFinancialStatus: {
        UNPAID: 0,
        PARTIALLY_PAID: 0,
        PAID: 0,
        PARTIALLY_REFUNDED: 0,
        REFUNDED: 0,
        DRAFT: 0,
        CANCELLED: 0,
      } as Record<InvoiceFinancialStatus, number>,
    }
  )

  return {
    totalInvoiced: summary.totalInvoiced.toFixed(2),
    totalCollected: summary.totalCollected.toFixed(2),
    totalRefunded: summary.totalRefunded.toFixed(2),
    totalOutstanding: summary.totalOutstanding.toFixed(2),
    invoiceCount: summary.invoiceCount,
    unpaidCount: summary.byFinancialStatus.UNPAID,
    partiallyPaidCount: summary.byFinancialStatus.PARTIALLY_PAID,
    paidCount: summary.byFinancialStatus.PAID,
    partiallyRefundedCount: summary.byFinancialStatus.PARTIALLY_REFUNDED,
    refundedCount: summary.byFinancialStatus.REFUNDED,
    draftCount: summary.byFinancialStatus.DRAFT,
    cancelledCount: summary.byFinancialStatus.CANCELLED,
  }
}
