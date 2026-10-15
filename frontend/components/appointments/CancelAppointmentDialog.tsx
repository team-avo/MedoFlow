'use client'

/**
 * Cancel an appointment with the clinic's cancellation policy stated up
 * front (F1.3): when free cancellation ends, and the fee that applies inside
 * the window — so a patient or staff member sees the consequence before
 * confirming. Used on the patient's appointment page and the staff sheet.
 */
import React, { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Textarea } from '@/components/ui/textarea'
import { cancelAppointment } from '@/lib/patientApi'
import { bookingErrorMessage } from '@/lib/bookingErrors'
import {
  cancellationTerms,
  describeCancellationPolicy,
  type CancellationPolicyFields,
} from '@/lib/cancellationPolicy'
import { useAppToast } from '@/hooks/useAppToast'

export interface CancellableAppointment {
  id: string
  startTime: string
  priceAtBooking?: string | number | null
  service: { name: string } & CancellationPolicyFields
}

interface CancelAppointmentDialogProps {
  appointment: CancellableAppointment
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancelled: () => void
  /** Staff view: who the visit is for. Patients see "your appointment". */
  forLabel?: string
}

export function CancelAppointmentDialog({
  appointment,
  open,
  onOpenChange,
  onCancelled,
  forLabel,
}: CancelAppointmentDialogProps) {
  const toast = useAppToast()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const terms = cancellationTerms(appointment.service, appointment)

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      const result = await cancelAppointment(appointment.id, reason.trim())
      if (result.lateCancellation && result.cancellationFee?.amount) {
        toast.info(
          `Appointment cancelled. A late-cancellation fee of $${Number(result.cancellationFee.amount).toFixed(2)} applies.`
        )
      } else {
        toast.success('Appointment cancelled')
      }
      setReason('')
      onOpenChange(false)
      onCancelled()
    } catch (err) {
      toast.error(bookingErrorMessage(err, 'Could not cancel the appointment. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel appointment?</AlertDialogTitle>
          <AlertDialogDescription className="text-slate-600">
            {forLabel
              ? `This cancels ${appointment.service.name} for ${forLabel}.`
              : `This cancels your ${appointment.service.name} appointment.`}{' '}
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p
          data-testid="cancellation-policy"
          className={
            terms.lateNow && !terms.free
              ? 'rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900'
              : 'rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700'
          }
        >
          {describeCancellationPolicy(terms)}
        </p>
        <div className="space-y-1.5">
          <label htmlFor="cancel-reason" className="text-sm font-medium text-slate-700">
            Reason (optional)
          </label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Keep appointment</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              void handleConfirm()
            }}
            disabled={submitting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {submitting ? 'Cancelling…' : 'Cancel appointment'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
