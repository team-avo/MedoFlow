import type { PaymentStatus, Prisma } from '@prisma/client'
import { AppointmentStatus, Role } from '@prisma/client'
import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'
import { computeInvoiceFinancials } from './invoiceService'

const MS_PER_DAY = 1000 * 60 * 60 * 24
const UPCOMING_LOAD_DAYS = 7
const DROP_OFF_RISK_DAYS = 90

export interface AnalyticsDateRange {
  dateFrom: Date
  dateTo: Date
}

export interface AnalyticsScope {
  clinicId: string
  role: Role
  providerId?: string
}

export interface AnalyticsFilters {
  providerId?: string
  serviceId?: string
  disciplineId?: string
}

type ProviderRef = { id: string; firstName: string; lastName: string }
type ServiceRef = { id: string; name: string }

const ACTIVE_SCHEDULED_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.COMPLETED,
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.PENDING_PROVIDER_APPROVAL,
]

const createApiError = (message: string, statusCode: number, code: string) => {
  const err = new Error(message) as ApiError
  err.statusCode = statusCode
  err.code = code
  return err
}

const toNumber = (value?: Prisma.Decimal | number | string | null) => Number(value ?? 0)

const startOfDay = (date: Date) => {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

const endOfDay = (date: Date) => {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

export const parseAnalyticsDateRange = (input?: {
  dateFrom?: string
  dateTo?: string
}): AnalyticsDateRange => {
  const now = new Date()
  const dateTo = input?.dateTo ? endOfDay(new Date(input.dateTo)) : endOfDay(now)
  const defaultFrom = new Date(dateTo.getTime() - 29 * MS_PER_DAY)
  const dateFrom = input?.dateFrom ? startOfDay(new Date(input.dateFrom)) : startOfDay(defaultFrom)

  if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
    throw createApiError('Invalid analytics date range', 400, 'invalid_date_range')
  }
  if (dateFrom > dateTo) {
    throw createApiError('dateFrom must be before or equal to dateTo', 400, 'invalid_date_range')
  }
  return { dateFrom, dateTo }
}

export const getPreviousPeriod = (range: AnalyticsDateRange): AnalyticsDateRange => {
  const durationMs = range.dateTo.getTime() - range.dateFrom.getTime()
  const previousTo = new Date(range.dateFrom.getTime() - 1)
  const previousFrom = new Date(previousTo.getTime() - durationMs)
  return {
    dateFrom: startOfDay(previousFrom),
    dateTo: endOfDay(previousTo),
  }
}

export const resolveAnalyticsScope = async ({
  clinicId,
  role,
  userId,
  requestedProviderId,
}: {
  clinicId: string
  role: Role
  userId: string
  requestedProviderId?: string
}): Promise<AnalyticsScope> => {
  if (role === Role.PROVIDER) {
    const provider = await prisma.provider.findUnique({
      where: { userId, clinicId },
      select: { id: true },
    })
    if (!provider) {
      throw createApiError('Provider analytics unavailable', 404, 'provider_not_found')
    }
    return { clinicId, role, providerId: provider.id }
  }

  if (requestedProviderId) {
    return { clinicId, role, providerId: requestedProviderId }
  }

  return { clinicId, role }
}

const minutesBetween = (start: Date, end: Date) =>
  Math.max(0, (end.getTime() - start.getTime()) / 60000)

const parseClockTimeMinutes = (clock: string) => {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number)
  return hours * 60 + minutes
}

const projectAvailabilityMinutes = (
  range: AnalyticsDateRange,
  availability: Array<{ weekday: number; startTime: string; endTime: string }>
) => {
  if (availability.length === 0) return 0

  const byWeekday = availability.reduce<Record<number, number>>((acc, slot) => {
    const duration = Math.max(
      0,
      parseClockTimeMinutes(slot.endTime) - parseClockTimeMinutes(slot.startTime)
    )
    acc[slot.weekday] = (acc[slot.weekday] ?? 0) + duration
    return acc
  }, {})

  let totalMinutes = 0
  for (
    let cursor = startOfDay(range.dateFrom);
    cursor <= range.dateTo;
    cursor = new Date(cursor.getTime() + MS_PER_DAY)
  ) {
    totalMinutes += byWeekday[cursor.getDay()] ?? 0
  }
  return totalMinutes
}

const buildInvoiceFinancial = (invoice: {
  id: string
  clinicId: string
  status: string
  totalAmount: Prisma.Decimal | number
  patientId: string
  providerId?: string | null
  appointmentId?: string | null
  createdAt: Date
  patient?: { id: string; name: string; email: string }
  provider?: { id: string; firstName: string; lastName: string } | null
  payments: Array<{
    amount: Prisma.Decimal | number
    status: PaymentStatus
    refundForPaymentId?: string | null
    paymentChannel?: string | null
    paymentMethod?: string | null
  }>
  items?: Array<{
    totalPrice: Prisma.Decimal | number
    quantity: number
    serviceId?: string | null
    productId?: string | null
    packageId?: string | null
    membershipId?: string | null
    disciplineId?: string | null
    service?: ServiceRef | null
    product?: { id: string; name: string } | null
    package?: { id: string; name: string } | null
    membership?: { id: string; name: string } | null
  }>
}) => {
  const financials = computeInvoiceFinancials(invoice)
  return {
    ...invoice,
    totalPaid: toNumber(financials.totalPaid),
    totalRefunded: toNumber(financials.totalRefunded),
    netCollected: toNumber(financials.netCollected),
    outstandingAmount: toNumber(financials.outstandingAmount),
    financialStatus: financials.financialStatus,
  }
}

const buildBaseWhere = (
  scope: AnalyticsScope,
  range: AnalyticsDateRange,
  filters?: AnalyticsFilters
) => ({
  clinicId: scope.clinicId,
  ...(scope.providerId ? { providerId: scope.providerId } : {}),
  ...(filters?.providerId && !scope.providerId ? { providerId: filters.providerId } : {}),
  ...(filters?.serviceId ? { serviceId: filters.serviceId } : {}),
  ...(filters?.disciplineId ? { disciplineId: filters.disciplineId } : {}),
  startTime: { gte: range.dateFrom, lte: range.dateTo },
})

const uniqueCount = <T>(values: T[]) => new Set(values).size

export const buildAlerts = ({
  current,
  previous,
  packageSummary,
}: {
  current: {
    netCollectedRevenue: number
    outstandingReceivables: number
    cancellationRate: number
    noShowRate: number
    membershipChurnRate: number
    providerUtilization: Array<{
      provider: ProviderRef
      utilizationRate: number
      availableMinutes: number
    }>
  }
  previous: {
    netCollectedRevenue: number
    outstandingReceivables: number
    cancellationRate: number
    noShowRate: number
    membershipChurnRate: number
  }
  packageSummary: { exhaustedCount: number; expiringSoonCount: number }
}) => {
  const alerts: Array<{
    id: string
    severity: 'info' | 'warning' | 'critical'
    title: string
    message: string
  }> = []

  if (previous.netCollectedRevenue > 0) {
    const change =
      ((current.netCollectedRevenue - previous.netCollectedRevenue) /
        previous.netCollectedRevenue) *
      100
    if (change <= -15) {
      alerts.push({
        id: 'revenue_down',
        severity: 'warning',
        title: 'Collected revenue is down',
        message: `Collected revenue is down ${Math.abs(change).toFixed(1)}% versus the previous period.`,
      })
    }
  }

  if (previous.outstandingReceivables > 0) {
    const change =
      ((current.outstandingReceivables - previous.outstandingReceivables) /
        previous.outstandingReceivables) *
      100
    if (change >= 20) {
      alerts.push({
        id: 'receivables_up',
        severity: 'warning',
        title: 'Outstanding receivables increased',
        message: `Outstanding receivables increased ${change.toFixed(1)}% versus the previous period.`,
      })
    }
  }

  if (current.cancellationRate - previous.cancellationRate >= 5) {
    alerts.push({
      id: 'cancellation_spike',
      severity: 'warning',
      title: 'Cancellation rate increased',
      message: `Cancellation rate is up to ${current.cancellationRate.toFixed(1)}%, at least 5 points above the previous period.`,
    })
  }

  if (current.noShowRate - previous.noShowRate >= 3) {
    alerts.push({
      id: 'noshow_spike',
      severity: 'warning',
      title: 'No-show rate increased',
      message: `No-show rate is up to ${current.noShowRate.toFixed(1)}%, at least 3 points above the previous period.`,
    })
  }

  if (
    current.membershipChurnRate > 10 &&
    current.membershipChurnRate > previous.membershipChurnRate
  ) {
    alerts.push({
      id: 'membership_churn',
      severity: 'warning',
      title: 'Membership churn elevated',
      message: `Membership churn is ${current.membershipChurnRate.toFixed(1)}% and above the previous period.`,
    })
  }

  for (const provider of current.providerUtilization) {
    if (provider.availableMinutes > 0 && provider.utilizationRate < 40) {
      alerts.push({
        id: `utilization_${provider.provider.id}`,
        severity: 'info',
        title: `${provider.provider.firstName} ${provider.provider.lastName} utilization is low`,
        message: `Provider utilization is ${provider.utilizationRate.toFixed(1)}% for the selected period.`,
      })
    }
  }

  if (packageSummary.exhaustedCount > 0 || packageSummary.expiringSoonCount > 0) {
    alerts.push({
      id: 'package_pressure',
      severity: 'info',
      title: 'Package coverage needs attention',
      message: `${packageSummary.exhaustedCount} packages are exhausted and ${packageSummary.expiringSoonCount} are expiring soon.`,
    })
  }

  return alerts.slice(0, 8)
}

const buildCsv = (rows: Record<string, string | number>[]) => {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0]!)
  return [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n')
}

const getMembershipRevenueForRange = (invoices: ReturnType<typeof buildInvoiceFinancial>[]) =>
  invoices.reduce((sum, invoice) => {
    const membershipRevenue = (invoice.items ?? [])
      .filter((item) => item.membershipId)
      .reduce((itemSum, item) => itemSum + toNumber(item.totalPrice), 0)
    return sum + membershipRevenue
  }, 0)

const getProductRevenueForRange = (invoices: ReturnType<typeof buildInvoiceFinancial>[]) =>
  invoices.reduce((sum, invoice) => {
    const productRevenue = (invoice.items ?? [])
      .filter((item) => item.productId)
      .reduce((itemSum, item) => itemSum + toNumber(item.totalPrice), 0)
    return sum + productRevenue
  }, 0)

const getPackageRevenueForRange = (invoices: ReturnType<typeof buildInvoiceFinancial>[]) =>
  invoices.reduce((sum, invoice) => {
    const packageRevenue = (invoice.items ?? [])
      .filter((item) => item.packageId)
      .reduce((itemSum, item) => itemSum + toNumber(item.totalPrice), 0)
    return sum + packageRevenue
  }, 0)

const summarizeSubscriptionsForRange = (
  subscriptions: Array<{
    status: string
    currentPeriodStart: Date
    currentPeriodEnd: Date
    cancelAtPeriodEnd: boolean
  }>,
  range: AnalyticsDateRange
) => {
  const inScope = subscriptions.filter(
    (subscription) =>
      subscription.currentPeriodStart <= range.dateTo &&
      subscription.currentPeriodEnd >= range.dateFrom
  )
  const endedCount = inScope.filter(
    (subscription) => subscription.status === 'CANCELED' || subscription.status === 'ENDED'
  ).length
  const activeBase = inScope.filter(
    (subscription) => subscription.status === 'ACTIVE' || subscription.status === 'TRIALING'
  ).length
  const churnRate = activeBase + endedCount > 0 ? (endedCount / (activeBase + endedCount)) * 100 : 0
  return { inScope, endedCount, churnRate }
}

const summarizePackages = (
  patientPackages: Array<{
    id: string
    status: string
    totalSessions: number
    usedSessions: number
    expiresAt: Date | null
    package: { id: string; name: string }
    patient: { id: string; name: string; email: string }
  }>
) => {
  const now = new Date()
  const totalSessions = patientPackages.reduce((sum, pkg) => sum + pkg.totalSessions, 0)
  const usedSessions = patientPackages.reduce((sum, pkg) => sum + pkg.usedSessions, 0)
  return {
    activeCount: patientPackages.filter((pkg) => pkg.status === 'ACTIVE').length,
    exhaustedCount: patientPackages.filter(
      (pkg) => pkg.status === 'EXHAUSTED' || pkg.usedSessions >= pkg.totalSessions
    ).length,
    expiringSoonCount: patientPackages.filter((pkg) => {
      if (!pkg.expiresAt) return false
      const diff = pkg.expiresAt.getTime() - now.getTime()
      return diff >= 0 && diff <= 14 * MS_PER_DAY
    }).length,
    totalSessions,
    usedSessions,
    utilizationRate: totalSessions > 0 ? (usedSessions / totalSessions) * 100 : 0,
  }
}

export const aggregateAnalytics = async (
  scope: AnalyticsScope,
  range: AnalyticsDateRange,
  filters: AnalyticsFilters = {}
) => {
  const appointmentWhere = buildBaseWhere(scope, range, filters)

  const [
    appointments,
    providers,
    invoicesRaw,
    commissionRecords,
    patientSubscriptions,
    patientPackages,
    waitlistEntries,
    ordersCount,
  ] = await Promise.all([
    prisma.appointment.findMany({
      where: appointmentWhere,
      include: {
        provider: { select: { id: true, firstName: true, lastName: true } },
        service: { select: { id: true, name: true, disciplineId: true } },
        patient: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.provider.findMany({
      where: {
        clinicId: scope.clinicId,
        ...(scope.providerId ? { id: scope.providerId } : {}),
        ...(filters.providerId && !scope.providerId ? { id: filters.providerId } : {}),
      },
      include: { providerAvailability: true },
    }),
    prisma.invoice.findMany({
      where: {
        clinicId: scope.clinicId,
        ...(scope.providerId ? { providerId: scope.providerId } : {}),
        ...(filters.providerId && !scope.providerId ? { providerId: filters.providerId } : {}),
        createdAt: { gte: range.dateFrom, lte: range.dateTo },
      },
      include: {
        payments: true,
        items: {
          include: {
            service: { select: { id: true, name: true } },
            product: { select: { id: true, name: true } },
            package: { select: { id: true, name: true } },
            membership: { select: { id: true, name: true } },
          },
        },
        patient: { select: { id: true, name: true, email: true } },
        provider: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.commissionRecord.findMany({
      where: {
        clinicId: scope.clinicId,
        earnedAt: { gte: range.dateFrom, lte: range.dateTo },
        ...(scope.providerId ? { providerId: scope.providerId } : {}),
      },
      include: {
        provider: { select: { id: true, firstName: true, lastName: true } },
        invoiceItem: { include: { service: true, product: true, package: true } },
      },
    }),
    prisma.patientSubscription.findMany({
      where: {
        clinicId: scope.clinicId,
      },
      include: {
        membership: true,
        patient: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.patientPackage.findMany({
      where: { clinicId: scope.clinicId },
      include: {
        package: true,
        patient: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.waitlistEntry.findMany({
      where: {
        clinicId: scope.clinicId,
        createdAt: { gte: range.dateFrom, lte: range.dateTo },
        ...(scope.providerId ? { providerId: scope.providerId } : {}),
      },
    }),
    prisma.cart.count({
      where: {
        clinicId: scope.clinicId,
        status: 'CHECKED_OUT',
        updatedAt: { gte: range.dateFrom, lte: range.dateTo },
      },
    }),
  ])

  const invoices = invoicesRaw.map(buildInvoiceFinancial)
  const completedAppointments = appointments.filter(
    (appointment) => appointment.status === AppointmentStatus.COMPLETED
  )
  const distinctPatients = uniqueCount(invoices.map((invoice) => invoice.patientId))
  const netCollectedRevenue = invoices.reduce((sum, invoice) => sum + invoice.netCollected, 0)
  const grossCollectedRevenue = invoices.reduce((sum, invoice) => sum + invoice.totalPaid, 0)
  const refundedAmount = invoices.reduce((sum, invoice) => sum + invoice.totalRefunded, 0)
  const totalRevenue = invoices.reduce((sum, invoice) => sum + toNumber(invoice.totalAmount), 0)
  const outstandingReceivables = invoices.reduce(
    (sum, invoice) => sum + invoice.outstandingAmount,
    0
  )

  const cancellationCount = appointments.filter(
    (appointment) => appointment.status === AppointmentStatus.CANCELLED
  ).length
  const noShowCount = appointments.filter(
    (appointment) => appointment.status === AppointmentStatus.NO_SHOW
  ).length
  const rescheduledCount = appointments.filter(
    (appointment) => appointment.status === AppointmentStatus.RESCHEDULED
  ).length
  const totalAppointments = appointments.length
  const cancellationRate = totalAppointments > 0 ? (cancellationCount / totalAppointments) * 100 : 0
  const noShowRate = totalAppointments > 0 ? (noShowCount / totalAppointments) * 100 : 0
  const averageAppointmentDuration =
    completedAppointments.length > 0
      ? completedAppointments.reduce(
          (sum, appointment) => sum + minutesBetween(appointment.startTime, appointment.endTime),
          0
        ) / completedAppointments.length
      : 0

  const providerUtilization = providers.map((provider) => {
    const providerAppointments = appointments.filter(
      (appointment) => appointment.providerId === provider.id
    )
    const scheduledMinutes = providerAppointments
      .filter((appointment) => ACTIVE_SCHEDULED_STATUSES.includes(appointment.status))
      .reduce(
        (sum, appointment) => sum + minutesBetween(appointment.startTime, appointment.endTime),
        0
      )
    const availableMinutes = projectAvailabilityMinutes(range, provider.providerAvailability)
    const utilizationRate = availableMinutes > 0 ? (scheduledMinutes / availableMinutes) * 100 : 0
    return {
      provider: { id: provider.id, firstName: provider.firstName, lastName: provider.lastName },
      scheduledMinutes,
      availableMinutes,
      utilizationRate,
      completedAppointments: providerAppointments.filter(
        (appointment) => appointment.status === AppointmentStatus.COMPLETED
      ).length,
      cancellationCount: providerAppointments.filter(
        (appointment) => appointment.status === AppointmentStatus.CANCELLED
      ).length,
      noShowCount: providerAppointments.filter(
        (appointment) => appointment.status === AppointmentStatus.NO_SHOW
      ).length,
    }
  })

  const topServicesMap = new Map<
    string,
    { serviceId: string; serviceName: string; revenue: number; count: number }
  >()
  const topProductsMap = new Map<
    string,
    { productId: string; productName: string; revenue: number; quantity: number }
  >()
  const topProvidersMap = new Map<
    string,
    { providerId: string; providerName: string; revenue: number; completedAppointments: number }
  >()

  for (const invoice of invoices) {
    for (const item of invoice.items ?? []) {
      if (item.serviceId) {
        const existing = topServicesMap.get(item.serviceId) ?? {
          serviceId: item.serviceId,
          serviceName: item.service?.name ?? 'Service',
          revenue: 0,
          count: 0,
        }
        existing.revenue += toNumber(item.totalPrice)
        existing.count += item.quantity
        topServicesMap.set(item.serviceId, existing)
      }
      if (item.productId) {
        const existing = topProductsMap.get(item.productId) ?? {
          productId: item.productId,
          productName: item.product?.name ?? 'Product',
          revenue: 0,
          quantity: 0,
        }
        existing.revenue += toNumber(item.totalPrice)
        existing.quantity += item.quantity
        topProductsMap.set(item.productId, existing)
      }
    }
    if (invoice.providerId && invoice.provider) {
      const key = invoice.providerId
      const existing = topProvidersMap.get(key) ?? {
        providerId: key,
        providerName: `${invoice.provider.firstName} ${invoice.provider.lastName}`,
        revenue: 0,
        completedAppointments: 0,
      }
      existing.revenue += invoice.netCollected
      topProvidersMap.set(key, existing)
    }
  }

  for (const appointment of completedAppointments) {
    const existing = topProvidersMap.get(appointment.providerId)
    if (existing) {
      existing.completedAppointments += 1
    }
  }

  const patientInvoiceLifetime = await prisma.invoice.findMany({
    where: { clinicId: scope.clinicId, status: { not: 'DRAFT' } },
    include: { payments: true, patient: { select: { id: true, name: true, email: true } } },
  })

  const lifetimeByPatient = new Map<
    string,
    { patientId: string; patientName: string; lifetimeValue: number }
  >()
  for (const invoice of patientInvoiceLifetime.map(buildInvoiceFinancial)) {
    const existing = lifetimeByPatient.get(invoice.patientId) ?? {
      patientId: invoice.patientId,
      patientName: invoice.patient?.name ?? 'Patient',
      lifetimeValue: 0,
    }
    existing.lifetimeValue += invoice.netCollected
    lifetimeByPatient.set(invoice.patientId, existing)
  }

  const completedAppointmentsAllTime = await prisma.appointment.findMany({
    where: {
      clinicId: scope.clinicId,
      ...(scope.providerId ? { providerId: scope.providerId } : {}),
      status: AppointmentStatus.COMPLETED,
    },
    select: {
      id: true,
      patientId: true,
      providerId: true,
      startTime: true,
      endTime: true,
      serviceId: true,
    },
    orderBy: { startTime: 'asc' },
  })

  const perPatientHistory = new Map<string, Array<{ startTime: Date; providerId: string }>>()
  for (const appointment of completedAppointmentsAllTime) {
    const list = perPatientHistory.get(appointment.patientId) ?? []
    list.push({ startTime: appointment.startTime, providerId: appointment.providerId })
    perPatientHistory.set(appointment.patientId, list)
  }

  const patientsInRange = new Set(completedAppointments.map((appointment) => appointment.patientId))
  const repeatPatientsInRange = [...patientsInRange].filter(
    (patientId) => (perPatientHistory.get(patientId) ?? []).length >= 2
  )

  const ninetyDaysAgo = new Date(range.dateTo.getTime() - DROP_OFF_RISK_DAYS * MS_PER_DAY)
  const futureAppointments = await prisma.appointment.findMany({
    where: {
      clinicId: scope.clinicId,
      ...(scope.providerId ? { providerId: scope.providerId } : {}),
      startTime: { gt: range.dateTo, lte: new Date(range.dateTo.getTime() + 180 * MS_PER_DAY) },
      status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.RESCHEDULED] },
    },
    select: { patientId: true },
  })
  const patientsWithFutureAppointments = new Set(
    futureAppointments.map((appointment) => appointment.patientId)
  )

  const dropOffRiskPatients = [...perPatientHistory.entries()]
    .filter(([patientId, history]) => {
      const lastVisit = history[history.length - 1]
      return (
        history.length >= 2 &&
        !!lastVisit &&
        lastVisit.startTime < ninetyDaysAgo &&
        !patientsWithFutureAppointments.has(patientId)
      )
    })
    .map(([patientId]) => patientId)

  const attachRateBase = invoices.filter((invoice) => Boolean(invoice.appointmentId))
  const attachRateNumerator = attachRateBase.filter((invoice) =>
    (invoice.items ?? []).some((item) => Boolean(item.productId))
  ).length
  const attachRate =
    attachRateBase.length > 0 ? (attachRateNumerator / attachRateBase.length) * 100 : 0

  const packageSummary = summarizePackages(patientPackages)
  const subscriptionSummary = summarizeSubscriptionsForRange(patientSubscriptions, range)
  const grossMembershipRevenue = getMembershipRevenueForRange(invoices)
  const productRevenue = getProductRevenueForRange(invoices)
  const packageRevenue = getPackageRevenueForRange(invoices)
  const waitlistBookings = waitlistEntries.filter((entry) => entry.status === 'BOOKED').length

  return {
    range,
    appointments,
    completedAppointments,
    invoices,
    commissionRecords,
    patientSubscriptions,
    patientPackages,
    providers,
    summary: {
      totalRevenue,
      grossCollectedRevenue,
      netCollectedRevenue,
      refundedAmount,
      outstandingReceivables,
      totalAppointments,
      completedAppointments: completedAppointments.length,
      cancellationCount,
      noShowCount,
      rescheduledCount,
      cancellationRate,
      noShowRate,
      averageAppointmentDuration,
      averageRevenuePerPatient: distinctPatients > 0 ? netCollectedRevenue / distinctPatients : 0,
      averageRevenuePerVisit:
        completedAppointments.length > 0 ? netCollectedRevenue / completedAppointments.length : 0,
      upcomingLoadCount: await prisma.appointment.count({
        where: {
          clinicId: scope.clinicId,
          ...(scope.providerId ? { providerId: scope.providerId } : {}),
          startTime: {
            gt: new Date(),
            lte: new Date(Date.now() + UPCOMING_LOAD_DAYS * MS_PER_DAY),
          },
          status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.RESCHEDULED] },
        },
      }),
      waitlistCount: waitlistEntries.length,
      waitlistBookedCount: waitlistBookings,
      waitlistConversionRate:
        waitlistEntries.length > 0 ? (waitlistBookings / waitlistEntries.length) * 100 : 0,
      providerUtilization,
      topServices: [...topServicesMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      topProviders: [...topProvidersMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      productRevenue,
      packageRevenue,
      membershipRevenue: grossMembershipRevenue,
      topProducts: [...topProductsMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      attachRate,
      ordersCount,
      packageSummary,
      membershipSummary: {
        activeCount: patientSubscriptions.filter((subscription) => subscription.status === 'ACTIVE')
          .length,
        trialingCount: patientSubscriptions.filter(
          (subscription) => subscription.status === 'TRIALING'
        ).length,
        pastDueCount: patientSubscriptions.filter(
          (subscription) => subscription.status === 'PAST_DUE'
        ).length,
        canceledCount: patientSubscriptions.filter(
          (subscription) => subscription.status === 'CANCELED'
        ).length,
        endedCount: patientSubscriptions.filter((subscription) => subscription.status === 'ENDED')
          .length,
        churnRate: subscriptionSummary.churnRate,
      },
      commissionSummary: {
        owed: commissionRecords
          .filter((record) => record.status === 'PENDING')
          .reduce((sum, record) => sum + toNumber(record.amount), 0),
        paid: commissionRecords
          .filter((record) => record.status === 'PAID')
          .reduce((sum, record) => sum + toNumber(record.amount), 0),
        pendingCount: commissionRecords.filter((record) => record.status === 'PENDING').length,
        totalCount: commissionRecords.length,
      },
      patientSummary: {
        distinctPatients,
        averageVisitsPerPatient:
          patientsInRange.size > 0 ? completedAppointments.length / patientsInRange.size : 0,
        repeatVisitRate:
          patientsInRange.size > 0
            ? (repeatPatientsInRange.length / patientsInRange.size) * 100
            : 0,
        inactivePatients: [...perPatientHistory.entries()].filter(([patientId, history]) => {
          const last = history[history.length - 1]
          return (
            !!last &&
            last.startTime < ninetyDaysAgo &&
            !patientsWithFutureAppointments.has(patientId)
          )
        }).length,
        dropOffRiskCount: dropOffRiskPatients.length,
        topPatientsByValue: [...lifetimeByPatient.values()]
          .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
          .slice(0, 5),
      },
      providerFollowUpRate: scope.providerId
        ? (() => {
            const providerCompletedInRange = completedAppointments.filter(
              (appointment) => appointment.providerId === scope.providerId
            )
            const followedUp = providerCompletedInRange.filter((appointment) => {
              const history = perPatientHistory.get(appointment.patientId) ?? []
              return history.some(
                (item) =>
                  item.providerId === scope.providerId &&
                  item.startTime > appointment.startTime &&
                  item.startTime <= new Date(appointment.startTime.getTime() + 90 * MS_PER_DAY)
              )
            }).length
            return providerCompletedInRange.length > 0
              ? (followedUp / providerCompletedInRange.length) * 100
              : 0
          })()
        : null,
    },
  }
}

export const getClinicCommandCenter = async (
  scope: AnalyticsScope,
  range: AnalyticsDateRange,
  filters: AnalyticsFilters = {}
) => {
  const current = await aggregateAnalytics(scope, range, filters)
  const previousRange = getPreviousPeriod(range)
  const previous = await aggregateAnalytics(scope, previousRange, filters)

  const alerts = buildAlerts({
    current: {
      netCollectedRevenue: current.summary.netCollectedRevenue,
      outstandingReceivables: current.summary.outstandingReceivables,
      cancellationRate: current.summary.cancellationRate,
      noShowRate: current.summary.noShowRate,
      membershipChurnRate: current.summary.membershipSummary.churnRate,
      providerUtilization: current.summary.providerUtilization,
    },
    previous: {
      netCollectedRevenue: previous.summary.netCollectedRevenue,
      outstandingReceivables: previous.summary.outstandingReceivables,
      cancellationRate: previous.summary.cancellationRate,
      noShowRate: previous.summary.noShowRate,
      membershipChurnRate: previous.summary.membershipSummary.churnRate,
    },
    packageSummary: current.summary.packageSummary,
  })

  return {
    range,
    comparison: {
      previousRange,
      netCollectedRevenueChangePercent:
        previous.summary.netCollectedRevenue > 0
          ? ((current.summary.netCollectedRevenue - previous.summary.netCollectedRevenue) /
              previous.summary.netCollectedRevenue) *
            100
          : null,
      outstandingReceivablesChangePercent:
        previous.summary.outstandingReceivables > 0
          ? ((current.summary.outstandingReceivables - previous.summary.outstandingReceivables) /
              previous.summary.outstandingReceivables) *
            100
          : null,
    },
    commandCenter: {
      finance: {
        totalRevenue: current.summary.totalRevenue,
        collectedRevenue: current.summary.grossCollectedRevenue,
        netCollectedRevenue: current.summary.netCollectedRevenue,
        refundedAmount: current.summary.refundedAmount,
        outstandingReceivables: current.summary.outstandingReceivables,
        averageRevenuePerPatient: current.summary.averageRevenuePerPatient,
        averageRevenuePerVisit: current.summary.averageRevenuePerVisit,
      },
      operations: {
        totalAppointments: current.summary.totalAppointments,
        completedAppointments: current.summary.completedAppointments,
        cancellationRate: current.summary.cancellationRate,
        noShowRate: current.summary.noShowRate,
        averageAppointmentDuration: current.summary.averageAppointmentDuration,
        upcomingLoadCount: current.summary.upcomingLoadCount,
        waitlistCount: current.summary.waitlistCount,
        waitlistBookedCount: current.summary.waitlistBookedCount,
        waitlistConversionRate: current.summary.waitlistConversionRate,
        clinicCapacityRate:
          current.summary.providerUtilization.length > 0
            ? current.summary.providerUtilization.reduce((sum, p) => sum + p.utilizationRate, 0) /
              current.summary.providerUtilization.length
            : 0,
      },
      commerce: {
        productRevenue: current.summary.productRevenue,
        packageRevenue: current.summary.packageRevenue,
        membershipRevenue: current.summary.membershipRevenue,
        attachRate: current.summary.attachRate,
        topProducts: current.summary.topProducts,
        ordersCount: current.summary.ordersCount,
      },
      memberships: current.summary.membershipSummary,
      packages: current.summary.packageSummary,
      commissions: current.summary.commissionSummary,
      patients: current.summary.patientSummary,
      providerUtilization: current.summary.providerUtilization,
      topServices: current.summary.topServices,
      topProviders: scope.role === Role.SUPER_ADMIN ? current.summary.topProviders : [],
      alerts,
    },
  }
}

export const getProviderAnalytics = async (scope: AnalyticsScope, range: AnalyticsDateRange) => {
  if (!scope.providerId) {
    throw createApiError('Provider scope required', 400, 'provider_scope_required')
  }

  const current = await aggregateAnalytics(scope, range)
  const providerUtilization = current.summary.providerUtilization[0] ?? null

  return {
    range,
    provider: providerUtilization?.provider ?? null,
    performance: {
      completedAppointments: current.summary.completedAppointments,
      totalAppointments: current.summary.totalAppointments,
      cancellationCount: current.summary.cancellationCount,
      noShowCount: current.summary.noShowCount,
      revenueGenerated: current.summary.netCollectedRevenue,
      averageRevenuePerVisit: current.summary.averageRevenuePerVisit,
      followUpConversionRate: current.summary.providerFollowUpRate ?? 0,
      repeatPatientRate: current.summary.patientSummary.repeatVisitRate,
      utilizationRate: providerUtilization?.utilizationRate ?? 0,
      scheduledMinutes: providerUtilization?.scheduledMinutes ?? 0,
      availableMinutes: providerUtilization?.availableMinutes ?? 0,
    },
    commissions: current.summary.commissionSummary,
    topServices: current.summary.topServices,
  }
}

export const exportAnalyticsReport = async (
  scope: AnalyticsScope,
  range: AnalyticsDateRange,
  type: 'command-center' | 'provider' | 'finance' | 'commerce' | 'patients' | 'commissions'
) => {
  if (type === 'provider') {
    const provider = await getProviderAnalytics(scope, range)
    return {
      filename: `provider-analytics-${range.dateFrom.toISOString().slice(0, 10)}.csv`,
      csv: buildCsv(
        Object.entries(provider.performance).map(([metric, value]) => ({
          metric,
          value: typeof value === 'number' ? value.toFixed(2) : String(value ?? ''),
        }))
      ),
    }
  }

  const dashboard = await getClinicCommandCenter(scope, range)
  let rows: Record<string, string | number>[] = []

  if (type === 'command-center' || type === 'finance') {
    rows = Object.entries(dashboard.commandCenter.finance).map(([metric, value]) => ({
      metric,
      value: Number(value),
    }))
  } else if (type === 'commerce') {
    rows = dashboard.commandCenter.commerce.topProducts.map((item) => ({
      product: item.productName,
      revenue: item.revenue,
      quantity: item.quantity,
    }))
  } else if (type === 'patients') {
    rows = dashboard.commandCenter.patients.topPatientsByValue.map((item) => ({
      patient: item.patientName,
      lifetimeValue: item.lifetimeValue,
    }))
  } else if (type === 'commissions') {
    rows = [
      { metric: 'owed', value: dashboard.commandCenter.commissions.owed },
      { metric: 'paid', value: dashboard.commandCenter.commissions.paid },
      { metric: 'pendingCount', value: dashboard.commandCenter.commissions.pendingCount },
    ]
  }

  return {
    filename: `analytics-${type}-${range.dateFrom.toISOString().slice(0, 10)}.csv`,
    csv: buildCsv(rows),
  }
}
