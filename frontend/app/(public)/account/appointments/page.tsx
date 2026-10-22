'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { getMyAppointments, type PatientAppointment } from '@/lib/patientApi'
import { StatusBadge } from '@/components/common/StatusBadge'
import { useBookingModal } from '@/components/booking/BookingModal'
import {
  AppPageHeader,
  AppTable,
  AppButton,
  LoadingSkeleton,
  AppErrorState,
} from '@/components/ui-system'
import { formatDateTime } from '@/lib/timezone'

export default function AccountAppointmentsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const bookingModal = useBookingModal()
  const {
    data: appointments,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['patient', 'appointments'],
    queryFn: () => getMyAppointments(),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <AppPageHeader title="Appointments" description="Upcoming and past visits" />
        <LoadingSkeleton variant="table" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <AppPageHeader title="Appointments" description="Upcoming and past visits" />
        <AppErrorState
          title="Could not load your appointments"
          description="Check your connection and try again."
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AppPageHeader
        title="Appointments"
        description="Upcoming and past visits"
        actions={
          <AppButton size="sm" onClick={bookingModal.open}>
            Book appointment
          </AppButton>
        }
      />

      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
        <AppTable
          columns={[
            {
              key: 'service',
              header: 'Service',
              render: (apt: PatientAppointment) => (
                <span className="font-semibold text-slate-900">{apt.service.name}</span>
              ),
            },
            {
              key: 'provider',
              header: 'Provider',
              render: (apt: PatientAppointment) => (
                <span className="text-slate-600">
                  {apt.provider.firstName} {apt.provider.lastName}
                </span>
              ),
            },
            {
              key: 'datetime',
              header: 'Date & Time',
              render: (apt: PatientAppointment) => (
                <span className="text-slate-600 font-medium">{formatDateTime(apt.startTime)}</span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (apt: PatientAppointment) => (
                <StatusBadge status={apt.status} variant="appointment" />
              ),
            },
            {
              key: 'actions',
              header: '',
              className: 'text-right',
              render: (apt: PatientAppointment) => (
                <AppButton variant="ghost" size="sm" asChild className="rounded-full">
                  <Link href={`/account/appointments/${apt.id}`}>View</Link>
                </AppButton>
              ),
            },
          ]}
          data={appointments ?? []}
          keyExtractor={(apt: PatientAppointment) => apt.id}
          emptyTitle="No appointments yet"
          emptyDescription="Book your first appointment to get started."
          emptyActionLabel="Book appointment"
          onEmptyAction={bookingModal.open}
        />
      </div>
    </div>
  )
}
