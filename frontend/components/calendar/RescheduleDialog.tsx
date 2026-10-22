'use client'

import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { dateKeyInZone, formatSlotTime, formatTime, formatWeekdayDate } from '@/lib/timezone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useQuery } from '@tanstack/react-query'
import { getAvailability } from '@/lib/providerApi'
import { createSlotHold, releaseSlotHold } from '@/lib/appointmentApi'
import { rescheduleAppointment } from '@/lib/patientApi'
import {
  SLOT_TAKEN_MESSAGE,
  bookingErrorMessage,
  isSlotUnavailableError,
} from '@/lib/bookingErrors'
import { useAppToast } from '@/hooks/useAppToast'
import type { TimeSlot } from '@/lib/types/booking'

/** The fields a reschedule needs — satisfied by both patient and staff appointment shapes. */
export interface ReschedulableAppointment {
  id: string
  clinicId: string
  serviceId: string
  providerId: string
  locationId: string | null
  startTime: string
}

interface RescheduleDialogProps {
  appointment: ReschedulableAppointment
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the id of the new appointment that replaces this one. */
  onSuccess: (newAppointmentId: string) => void
}

export function RescheduleDialog({
  appointment,
  open,
  onOpenChange,
  onSuccess,
}: RescheduleDialogProps) {
  const toast = useAppToast()
  const start = new Date(appointment.startTime)
  const [date, setDate] = useState(dateKeyInZone(start))
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [slotHoldId, setSlotHoldId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [slotTaken, setSlotTaken] = useState(false)

  const {
    data: slots = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: [
      'reschedule-availability',
      appointment.id,
      date,
      appointment.providerId,
      appointment.locationId,
      appointment.serviceId,
    ],
    queryFn: () =>
      getAvailability(
        appointment.clinicId,
        appointment.serviceId,
        date,
        appointment.providerId,
        appointment.locationId ?? undefined
      ),
    enabled: open && !!date,
  })

  React.useEffect(() => {
    return () => {
      if (slotHoldId) {
        void releaseSlotHold(slotHoldId, appointment.clinicId)
      }
    }
  }, [slotHoldId, appointment.clinicId])

  // A new date drops whatever hold was taken for the previous one. Read the
  // current hold through a ref so this runs on date change only.
  const slotHoldIdRef = React.useRef(slotHoldId)
  slotHoldIdRef.current = slotHoldId
  React.useEffect(() => {
    setSelectedSlot(null)
    setSlotTaken(false)
    const heldId = slotHoldIdRef.current
    if (heldId) {
      void releaseSlotHold(heldId, appointment.clinicId)
      setSlotHoldId(null)
    }
  }, [date, appointment.clinicId])

  /** The chosen time went to someone else: say so, drop it, show what is still open. */
  const recoverFromTakenSlot = () => {
    setSelectedSlot(null)
    setSlotHoldId(null)
    setSlotTaken(true)
    void refetch()
  }

  const handlePickSlot = async (slot: TimeSlot) => {
    setSlotTaken(false)
    try {
      if (slotHoldId) {
        await releaseSlotHold(slotHoldId, appointment.clinicId).catch(() => undefined)
      }
      const hold = await createSlotHold({
        clinicId: appointment.clinicId,
        providerId: slot.providerId,
        serviceId: slot.serviceId,
        locationId: slot.locationId ?? undefined,
        timezone: slot.timezone,
        startTime: slot.start,
        endTime: slot.end,
      })
      setSlotHoldId(hold.id)
      setSelectedSlot(slot)
    } catch (err) {
      if (isSlotUnavailableError(err)) recoverFromTakenSlot()
      else toast.error('Could not reserve that time. Please try again.')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedSlot) {
      toast.error('Select an available slot first')
      return
    }
    setIsSubmitting(true)
    try {
      const { newAppointment } = await rescheduleAppointment(appointment.id, {
        locationId: selectedSlot.locationId ?? undefined,
        slotHoldId: slotHoldId ?? undefined,
        newStartTime: selectedSlot.start,
        newEndTime: selectedSlot.end,
      })
      onSuccess(newAppointment.id)
      onOpenChange(false)
    } catch (err) {
      if (isSlotUnavailableError(err)) recoverFromTakenSlot()
      else toast.error(bookingErrorMessage(err, 'Failed to reschedule appointment'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule Appointment</DialogTitle>
          <DialogDescription className="text-slate-600">
            Currently {formatWeekdayDate(start)} · {formatTime(start)}. Your current time is kept
            until the new one is confirmed.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reschedule-date" className="mb-2 block text-sm font-medium">
              Date
            </label>
            <Input
              id="reschedule-date"
              type="date"
              value={date}
              min={dateKeyInZone()}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          {slotTaken && (
            <p
              role="status"
              data-testid="slot-taken-notice"
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            >
              {SLOT_TAKEN_MESSAGE}
            </p>
          )}
          <div>
            <p className="mb-2 block text-sm font-medium">Available slots</p>
            {isLoading ? (
              <p className="text-sm text-slate-600">Loading slots...</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-slate-600">No valid slots are available for this date.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {slots.map((slot) => (
                  <button
                    key={`${slot.providerId}-${slot.start}`}
                    type="button"
                    aria-pressed={selectedSlot?.start === slot.start}
                    onClick={() => void handlePickSlot(slot)}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      selectedSlot?.start === slot.start
                        ? 'border-primary-600 bg-primary-50 text-primary-700'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    {formatSlotTime(slot.start, date)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !selectedSlot}>
              {isSubmitting ? 'Rescheduling...' : 'Reschedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
