'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, Mic } from 'lucide-react'
import { getClinicAppointments, type ProviderAppointment } from '@/lib/patientApi'
import { useAuth } from '@/contexts/AuthContext'
import { AppCard, AppCardContent, AppCardHeader, AppCardTitle } from '@/components/ui-system'
import { StatusBadge } from '@/components/common/StatusBadge'
import { cn } from '@/lib/utils'

const ACTIVE = new Set(['CONFIRMED', 'PENDING_PAYMENT', 'PENDING_PROVIDER_APPROVAL'])

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfToday() {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * True when the signed-in user can scribe this visit: it is their own
 * appointment (the owner-doctor's Provider, CTO-14) and it hasn't finished.
 */
export function canStartScribe(
  appointment: Pick<ProviderAppointment, 'status' | 'provider'>,
  providerId: string | null | undefined
): boolean {
  return (
    !!providerId && appointment.provider?.id === providerId && appointment.status === 'CONFIRMED'
  )
}

/** The scribe entry point for a visit (CTO-30): straight into recording. */
export const scribeHref = (appointmentId: string) =>
  `/dashboard/provider/appointments/${appointmentId}/consultation?autostart=1`

/**
 * Command Center: today's appointments (CTO-19), with a Start scribe action on
 * the owner-doctor's own visits (CTO-30).
 */
export function TodayAppointmentsCard({ className }: { className?: string }) {
  const { user } = useAuth()
  const providerId = user?.provider?.isActive ? user.provider.id : null
  const { data, isLoading, isError } = useQuery({
    queryKey: ['appointments', 'today', 'clinic'],
    queryFn: () => getClinicAppointments(startOfToday(), endOfToday()),
    enabled: !!user?.clinicId,
    refetchInterval: 60_000,
  })
  const today = (data ?? [])
    .filter((a) => ACTIVE.has(a.status) || a.status === 'COMPLETED')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  return (
    <AppCard className={className} data-testid="today-appointments">
      <AppCardHeader className="flex flex-row items-center justify-between pb-3">
        <AppCardTitle className="flex items-center gap-2 text-sm">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-soft">
            <CalendarCheck className="h-3.5 w-3.5 text-brand" />
          </span>
          Today&apos;s appointments
        </AppCardTitle>
        <Link
          href="/dashboard/appointments"
          className="text-xs font-semibold text-brand hover:underline"
        >
          All appointments
        </Link>
      </AppCardHeader>
      <AppCardContent>
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading today&apos;s appointments…</p>
        ) : isError ? (
          <p className="text-sm text-slate-500">Today&apos;s appointments couldn&apos;t load.</p>
        ) : today.length === 0 ? (
          <p className="text-sm text-slate-500">
            No appointments today. Use{' '}
            <Link href="/dashboard/appointments?new=1" className="font-semibold text-brand">
              New appointment
            </Link>{' '}
            for a walk-in or phone booking.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {today.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="w-16 shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                  {formatTime(a.startTime)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {a.patient?.name ?? 'Patient'}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {a.service?.name}
                    {a.provider ? ` with ${a.provider.firstName} ${a.provider.lastName}` : ''}
                  </p>
                </div>
                <StatusBadge variant="appointment" status={a.status} />
                {canStartScribe(a, providerId) && (
                  <Link
                    href={scribeHref(a.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground',
                      'hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2'
                    )}
                  >
                    <Mic className="h-3.5 w-3.5" />
                    Start scribe
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </AppCardContent>
    </AppCard>
  )
}
