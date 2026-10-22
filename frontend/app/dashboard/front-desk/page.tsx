'use client'

import { useQuery } from '@tanstack/react-query'
import React, { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { getInvoices } from '@/lib/invoiceApi'
import { getClinicAppointments } from '@/lib/patientApi'
import {
  AppCard,
  AppCardHeader,
  AppCardTitle,
  AppCardContent,
  AppPageHeader,
  AppButton,
  KPIStatCard,
  DateRangeFilter,
} from '@/components/ui-system'
import { formatTime } from '@/lib/timezone'
import type { DateRangeOption, DateRange } from '@/components/ui-system/DateRangeFilter'
import { PageContainer } from '@/components/layout'
import { AppTable } from '@/components/ui-system/AppTable'
import { StatusBadge } from '@/components/common/StatusBadge'
import {
  CreditCard,
  CalendarDays,
  DollarSign,
  ArrowRight,
  ShoppingCart,
  Users,
  Clock,
} from 'lucide-react'

export default function FrontDeskDashboardPage() {
  const { user } = useAuth()
  if (user && user.role !== 'FRONT_DESK') {
    return null
  }
  return <FrontDeskDashboardContent />
}

function FrontDeskDashboardContent() {
  const { user } = useAuth()
  const clinicId = user?.clinicId ?? ''

  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>('ALL_TIME')
  const [dateRangeValues, setDateRangeValues] = useState<DateRange>({})

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => getInvoices(),
    enabled: !!clinicId,
  })

  const { data: appointments = [], isLoading: appointmentsLoading } = useQuery({
    queryKey: ['clinic-appointments', dateRangeOption],
    queryFn: () => getClinicAppointments(dateRangeValues.startDate, dateRangeValues.endDate),
    enabled: !!clinicId,
  })

  const filteredInvoices = invoices.filter((i) => {
    if (!dateRangeValues.startDate || !dateRangeValues.endDate) return true
    const createdAt = new Date(i.createdAt)
    return createdAt >= dateRangeValues.startDate && createdAt <= dateRangeValues.endDate
  })

  const unpaidInvoices = filteredInvoices.filter(
    (i) => i.status === 'DRAFT' || i.status === 'FINALIZED' || i.status === 'PENDING_PAYMENT'
  )

  const upcomingToday = appointments
    .filter((a) => a.status !== 'CANCELLED' && a.status !== 'NO_SHOW')
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())

  const isLoading = invoicesLoading || appointmentsLoading

  return (
    <PageContainer className="space-y-8">
      <AppPageHeader
        title="Operations Desk"
        description="Daily clinical management and rapid checkout console."
        actions={
          <div className="flex gap-4 items-center">
            <DateRangeFilter
              value={dateRangeOption}
              onChange={(opt, range) => {
                setDateRangeOption(opt)
                setDateRangeValues(range)
              }}
            />
            <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>
            <AppButton asChild className="rounded-full px-6 shadow-md">
              <Link href="/dashboard/front-desk/pos">
                <ShoppingCart className="mr-2 h-4 w-4" />
                Open POS
              </Link>
            </AppButton>
          </div>
        }
      />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <KPIStatCard
          label={dateRangeOption === 'ALL_TIME' ? 'All Bookings' : 'Period Schedule'}
          value={isLoading ? '...' : upcomingToday.length}
          icon={CalendarDays}
          description="Total active appointments"
          iconClassName="text-blue-600 bg-blue-50"
        />
        <KPIStatCard
          label="Unpaid Items"
          value={isLoading ? '...' : unpaidInvoices.length}
          icon={DollarSign}
          description="Awaiting collection"
          iconClassName="text-amber-600 bg-amber-50"
        />
        <KPIStatCard
          label="Waiting List"
          value="0"
          icon={Users}
          description="Patients ready for offers"
          iconClassName="text-purple-600 bg-purple-50"
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main Queue */}
        <div className="lg:col-span-2 space-y-6">
          <AppCard className="border-none shadow-sm overflow-hidden">
            <AppCardHeader className="flex flex-row items-center justify-between bg-slate-50/50 border-b-0 py-6">
              <AppCardTitle className="text-lg font-bold">Today's Appointment Queue</AppCardTitle>
              <AppButton variant="ghost" size="sm" className="text-primary-600" asChild>
                <Link href="/dashboard/appointments">
                  Full View <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </AppButton>
            </AppCardHeader>
            <AppCardContent className="p-0">
              {isLoading ? (
                <div className="p-12 flex justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-primary" />
                </div>
              ) : upcomingToday.length === 0 ? (
                <div className="p-12 text-center text-slate-500 bg-white">
                  <Clock className="h-12 w-12 mx-auto mb-4 opacity-10" />
                  <p>No more appointments scheduled for today.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <AppTable
                    mobileCardMode
                    columns={[
                      {
                        key: 'time',
                        header: 'Time',
                        render: (apt) => (
                          <div className="font-bold text-slate-900">
                            {formatTime(apt.startTime)}
                          </div>
                        ),
                      },
                      {
                        key: 'patient',
                        header: 'Patient',
                        mobilePrimary: true,
                        render: (apt) => (
                          <div>
                            <div className="font-bold text-slate-900">
                              {apt.patient?.name ?? '—'}
                            </div>
                            <div className="text-xs text-slate-500">{apt.patient?.email}</div>
                          </div>
                        ),
                      },
                      {
                        key: 'service',
                        header: 'Service',
                        render: (apt) => (
                          <div className="text-sm font-medium text-slate-600">
                            {apt.service?.name ?? '—'}
                          </div>
                        ),
                      },
                      {
                        key: 'provider',
                        header: 'Provider',
                        render: (apt) => (
                          <div className="text-sm text-slate-600 italic">
                            Dr. {apt.provider ? `${apt.provider.lastName}` : '—'}
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
                        render: (apt) => (
                          <AppButton variant="ghost" size="sm" className="rounded-full" asChild>
                            <Link href={`/dashboard/appointments`}>Manage</Link>
                          </AppButton>
                        ),
                      },
                    ]}
                    data={upcomingToday}
                    keyExtractor={(apt) => apt.id}
                  />
                </div>
              )}
            </AppCardContent>
          </AppCard>
        </div>

        {/* Quick Tools Sidebar */}
        <div className="space-y-6">
          <AppCard className="bg-slate-900 text-white border-none overflow-hidden">
            <AppCardContent className="p-8 space-y-6">
              <h3 className="text-lg font-bold">Rapid Checkout</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Processing a walk-in or product sale? Use the POS console for immediate billing.
              </p>
              <AppButton
                className="w-full bg-primary-600 hover:bg-primary-700 border-none rounded-full font-bold shadow-lg"
                asChild
              >
                <Link href="/dashboard/front-desk/pos">New Transaction</Link>
              </AppButton>
            </AppCardContent>
          </AppCard>

          <AppCard className="border-none shadow-sm overflow-hidden">
            <AppCardHeader className="bg-slate-50/50 border-b-0 py-4 px-6">
              <AppCardTitle className="text-sm font-black uppercase tracking-widest text-slate-400">
                Quick Patient Lookup
              </AppCardTitle>
            </AppCardHeader>
            <AppCardContent className="p-6">
              <div className="relative">
                <Link
                  href="/dashboard/patients"
                  className="block w-full p-4 rounded-2xl bg-slate-50 border border-slate-100 text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  Search directory...
                </Link>
              </div>
            </AppCardContent>
          </AppCard>
        </div>
      </div>
    </PageContainer>
  )
}
