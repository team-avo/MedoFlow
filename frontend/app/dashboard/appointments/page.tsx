'use client'

import React, { useState } from 'react'

import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  getMyAppointments,
  getProviderAppointments,
  getClinicAppointments,
  type PatientAppointment,
  type ProviderAppointment,
} from '@/lib/patientApi'
import { formatDateTime } from '@/lib/timezone'
import {
  AppCard,
  AppCardHeader,
  AppCardTitle,
  AppCardContent,
  AppButton,
  AppPageHeader,
  AppEmptyState,
  AppTable,
  KPIStatCard,
  DateRangeFilter,
  LoadingSkeleton,
} from '@/components/ui-system'
import type { DateRangeOption, DateRange } from '@/components/ui-system/DateRangeFilter'
import { PageContainer } from '@/components/layout'
import { StatusBadge } from '@/components/common/StatusBadge'
import { RecurringSeriesDialog } from '@/components/appointments/RecurringSeriesDialog'
import { CancelSeriesDialog } from '@/components/appointments/CancelSeriesDialog'
import { Calendar, User, Clock, CheckCircle2, AlertCircle, ArrowRight, Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function AppointmentsPage() {
  const { user } = useAuth()
  const isProvider = user?.role === 'PROVIDER'
  const isPatient = user?.role === 'PATIENT'
  const isStaffOrAdmin =
    user?.role === 'FRONT_DESK' || user?.role === 'SUPER_ADMIN' || user?.role === 'STAFF'

  // F1.2: front desk / admin book and cancel weekly recurring series.
  const canManageSeries = user?.role === 'FRONT_DESK' || user?.role === 'SUPER_ADMIN'
  const queryClient = useQueryClient()
  const [seriesDialogOpen, setSeriesDialogOpen] = useState(false)
  const [cancelSeriesId, setCancelSeriesId] = useState<string | null>(null)
  const refreshAppointments = () =>
    void queryClient.invalidateQueries({ queryKey: ['appointments'] })

  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>('ALL_TIME')
  const [dateRangeValues, setDateRangeValues] = useState<DateRange>({})

  const {
    data: appointments = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['appointments', user?.role, dateRangeOption],
    queryFn: async () => {
      const { startDate, endDate } = dateRangeValues
      if (isPatient) return getMyAppointments(startDate, endDate)
      if (isProvider) return getProviderAppointments(startDate, endDate)
      if (isStaffOrAdmin) return getClinicAppointments(startDate, endDate)
      return [] as (PatientAppointment | ProviderAppointment)[]
    },
    enabled: isPatient || isProvider || (isStaffOrAdmin && !!user?.clinicId),
  })

  const subtitle = isPatient
    ? 'View and manage your upcoming visits and care history.'
    : 'Clinical schedule and appointment management console.'

  const totalCount = appointments.length
  const completedCount = appointments.filter((a) => a.status === 'COMPLETED').length
  const pendingCount = appointments.filter((a) => a.status.includes('PENDING')).length

  return (
    <PageContainer className="space-y-8">
      {/* Hero */}
      <div className="relative overflow-clip rounded-3xl border border-[#E5E7EB] bg-gradient-to-br from-[#1E3A5F] via-[#23436B] to-[#0F766E] text-white">
        <div className="relative flex flex-col gap-6 p-8 lg:flex-row lg:items-end lg:justify-between lg:p-10">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
              <span className="h-1.5 w-1.5 rounded-full bg-[#14B8A6]" />
              Clinical Queue
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Clinical Schedule</h1>
            <p className="max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
              {subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canManageSeries && user?.clinicId && (
              <AppButton
                onClick={() => setSeriesDialogOpen(true)}
                className="rounded-full bg-white font-semibold text-[#1E3A5F] hover:bg-white/90"
              >
                <Repeat className="mr-2 h-4 w-4" /> New recurring series
              </AppButton>
            )}
            <DateRangeFilter
              value={dateRangeOption}
              onChange={(opt, range) => {
                setDateRangeOption(opt)
                setDateRangeValues(range)
              }}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <KPIStatCard
          label="Total Bookings"
          value={totalCount}
          icon={Calendar}
          iconClassName="text-[#6366F1] bg-[#EEF2FF]"
        />
        <KPIStatCard
          label="Completed Visits"
          value={completedCount}
          icon={CheckCircle2}
          iconClassName="text-[#0D9488] bg-[#F0FDFA]"
        />
        <KPIStatCard
          label="Pending Items"
          value={pendingCount}
          icon={AlertCircle}
          iconClassName="text-[#F59E0B] bg-[#FFFBEB]"
        />
      </div>

      <AppCard className="overflow-hidden border border-[#E5E7EB] bg-white shadow-none">
        <AppCardHeader className="flex flex-row items-center justify-between border-b border-[#E5E7EB] bg-gradient-to-r from-white via-[#F8FAFC] to-[#F0FDFA] py-5">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#1E3A5F] to-[#0F766E] text-white shadow-sm">
              <Calendar className="h-4 w-4" />
            </span>
            <div>
              <AppCardTitle className="text-base font-bold">Appointment Registry</AppCardTitle>
              <p className="text-xs font-medium text-slate-500">
                {totalCount === 0
                  ? 'No visits in range'
                  : `${totalCount} visit${totalCount > 1 ? 's' : ''} · ${completedCount} completed`}
              </p>
            </div>
          </div>
        </AppCardHeader>
        <AppCardContent className="p-0">
          {isLoading ? (
            <div className="p-6">
              <LoadingSkeleton variant="table" />
            </div>
          ) : appointments.length === 0 ? (
            <div className="p-12">
              <AppEmptyState
                title="No appointments found"
                description={
                  isPatient
                    ? 'Book your first visit to get started.'
                    : 'The clinical schedule is currently empty.'
                }
                actionLabel={isPatient ? 'Book Appointment' : undefined}
                onAction={isPatient ? () => window.location.assign('/') : undefined}
              />
            </div>
          ) : (
            <AppTable
              mobileCardMode
              columns={[
                {
                  key: 'service',
                  header: 'Visit Details',
                  mobilePrimary: true,
                  render: (apt) => (
                    <div>
                      <p className="font-bold text-slate-900">{apt.service.name}</p>
                      {apt.recurringSeriesId && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                          <Repeat className="h-3 w-3" /> Weekly series
                        </span>
                      )}
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" /> {formatDateTime(apt.startTime)}
                      </p>
                    </div>
                  ),
                },
                {
                  key: 'party',
                  header: isPatient ? 'Provider' : 'Patient',
                  render: (apt) => (
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-black text-slate-500">
                        {isPatient
                          ? (apt as any).provider?.lastName?.[0]
                          : (apt as any).patient?.name?.[0]}
                      </div>
                      <p className="text-sm font-medium text-slate-700">
                        {isPatient
                          ? `Dr. ${(apt as any).provider?.lastName}`
                          : (apt as any).patient?.name}
                      </p>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (apt) => <StatusBadge status={apt.status} variant="appointment" />,
                },
                {
                  key: 'actions',
                  header: '',
                  className: 'text-right',
                  render: (apt) => (
                    <div className="flex justify-end gap-1 pr-4">
                      {canManageSeries &&
                        apt.recurringSeriesId &&
                        apt.status !== 'CANCELLED' &&
                        apt.status !== 'RESCHEDULED' && (
                          <AppButton
                            variant="ghost"
                            size="sm"
                            className="rounded-full font-bold text-destructive"
                            onClick={() => setCancelSeriesId(apt.recurringSeriesId ?? null)}
                          >
                            Cancel series
                          </AppButton>
                        )}
                      <AppButton
                        variant="ghost"
                        size="sm"
                        className="rounded-full font-bold text-primary-600"
                        asChild
                      >
                        <Link
                          href={
                            isPatient
                              ? `/account/appointments/${apt.id}`
                              : `/dashboard/provider/appointments/${apt.id}`
                          }
                        >
                          View Details <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </AppButton>
                    </div>
                  ),
                },
              ]}
              data={appointments.sort(
                (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
              )}
              keyExtractor={(apt) => apt.id}
            />
          )}
        </AppCardContent>
      </AppCard>

      {canManageSeries && user?.clinicId && (
        <RecurringSeriesDialog
          clinicId={user.clinicId}
          open={seriesDialogOpen}
          onOpenChange={setSeriesDialogOpen}
          onChanged={refreshAppointments}
        />
      )}
      {cancelSeriesId && (
        <CancelSeriesDialog
          seriesId={cancelSeriesId}
          open={!!cancelSeriesId}
          onOpenChange={(o) => !o && setCancelSeriesId(null)}
          onCancelled={refreshAppointments}
        />
      )}
    </PageContainer>
  )
}
