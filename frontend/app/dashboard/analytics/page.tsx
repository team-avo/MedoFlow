'use client'

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  downloadAnalyticsReport,
  getAnalyticsDashboard,
  type AnalyticsExportType,
  type ClinicDashboardResponse,
  type ProviderDashboardResponse,
} from '@/lib/analyticsApi'
import { listProviders } from '@/lib/availabilityApi'
import {
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppEmptyState,
  AppPageHeader,
  KPIStatCard,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { StatusBadge } from '@/components/common/StatusBadge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AppInput } from '@/components/ui-system'
import {
  TrendingUp,
  DollarSign,
  CreditCard,
  Calendar,
  Activity,
  Users,
  Download,
  Filter,
  AlertCircle,
  Clock,
  ChevronRight,
  CheckCircle2,
  X,
} from 'lucide-react'
import { cn as cnUtils } from '@/lib/utils'

function formatMoney(value?: number | string | null) {
  return `$${Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatPercent(value?: number | null) {
  return `${Number(value ?? 0).toFixed(1)}%`
}

const defaultDateRange = () => {
  const today = new Date()
  const to = new Date(today)
  const from = new Date(today)
  from.setDate(today.getDate() - 29)
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  }
}

export default function AnalyticsPage() {
  const { user } = useAuth()
  const clinicId = user?.clinicId ?? undefined
  const isProvider = user?.role === 'PROVIDER'
  const isAdmin = user?.role === 'SUPER_ADMIN'
  const [filters, setFilters] = React.useState({
    ...defaultDateRange(),
    providerId: 'ALL',
  })

  const { data: providers = [] } = useQuery({
    queryKey: ['providers'],
    queryFn: () => listProviders(),
    enabled: !!clinicId && !isProvider,
  })

  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics-dashboard', filters],
    queryFn: () =>
      getAnalyticsDashboard({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        providerId: !isProvider && filters.providerId !== 'ALL' ? filters.providerId : undefined,
      }),
    enabled: !!clinicId,
  })

  if (!clinicId) {
    return (
      <div className="p-8">
        <AppEmptyState
          title="Clinic Setup Required"
          description="Complete your clinic setup to access the analytics dashboard."
        />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-primary" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-8">
        <AppEmptyState
          title="Data Unavailable"
          description="We couldn't load your analytics right now. Please try again later."
        />
      </div>
    )
  }

  const isClinicMode = data.mode === 'clinic'
  const clinicData = isClinicMode ? (data as ClinicDashboardResponse).dashboard : null
  const providerData = !isClinicMode ? (data as ProviderDashboardResponse).providerAnalytics : null

  const exportType: AnalyticsExportType = isClinicMode ? 'command-center' : 'provider'

  return (
    <PageContainer className="space-y-8">
      {/* Hero */}
      <div className="relative overflow-clip rounded-3xl border border-[#E5E7EB] bg-gradient-to-br from-[#1E3A5F] via-[#23436B] to-[#6366F1] text-white">
        <div className="relative flex flex-col gap-6 p-8 lg:flex-row lg:items-end lg:justify-between lg:p-10">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
              <span className="h-1.5 w-1.5 rounded-full bg-[#14B8A6]" />
              {isProvider ? 'Performance' : 'Clinic Intelligence'}
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {isProvider ? 'Personal Performance' : 'Clinic Intelligence'}
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
              {isProvider
                ? 'Track your clinical impact, patient retention, and earnings.'
                : 'Enterprise-grade visibility into your clinic operations and financial health.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center bg-white rounded-xl border border-slate-200 p-1 shadow-sm h-11">
              <div className="pl-3 pr-1 text-slate-400">
                <Calendar className="h-4 w-4" />
              </div>
              <AppInput
                type="date"
                className="border-none bg-transparent h-9 text-sm font-bold text-slate-700 focus-visible:ring-0 w-36 px-2"
                value={filters.dateFrom}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              />
              <div className="flex items-center px-1 text-slate-300 font-bold">|</div>
              <AppInput
                type="date"
                className="border-none bg-transparent h-9 text-sm font-bold text-slate-700 focus-visible:ring-0 w-36 px-2"
                value={filters.dateTo}
                onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
              />
            </div>

            {!isProvider && (
              <Select
                value={filters.providerId}
                onValueChange={(v) => setFilters((f) => ({ ...f, providerId: v }))}
              >
                <SelectTrigger className="w-48 h-11 bg-white border-slate-200 rounded-xl shadow-sm">
                  <Filter className="h-3 w-3 mr-2 text-slate-400" />
                  <SelectValue placeholder="All Providers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Providers</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <select
              className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-primary-500 transition-colors appearance-none cursor-pointer"
              defaultValue=""
              onChange={(e) => {
                const type = e.target.value as AnalyticsExportType
                if (!type) return
                downloadAnalyticsReport(type, {
                  dateFrom: filters.dateFrom,
                  dateTo: filters.dateTo,
                  providerId:
                    !isProvider && filters.providerId !== 'ALL' ? filters.providerId : undefined,
                })
                e.currentTarget.selectedIndex = 0
              }}
            >
              <option value="" disabled>
                Export CSV
              </option>
              <option value={exportType}>Full Report</option>
              {isClinicMode && (
                <>
                  <option value="finance">Finance Only</option>
                  <option value="commerce">Commerce Only</option>
                  <option value="patients">Patients Only</option>
                </>
              )}
            </select>
          </div>
        </div>
      </div>

      {isClinicMode && clinicData && (
        <div className="space-y-10">
          {/* Revenue & Finance */}
          <div className="space-y-6">
            <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> Financial Health
            </h2>
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
              <KPIStatCard
                label="Gross Revenue"
                value={formatMoney(clinicData.commandCenter.finance.totalRevenue)}
                icon={TrendingUp}
                iconClassName="text-blue-600 bg-blue-50"
                description="Billed in selected period"
              />
              <KPIStatCard
                label="Net Collected"
                value={formatMoney(clinicData.commandCenter.finance.netCollectedRevenue)}
                icon={DollarSign}
                iconClassName="text-emerald-600 bg-emerald-50"
                description="Actual cash in bank"
              />
              <KPIStatCard
                label="Accounts Receivable"
                value={formatMoney(clinicData.commandCenter.finance.outstandingReceivables)}
                icon={CreditCard}
                iconClassName="text-amber-600 bg-amber-50"
                description="Unpaid finalized invoices"
              />
              <KPIStatCard
                label="Refunds"
                value={formatMoney(clinicData.commandCenter.finance.refundedAmount)}
                icon={Activity}
                iconClassName="text-rose-600 bg-rose-50"
                description="Total reversals"
              />
            </div>
          </div>

          {/* Operations */}
          <div className="space-y-6">
            <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
              <Activity className="h-4 w-4" /> Operational Efficiency
            </h2>
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
              <KPIStatCard
                label="Total Appointments"
                value={clinicData.commandCenter.operations.totalAppointments}
                icon={Calendar}
                iconClassName="text-indigo-600 bg-indigo-50"
              />
              <KPIStatCard
                label="Completion Rate"
                value={formatPercent(
                  (clinicData.commandCenter.operations.completedAppointments /
                    clinicData.commandCenter.operations.totalAppointments) *
                    100
                )}
                icon={CheckCircle2}
                iconClassName="text-emerald-600 bg-emerald-50"
              />
              <KPIStatCard
                label="Cancellation Rate"
                value={formatPercent(clinicData.commandCenter.operations.cancellationRate)}
                icon={X}
                iconClassName="text-rose-600 bg-rose-50"
              />
              <KPIStatCard
                label="Avg Visit Length"
                value={`${clinicData.commandCenter.operations.averageAppointmentDuration.toFixed(0)}m`}
                icon={Clock}
                iconClassName="text-slate-600 bg-slate-100"
              />
            </div>
          </div>

          <div className="grid gap-8 xl:grid-cols-3">
            {/* Top Lists */}
            <div className="xl:col-span-2 space-y-8">
              <AppCard className="border-none shadow-sm overflow-hidden">
                <AppCardHeader className="bg-slate-50/50 border-b-0 py-6">
                  <AppCardTitle className="font-bold">Provider Utilization</AppCardTitle>
                </AppCardHeader>
                <AppCardContent className="p-0">
                  <div className="divide-y divide-slate-100">
                    {clinicData.commandCenter.providerUtilization.map((row) => (
                      <div
                        key={row.provider.id}
                        className="px-6 py-5 flex items-center justify-between hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-500">
                            {row.provider.firstName[0]}
                            {row.provider.lastName[0]}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">
                              {row.provider.firstName} {row.provider.lastName}
                            </p>
                            <p className="text-xs text-slate-500">
                              {row.completedAppointments} visits completed
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-black text-slate-900">
                            {formatPercent(row.utilizationRate)}
                          </p>
                          <div className="w-32 h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                            <div
                              className="h-full bg-primary-600 rounded-full"
                              style={{ width: `${Math.min(100, row.utilizationRate)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </AppCardContent>
              </AppCard>

              <div className="grid md:grid-cols-2 gap-8">
                <AppCard className="border-none shadow-sm">
                  <AppCardHeader className="bg-slate-50/50 border-b-0 py-6">
                    <AppCardTitle className="font-bold">Top Services</AppCardTitle>
                  </AppCardHeader>
                  <AppCardContent className="p-6">
                    <div className="space-y-4">
                      {clinicData.commandCenter.topServices.slice(0, 5).map((s) => (
                        <div key={s.serviceId} className="flex justify-between items-center">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-slate-900 truncate">
                              {s.serviceName}
                            </p>
                            <p className="text-xs text-slate-500">{s.count} visits</p>
                          </div>
                          <span className="text-sm font-black text-slate-900">
                            {formatMoney(s.revenue)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </AppCardContent>
                </AppCard>

                <AppCard className="border-none shadow-sm">
                  <AppCardHeader className="bg-slate-50/50 border-b-0 py-6">
                    <AppCardTitle className="font-bold">Top Products</AppCardTitle>
                  </AppCardHeader>
                  <AppCardContent className="p-6">
                    <div className="space-y-4">
                      {clinicData.commandCenter.commerce.topProducts.slice(0, 5).map((p) => (
                        <div key={p.productId} className="flex justify-between items-center">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-slate-900 truncate">
                              {p.productName}
                            </p>
                            <p className="text-xs text-slate-500">{p.quantity} units</p>
                          </div>
                          <span className="text-sm font-black text-slate-900">
                            {formatMoney(p.revenue)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </AppCardContent>
                </AppCard>
              </div>
            </div>

            {/* Sidebar Stats */}
            <div className="space-y-8">
              <AppCard className="border-l-4 border-l-primary-600 shadow-sm flex flex-col">
                <AppCardHeader>
                  <AppCardTitle className="text-base">Business Insights</AppCardTitle>
                </AppCardHeader>
                <AppCardContent className="space-y-6 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                  {clinicData.commandCenter.alerts.map((alert) => (
                    <div key={alert.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <AlertCircle
                          className={cnUtils(
                            'h-4 w-4',
                            alert.severity === 'critical' ? 'text-rose-600' : 'text-amber-500'
                          )}
                        />
                        <p className="text-xs font-black uppercase tracking-wider">{alert.title}</p>
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">{alert.message}</p>
                    </div>
                  ))}
                  {clinicData.commandCenter.alerts.length === 0 && (
                    <p className="text-sm text-slate-400 italic">No alerts for this period.</p>
                  )}
                </AppCardContent>
              </AppCard>

              <AppCard className="bg-slate-900 text-white border-none">
                <AppCardHeader>
                  <AppCardTitle className="text-white text-base">Patient Analytics</AppCardTitle>
                </AppCardHeader>
                <AppCardContent className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b border-white/5">
                    <span className="text-sm text-slate-400">Unique Patients</span>
                    <span className="text-lg font-bold">
                      {clinicData.commandCenter.patients.distinctPatients}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-white/5">
                    <span className="text-sm text-slate-400">Repeat Visit Rate</span>
                    <span className="text-lg font-bold text-primary-400">
                      {formatPercent(clinicData.commandCenter.patients.repeatVisitRate)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-slate-400">Drop-off Risk</span>
                    <span className="text-lg font-bold text-rose-400">
                      {clinicData.commandCenter.patients.dropOffRiskCount}
                    </span>
                  </div>
                </AppCardContent>
              </AppCard>
            </div>
          </div>
        </div>
      )}

      {!isClinicMode && providerData && (
        <div className="space-y-10">
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <KPIStatCard
              label="Completed Visits"
              value={providerData.performance.completedAppointments}
              icon={CheckCircle2}
              iconClassName="text-blue-600 bg-blue-50"
            />
            <KPIStatCard
              label="Revenue Generated"
              value={formatMoney(providerData.performance.revenueGenerated)}
              icon={DollarSign}
              iconClassName="text-emerald-600 bg-emerald-50"
            />
            <KPIStatCard
              label="Utilization"
              value={formatPercent(providerData.performance.utilizationRate)}
              icon={Activity}
              iconClassName="text-indigo-600 bg-indigo-50"
            />
            <KPIStatCard
              label="Pending Commissions"
              value={formatMoney(providerData.commissions.owed)}
              icon={CreditCard}
              iconClassName="text-amber-600 bg-amber-50"
            />
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <AppCard className="border-none shadow-sm">
              <AppCardHeader className="bg-slate-50/50 border-b-0 py-6">
                <AppCardTitle className="font-bold">Patient Retention</AppCardTitle>
              </AppCardHeader>
              <AppCardContent className="p-8">
                <div className="grid grid-cols-2 gap-8">
                  <div className="text-center p-6 bg-slate-50 rounded-3xl">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">
                      Follow-up Rate
                    </p>
                    <p className="text-3xl font-black text-slate-900">
                      {formatPercent(providerData.performance.followUpConversionRate)}
                    </p>
                  </div>
                  <div className="text-center p-6 bg-slate-50 rounded-3xl">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">
                      Repeat Patients
                    </p>
                    <p className="text-3xl font-black text-slate-900">
                      {formatPercent(providerData.performance.repeatPatientRate)}
                    </p>
                  </div>
                </div>
              </AppCardContent>
            </AppCard>

            <AppCard className="border-none shadow-sm">
              <AppCardHeader className="bg-slate-50/50 border-b-0 py-6">
                <AppCardTitle className="font-bold">Top Performing Services</AppCardTitle>
              </AppCardHeader>
              <AppCardContent className="p-6">
                <div className="space-y-4">
                  {providerData.topServices.map((s) => (
                    <div key={s.serviceId} className="flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{s.serviceName}</p>
                        <p className="text-xs text-slate-500">{s.count} visits</p>
                      </div>
                      <span className="font-black text-slate-900">{formatMoney(s.revenue)}</span>
                    </div>
                  ))}
                </div>
              </AppCardContent>
            </AppCard>
          </div>
        </div>
      )}
    </PageContainer>
  )
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ')
}
