'use client'

/**
 * Patient self-service on an upcoming appointment (F1.3): reschedule or
 * cancel, with the clinic's cancellation policy stated before either. Only
 * offered while the visit is in the future and still live; past, completed,
 * cancelled or already-rescheduled visits show no actions. URLs carry the
 * appointment id only — no patient details.
 */
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, XCircle } from 'lucide-react'
import { AppButton, AppCard, AppCardContent } from '@/components/ui-system'
import { CancelAppointmentDialog } from '@/components/appointments/CancelAppointmentDialog'
import { RescheduleDialog } from '@/components/calendar/RescheduleDialog'
import { cancellationTerms, describeCancellationPolicy } from '@/lib/cancellationPolicy'
import type { PatientAppointmentDetail } from '@/lib/patientApi'
import { useAppToast } from '@/hooks/useAppToast'

const SELF_SERVICE_STATUSES = new Set([
  'CONFIRMED',
  'PENDING_PROVIDER_APPROVAL',
  'PENDING_PAYMENT',
  'DRAFT',
])

export function canSelfServe(
  appointment: Pick<PatientAppointmentDetail, 'status' | 'startTime'>,
  now: Date = new Date()
): boolean {
  return SELF_SERVICE_STATUSES.has(appointment.status) && new Date(appointment.startTime) > now
}

export function PatientAppointmentActions({
  appointment,
}: {
  appointment: PatientAppointmentDetail
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const toast = useAppToast()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)

  if (!canSelfServe(appointment)) return null

  const policy = describeCancellationPolicy(cancellationTerms(appointment.service, appointment))
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['patient', 'appointment', appointment.id] })
    void queryClient.invalidateQueries({ queryKey: ['appointments'] })
  }

  return (
    <AppCard className="border-none bg-white shadow-sm">
      <AppCardContent className="space-y-4 p-6">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Need to change this visit?</h2>
          <p data-testid="appointment-policy" className="mt-1 text-xs text-slate-500">
            {policy}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <AppButton
            variant="outline"
            className="w-full rounded-full"
            onClick={() => setRescheduleOpen(true)}
          >
            <CalendarClock className="mr-2 h-4 w-4" /> Reschedule
          </AppButton>
          <AppButton
            variant="ghost"
            className="w-full rounded-full text-destructive hover:text-destructive"
            onClick={() => setCancelOpen(true)}
          >
            <XCircle className="mr-2 h-4 w-4" /> Cancel appointment
          </AppButton>
        </div>
      </AppCardContent>

      <CancelAppointmentDialog
        appointment={appointment}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onCancelled={refresh}
      />
      {rescheduleOpen && (
        <RescheduleDialog
          appointment={appointment}
          open={rescheduleOpen}
          onOpenChange={setRescheduleOpen}
          onSuccess={(newId) => {
            toast.success('Appointment rescheduled')
            refresh()
            router.replace(`/account/appointments/${newId}`)
          }}
        />
      )}
    </AppCard>
  )
}
