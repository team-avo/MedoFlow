'use client'

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/common/StatusBadge'
import { getAppointmentById, type ProviderAppointment } from '@/lib/patientApi'
import { cancellationTerms, describeCancellationPolicy } from '@/lib/cancellationPolicy'
import { CancelAppointmentDialog } from '@/components/appointments/CancelAppointmentDialog'
import { CancelSeriesDialog } from '@/components/appointments/CancelSeriesDialog'
import { RescheduleDialog } from './RescheduleDialog'
import { useAppToast } from '@/hooks/useAppToast'
import { formatDate, formatTime } from '@/lib/timezone'

interface AppointmentSheetProps {
  appointment: ProviderAppointment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  /** Front desk / admin may cancel a whole recurring series. */
  canManageSeries?: boolean
}

export function AppointmentSheet({
  appointment,
  open,
  onOpenChange,
  onSuccess,
  canManageSeries = false,
}: AppointmentSheetProps) {
  const toast = useAppToast()
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [seriesOpen, setSeriesOpen] = useState(false)

  // The list view carries no policy fields; the detail does (F1.3).
  const { data: detail } = useQuery({
    queryKey: ['appointment-detail', appointment?.id],
    queryFn: () => getAppointmentById(appointment!.id),
    enabled: open && !!appointment?.id,
  })

  const isLive =
    !!appointment &&
    appointment.status !== 'CANCELLED' &&
    appointment.status !== 'RESCHEDULED' &&
    appointment.status !== 'COMPLETED' &&
    appointment.status !== 'NO_SHOW'
  const canReschedule = isLive
  const canCancel = isLive
  const seriesId = appointment?.recurringSeriesId ?? detail?.recurringSeriesId ?? null

  const handleRescheduleSuccess = () => {
    setRescheduleOpen(false)
    onSuccess()
    toast.success('Appointment rescheduled')
  }

  if (!appointment) return null

  const cancellable = {
    id: appointment.id,
    startTime: appointment.startTime,
    priceAtBooking: appointment.priceAtBooking,
    service: { ...appointment.service, ...(detail?.service ?? {}) },
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Appointment Details</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Patient</p>
              <p className="mt-1 font-medium">{appointment.patient.name}</p>
              {appointment.patient.email && (
                <p className="text-sm text-muted-foreground">{appointment.patient.email}</p>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Service</p>
              <p className="mt-1">{appointment.service.name}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Date & Time</p>
              <p className="mt-1">
                {formatDate(appointment.startTime)} · {formatTime(appointment.startTime)}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Status</p>
              <StatusBadge status={appointment.status} variant="appointment" className="mt-1" />
            </div>
            {seriesId && (
              <p className="text-sm text-muted-foreground">Part of a weekly recurring series.</p>
            )}
            {isLive && detail && (
              <p className="text-xs text-muted-foreground">
                {describeCancellationPolicy(cancellationTerms(detail.service, cancellable))}
              </p>
            )}
          </div>
          <SheetFooter className="mt-8 flex-wrap gap-2">
            {canReschedule && (
              <Button variant="outline" onClick={() => setRescheduleOpen(true)}>
                Reschedule
              </Button>
            )}
            {canCancel && (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                Cancel
              </Button>
            )}
            {canManageSeries && seriesId && (
              <Button variant="outline" onClick={() => setSeriesOpen(true)}>
                Cancel series
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {rescheduleOpen && (
        <RescheduleDialog
          appointment={appointment}
          open={rescheduleOpen}
          onOpenChange={setRescheduleOpen}
          onSuccess={handleRescheduleSuccess}
        />
      )}

      <CancelAppointmentDialog
        appointment={cancellable}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        forLabel={appointment.patient.name}
        onCancelled={() => {
          onSuccess()
          onOpenChange(false)
        }}
      />

      {seriesId && (
        <CancelSeriesDialog
          seriesId={seriesId}
          open={seriesOpen}
          onOpenChange={setSeriesOpen}
          onCancelled={() => {
            onSuccess()
            onOpenChange(false)
          }}
        />
      )}
    </>
  )
}
