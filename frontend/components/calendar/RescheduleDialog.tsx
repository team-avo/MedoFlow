'use client'

import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useQuery } from '@tanstack/react-query'
import { getAvailability } from '@/lib/providerApi'
import { createSlotHold, releaseSlotHold } from '@/lib/appointmentApi'
import { rescheduleAppointment, type ProviderAppointment } from '@/lib/patientApi'
import { useAppToast } from '@/hooks/useAppToast'
import { format } from 'date-fns'
import type { TimeSlot } from '@/lib/types/booking'

interface RescheduleDialogProps {
  appointment: ProviderAppointment
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function RescheduleDialog({
  appointment,
  open,
  onOpenChange,
  onSuccess,
}: RescheduleDialogProps) {
  const toast = useAppToast()
  const start = new Date(appointment.startTime)
  const [date, setDate] = useState(format(start, 'yyyy-MM-dd'))
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [slotHoldId, setSlotHoldId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data: slots = [], isLoading } = useQuery({
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
        appointment.locationId
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
    const heldId = slotHoldIdRef.current
    if (heldId) {
      void releaseSlotHold(heldId, appointment.clinicId)
      setSlotHoldId(null)
    }
  }, [date, appointment.clinicId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedSlot) {
      toast.error('Select an available slot first')
      return
    }
    setIsSubmitting(true)
    try {
      await rescheduleAppointment(appointment.id, {
        locationId: selectedSlot.locationId ?? undefined,
        slotHoldId: slotHoldId ?? undefined,
        newStartTime: selectedSlot.start,
        newEndTime: selectedSlot.end,
      })
      onSuccess()
      onOpenChange(false)
    } catch {
      toast.error('Failed to reschedule appointment')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule Appointment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Date</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Available slots</label>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading slots...</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No valid slots are available for this date.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {slots.map((slot) => (
                  <button
                    key={`${slot.providerId}-${slot.start}`}
                    type="button"
                    onClick={async () => {
                      if (slotHoldId) {
                        await releaseSlotHold(slotHoldId, appointment.clinicId)
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
                    }}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      selectedSlot?.start === slot.start
                        ? 'border-primary-600 bg-primary-50 text-primary-700'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    {new Date(slot.start).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
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
