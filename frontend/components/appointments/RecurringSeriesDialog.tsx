'use client'

/**
 * Staff: book a weekly recurring series for a patient (F1.2). Pick the
 * patient, service, clinician and the first visit's time from live
 * availability; the server books each week and reports any dates it had to
 * skip. Skipped dates open the conflict review, where staff keep the partial
 * series or cancel it outright.
 */
import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RecurringConflictModal } from '@/components/RecurringConflictModal'
import { getClinicPatients } from '@/lib/patientApi'
import { getClinicServices } from '@/lib/serviceApi'
import { getAvailability, getClinicProviders } from '@/lib/providerApi'
import {
  cancelRecurringSeries,
  createRecurringSeries,
  type CreateRecurringSeriesResponse,
} from '@/lib/recurringApi'
import { bookingErrorMessage } from '@/lib/bookingErrors'
import { useAppToast } from '@/hooks/useAppToast'
import type { TimeSlot } from '@/lib/types/booking'
import { format } from 'date-fns'

interface RecurringSeriesDialogProps {
  clinicId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function RecurringSeriesDialog({
  clinicId,
  open,
  onOpenChange,
  onChanged,
}: RecurringSeriesDialogProps) {
  const toast = useAppToast()
  const [patientId, setPatientId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [slot, setSlot] = useState<TimeSlot | null>(null)
  const [sessions, setSessions] = useState(6)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CreateRecurringSeriesResponse | null>(null)

  const { data: patients = [] } = useQuery({
    queryKey: ['clinic-patients'],
    queryFn: getClinicPatients,
    enabled: open,
  })
  const { data: services = [] } = useQuery({
    queryKey: ['clinic-services', clinicId],
    queryFn: () => getClinicServices(clinicId),
    enabled: open,
  })
  const { data: providers = [] } = useQuery({
    queryKey: ['clinic-providers', clinicId],
    queryFn: () => getClinicProviders(clinicId),
    enabled: open,
  })
  const eligibleProviders = useMemo(
    () => providers.filter((p) => p.providerServices.some((ps) => ps.serviceId === serviceId)),
    [providers, serviceId]
  )
  const { data: slots = [], isFetching: slotsLoading } = useQuery({
    queryKey: ['series-availability', clinicId, serviceId, providerId, date],
    queryFn: () => getAvailability(clinicId, serviceId, date, providerId),
    enabled: open && !!serviceId && !!providerId && !!date,
  })

  const reset = () => {
    setPatientId('')
    setServiceId('')
    setProviderId('')
    setSlot(null)
    setSessions(6)
    setResult(null)
  }

  const close = () => {
    reset()
    onOpenChange(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!patientId || !slot) return
    setSubmitting(true)
    try {
      const res = await createRecurringSeries({
        clinicId,
        patientId,
        serviceId,
        providerId,
        locationId: slot.locationId ?? undefined,
        startTime: slot.start,
        endTime: slot.end,
        frequency: 'WEEKLY',
        numberOfSessions: sessions,
      })
      onChanged()
      if (res.conflicts.length > 0) {
        setResult(res)
        return
      }
      toast.success(`Recurring series booked — ${res.appointments.length} weekly visits`)
      close()
    } catch (err) {
      toast.error(bookingErrorMessage(err, 'Could not book the series. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  const undoSeries = async () => {
    const seriesId = result?.appointments[0]?.recurringSeriesId
    try {
      if (seriesId) await cancelRecurringSeries(seriesId, 'Series not kept after conflicts')
      toast.success('Series cancelled')
      onChanged()
    } catch (err) {
      toast.error(bookingErrorMessage(err, 'Could not cancel the series.'))
    }
    close()
  }

  return (
    <>
      <Dialog open={open && !result} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New recurring series</DialogTitle>
            <DialogDescription className="text-slate-600">
              Books the same time every week. Dates that are unavailable are skipped and listed.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="series-patient" className="text-sm font-medium">
                Patient
              </label>
              <select
                id="series-patient"
                className={selectClass}
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                required
              >
                <option value="">Select a patient</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="series-service" className="text-sm font-medium">
                  Service
                </label>
                <select
                  id="series-service"
                  className={selectClass}
                  value={serviceId}
                  onChange={(e) => {
                    setServiceId(e.target.value)
                    setProviderId('')
                    setSlot(null)
                  }}
                  required
                >
                  <option value="">Select a service</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="series-provider" className="text-sm font-medium">
                  Clinician
                </label>
                <select
                  id="series-provider"
                  className={selectClass}
                  value={providerId}
                  onChange={(e) => {
                    setProviderId(e.target.value)
                    setSlot(null)
                  }}
                  disabled={!serviceId}
                  required
                >
                  <option value="">Select a clinician</option>
                  {eligibleProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="series-date" className="text-sm font-medium">
                  First visit
                </label>
                <Input
                  id="series-date"
                  type="date"
                  value={date}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  onChange={(e) => {
                    setDate(e.target.value)
                    setSlot(null)
                  }}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="series-sessions" className="text-sm font-medium">
                  Weekly visits
                </label>
                <Input
                  id="series-sessions"
                  type="number"
                  min={2}
                  max={52}
                  value={sessions}
                  onChange={(e) => setSessions(Math.min(52, Math.max(2, Number(e.target.value))))}
                  required
                />
              </div>
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Time</legend>
              {!serviceId || !providerId ? (
                <p className="text-sm text-slate-600">
                  Choose a service and clinician to see times.
                </p>
              ) : slotsLoading ? (
                <p className="text-sm text-slate-600">Loading times…</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-slate-600">No open times on this date.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      aria-pressed={slot?.start === s.start}
                      onClick={() => setSlot(s)}
                      className={`rounded-md border px-2 py-1.5 text-sm ${
                        slot?.start === s.start
                          ? 'border-primary-600 bg-primary-50 text-primary-700'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      {new Date(s.start).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Close
              </Button>
              <Button type="submit" disabled={submitting || !patientId || !slot}>
                {submitting ? 'Booking…' : 'Book series'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <RecurringConflictModal
        isOpen={!!result}
        conflicts={result?.conflicts ?? []}
        createdCount={result?.appointments.length ?? 0}
        onClose={close}
        onProceedPartial={() => {
          toast.success(
            `Recurring series booked — ${result?.appointments.length ?? 0} weekly visits`
          )
          close()
        }}
        onCancel={() => void undoSeries()}
      />
    </>
  )
}
