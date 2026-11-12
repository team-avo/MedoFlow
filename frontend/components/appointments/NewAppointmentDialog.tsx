'use client'

/**
 * Staff: book one appointment from the dashboard (CTO-24). For the owner (who
 * is often the doctor), the front desk, or a custom role with
 * `appointments.create`: a walk-in or a phone booking, with no website needed.
 *
 * Find the patient, or add one with a name and an email or phone (no password;
 * an optional invite link is shown for copying). Pick the service, clinician,
 * location and a time from real availability, or press "Walk-in, now" for the
 * next free time today. A prepay service can be marked "collect at desk".
 */
import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, UserPlus, Zap } from 'lucide-react'
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
import { dateKeyInZone, formatSlotTime } from '@/lib/timezone'
import { getClinicPatients } from '@/lib/patientApi'
import {
  createClinicPatient,
  createStaffAppointment,
  getStaffLocations,
  getStaffProviders,
  getStaffServices,
  getStaffSlots,
  walkInStart,
  type StaffBookingSource,
} from '@/lib/staffBookingApi'
import { bookingErrorMessage } from '@/lib/bookingErrors'
import { apiErrorOf } from '@/lib/apiError'
import { useAppToast } from '@/hooks/useAppToast'
import type { TimeSlot } from '@/lib/types/booking'

interface NewAppointmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onBooked: () => void
  /** Pre-select a clinician, e.g. the owner-doctor's own provider. */
  defaultProviderId?: string | null
}

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function NewAppointmentDialog({
  open,
  onOpenChange,
  onBooked,
  defaultProviderId,
}: NewAppointmentDialogProps) {
  const toast = useAppToast()
  const [patientMode, setPatientMode] = useState<'existing' | 'new'>('existing')
  const [patientId, setPatientId] = useState('')
  const [patientQuery, setPatientQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [sendInvite, setSendInvite] = useState(true)
  const [serviceId, setServiceId] = useState('')
  const [providerId, setProviderId] = useState(defaultProviderId ?? '')
  const [locationId, setLocationId] = useState('')
  const [date, setDate] = useState(() => dateKeyInZone())
  const [slot, setSlot] = useState<Pick<TimeSlot, 'start' | 'end' | 'locationId'> | null>(null)
  const [source, setSource] = useState<StaffBookingSource>('WALK_IN')
  const [collectAtDesk, setCollectAtDesk] = useState(true)
  // CTO-31: in person or a video visit; starts from the service's default.
  const [modeChoice, setModeChoice] = useState<'IN_PERSON' | 'VIRTUAL' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  // A new patient's invite link, kept if the booking itself then fails.
  const [pendingInvite, setPendingInvite] = useState<string | null>(null)

  const { data: patients = [] } = useQuery({
    queryKey: ['clinic-patients'],
    queryFn: getClinicPatients,
    enabled: open,
  })
  const { data: services = [] } = useQuery({
    queryKey: ['staff-services'],
    queryFn: getStaffServices,
    enabled: open,
  })
  const { data: providers = [] } = useQuery({
    queryKey: ['staff-providers'],
    queryFn: getStaffProviders,
    enabled: open,
  })
  const { data: locations = [] } = useQuery({
    queryKey: ['staff-locations'],
    queryFn: getStaffLocations,
    enabled: open,
  })
  const service = services.find((s) => s.id === serviceId)
  const mode = modeChoice ?? service?.defaultMode ?? 'IN_PERSON'
  const eligibleProviders = useMemo(
    () => providers.filter((p) => p.providerServices.some((ps) => ps.serviceId === serviceId)),
    [providers, serviceId]
  )
  const effectiveProviderId = eligibleProviders.some((p) => p.id === providerId) ? providerId : ''
  const { data: slots = [], isFetching: slotsLoading } = useQuery({
    queryKey: ['staff-slots', serviceId, effectiveProviderId, date, locationId],
    queryFn: () =>
      getStaffSlots({
        serviceId,
        providerId: effectiveProviderId,
        date,
        locationId: locationId || undefined,
      }),
    enabled: open && !!serviceId && !!effectiveProviderId && !!date,
  })

  const filteredPatients = useMemo(() => {
    const q = patientQuery.trim().toLowerCase()
    if (!q) return patients
    return patients.filter(
      (p) => p.name.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)
    )
  }, [patients, patientQuery])

  const newPatientValid =
    newName.trim().length >= 2 && (newEmail.trim().length > 0 || newPhone.trim().length > 0)
  const patientReady = patientMode === 'existing' ? !!patientId : newPatientValid
  const canSubmit = patientReady && !!effectiveProviderId && !!serviceId && !!slot && !submitting

  const reset = () => {
    setPatientMode('existing')
    setPatientId('')
    setPatientQuery('')
    setNewName('')
    setNewEmail('')
    setNewPhone('')
    setSendInvite(true)
    setServiceId('')
    setProviderId(defaultProviderId ?? '')
    setLocationId('')
    setDate(dateKeyInZone())
    setSlot(null)
    setSource('WALK_IN')
    setCollectAtDesk(true)
    setModeChoice(null)
    setError(null)
    setInviteLink(null)
    setPendingInvite(null)
  }
  const close = () => {
    reset()
    onOpenChange(false)
  }

  const pickWalkInNow = async () => {
    if (!service || !effectiveProviderId) return
    const today = dateKeyInZone()
    setDate(today)
    setSource('WALK_IN')
    let todaysSlots: Pick<TimeSlot, 'start' | 'end' | 'locationId'>[] = []
    try {
      todaysSlots = await getStaffSlots({
        serviceId,
        providerId: effectiveProviderId,
        date: today,
        locationId: locationId || undefined,
      })
    } catch {
      // No slot list: book "now"; the server still refuses an overlap.
    }
    const now = walkInStart(todaysSlots, service.duration)
    setSlot({ start: now.startTime, end: now.endTime, locationId: now.locationId })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !slot) return
    setSubmitting(true)
    setError(null)
    let invite = pendingInvite
    try {
      let resolvedPatientId = patientId
      if (patientMode === 'new') {
        const created = await createClinicPatient({
          name: newName.trim(),
          email: newEmail.trim() || undefined,
          phone: newPhone.trim() || undefined,
          sendInvite,
        })
        resolvedPatientId = created.patient.id
        invite = created.inviteLink
        setPendingInvite(created.inviteLink)
        // Keep the patient selected if the booking itself fails below.
        setPatientMode('existing')
        setPatientId(created.patient.id)
      }
      await createStaffAppointment({
        patientId: resolvedPatientId,
        providerId: effectiveProviderId,
        serviceId,
        locationId: locationId || slot.locationId || undefined,
        startTime: slot.start,
        endTime: slot.end,
        bookingSource: source,
        mode,
        ...(service?.requirePrepayment ? { collectAtDesk } : {}),
      })
      onBooked()
      toast.success('Appointment booked')
      if (invite) setInviteLink(invite)
      else close()
    } catch (err) {
      setError(
        bookingErrorMessage(err, apiErrorOf(err).message || 'Could not book. Please try again.')
      )
    } finally {
      setSubmitting(false)
    }
  }

  const booked = !!inviteLink

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New appointment</DialogTitle>
          <DialogDescription className="text-slate-600">
            Book a walk-in or a phone call. No website or patient password needed.
          </DialogDescription>
        </DialogHeader>

        {booked ? (
          <div className="space-y-3" data-testid="invite-link">
            <p className="text-sm text-slate-700">
              Booked. The patient can set up their account with this link (valid 24 hours):
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={inviteLink ?? ''} aria-label="Patient invite link" />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(inviteLink ?? '')
                  toast.success('Link copied')
                }}
              >
                <Copy className="mr-1 h-4 w-4" /> Copy
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <fieldset className="space-y-2">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium">Patient</legend>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand"
                  onClick={() => setPatientMode(patientMode === 'existing' ? 'new' : 'existing')}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {patientMode === 'existing' ? 'New patient' : 'Find an existing patient'}
                </button>
              </div>
              {patientMode === 'existing' ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    aria-label="Search patients"
                    placeholder="Search by name or email"
                    value={patientQuery}
                    onChange={(e) => setPatientQuery(e.target.value)}
                  />
                  <select
                    id="appt-patient"
                    aria-label="Patient"
                    className={selectClass}
                    value={patientId}
                    onChange={(e) => setPatientId(e.target.value)}
                  >
                    <option value="">Select a patient</option>
                    {filteredPatients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input
                    aria-label="Patient name"
                    placeholder="Full name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <Input
                    aria-label="Patient email"
                    type="email"
                    placeholder="Email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                  <Input
                    aria-label="Patient phone"
                    type="tel"
                    placeholder="Phone"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-3">
                    <input
                      type="checkbox"
                      checked={sendInvite}
                      onChange={(e) => setSendInvite(e.target.checked)}
                    />
                    Send an account invite (email only; you can also copy the link)
                  </label>
                </div>
              )}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="appt-service" className="text-sm font-medium">
                  Service
                </label>
                <select
                  id="appt-service"
                  className={selectClass}
                  value={serviceId}
                  onChange={(e) => {
                    setServiceId(e.target.value)
                    setSlot(null)
                  }}
                >
                  <option value="">Select a service</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.duration} min)
                    </option>
                  ))}
                </select>
                {services.length === 0 && (
                  <p className="text-xs text-slate-500">
                    No services yet. Add one under Commerce, Services.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="appt-provider" className="text-sm font-medium">
                  Clinician
                </label>
                <select
                  id="appt-provider"
                  className={selectClass}
                  value={effectiveProviderId}
                  onChange={(e) => {
                    setProviderId(e.target.value)
                    setSlot(null)
                  }}
                  disabled={!serviceId}
                >
                  <option value="">Select a clinician</option>
                  {eligibleProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="appt-location" className="text-sm font-medium">
                  Location
                </label>
                <select
                  id="appt-location"
                  className={selectClass}
                  value={locationId}
                  onChange={(e) => {
                    setLocationId(e.target.value)
                    setSlot(null)
                  }}
                >
                  <option value="">Any location</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="appt-date" className="text-sm font-medium">
                  Date
                </label>
                <Input
                  id="appt-date"
                  type="date"
                  value={date}
                  min={dateKeyInZone()}
                  onChange={(e) => {
                    setDate(e.target.value)
                    setSlot(null)
                  }}
                />
              </div>
            </div>

            <fieldset className="space-y-1.5">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium">Time</legend>
                <button
                  type="button"
                  onClick={() => void pickWalkInNow()}
                  disabled={!service || !effectiveProviderId}
                  className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-brand-foreground disabled:opacity-50"
                >
                  <Zap className="h-3.5 w-3.5" /> Walk-in, now
                </button>
              </div>
              {!serviceId || !effectiveProviderId ? (
                <p className="text-sm text-slate-600">
                  Choose a service and clinician to see times.
                </p>
              ) : slotsLoading ? (
                <p className="text-sm text-slate-600">Loading times…</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No open times on this date. &quot;Walk-in, now&quot; still books today.
                </p>
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
                          ? 'border-brand bg-brand-soft text-brand-strong'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      {formatSlotTime(s.start, date)}
                    </button>
                  ))}
                </div>
              )}
              {slot && (
                <p className="text-xs text-slate-600" data-testid="chosen-time">
                  Booking {formatSlotTime(slot.start, date)}
                </p>
              )}
            </fieldset>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="font-medium">Booked by</span>
              {(['WALK_IN', 'PHONE'] as const).map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="booking-source"
                    checked={source === s}
                    onChange={() => setSource(s)}
                  />
                  {s === 'WALK_IN' ? 'Walk-in' : 'Phone'}
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="font-medium">Visit type</span>
              {(
                [
                  ['IN_PERSON', 'In person'],
                  ['VIRTUAL', 'Video visit'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="visit-mode"
                    checked={mode === value}
                    onChange={() => setModeChoice(value)}
                  />
                  {label}
                </label>
              ))}
            </div>

            {service?.requirePrepayment && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={collectAtDesk}
                  onChange={(e) => setCollectAtDesk(e.target.checked)}
                />
                Collect payment at the desk (otherwise the patient pays online first)
              </label>
            )}

            {error && (
              <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Close
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {submitting ? 'Booking…' : 'Book appointment'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
