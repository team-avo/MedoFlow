'use client'

/**
 * BookingModal — in-nav appointment booking for the patient shell.
 *
 * Flow (all steps render in the same dialog — no page navigation):
 *   1. Service     — pick what to book from the clinic's service catalogue.
 *   2. Provider    — pick a clinician offering that service, or "Any".
 *   3. Schedule    — pick a date from the next 14 days, then a time slot.
 *                    A slot hold is created on select to prevent races.
 *   4. Review      — summary + confirm. Calls createAppointment.
 *
 * Post-success:
 *   • If the service is prepaid / no clientSecret is returned, show an
 *     in-modal confirmation card with "View appointments" + "Book another".
 *   • If Stripe returns a clientSecret, close the modal and push the patient
 *     to the existing /payment/[id] flow (no Stripe Elements in the modal
 *     itself — keeps the scope tight).
 *
 * The provider wraps the public shell so the nav, the account page, the
 * store, and the avatar menu can all trigger booking from one place.
 */

import React from 'react'
import { useRouter } from 'next/navigation'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { getClinicServices } from '@/lib/serviceApi'
import { getClinicProviders, getAvailability } from '@/lib/providerApi'
import {
  createSlotHold,
  releaseSlotHold,
  getClinicLocations,
  createAppointment,
  type CreatedSlotHold,
} from '@/lib/appointmentApi'
import type { Service, Provider, TimeSlot, Location } from '@/lib/types/booking'
import { clientLog } from '@/lib/clientLog'
import {
  SLOT_TAKEN_MESSAGE,
  bookingErrorMessage,
  isSlotUnavailableError,
} from '@/lib/bookingErrors'
import { cancellationTerms, describeCancellationPolicy } from '@/lib/cancellationPolicy'

// ───────────────────────── Context ─────────────────────────

type BookingModalContextValue = { open: () => void; close: () => void }
const BookingModalContext = React.createContext<BookingModalContextValue | null>(null)

export function useBookingModal() {
  const ctx = React.useContext(BookingModalContext)
  if (!ctx) throw new Error('useBookingModal must be used inside <BookingModalProvider>')
  return ctx
}

export function BookingModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false)

  const value = React.useMemo<BookingModalContextValue>(
    () => ({ open: () => setIsOpen(true), close: () => setIsOpen(false) }),
    []
  )

  return (
    <BookingModalContext.Provider value={value}>
      {children}
      <BookingModal open={isOpen} onOpenChange={setIsOpen} />
    </BookingModalContext.Provider>
  )
}

// ───────────────────────── Modal shell ─────────────────────────

type Step = 'service' | 'provider' | 'schedule' | 'review' | 'success'

type FlowState = {
  service: Service | null
  provider: Provider | null // null when "Any available"
  date: string | null // ISO yyyy-mm-dd
  slot: TimeSlot | null
  hold: CreatedSlotHold | null
  locationId: string | null
}

function emptyFlow(): FlowState {
  return { service: null, provider: null, date: null, slot: null, hold: null, locationId: null }
}

function BookingModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const router = useRouter()
  const { user, isAuthenticated } = useAuth()
  const clinicId = user?.clinicId ?? null

  const [step, setStep] = React.useState<Step>('service')
  const [flow, setFlow] = React.useState<FlowState>(emptyFlow)
  const [confirmedId, setConfirmedId] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  // F1.1: the chosen time was taken — back on the time picker with a notice
  // and freshly loaded availability, instead of an error.
  const [slotTaken, setSlotTaken] = React.useState(false)
  const [availabilityKey, setAvailabilityKey] = React.useState(0)
  const showSlotTaken = () => {
    setSlotTaken(true)
    setAvailabilityKey((k) => k + 1)
  }

  // Reset when closing — hold is released as a best-effort cleanup.
  React.useEffect(() => {
    if (open) return
    if (flow.hold && clinicId) {
      releaseSlotHold(flow.hold.id, clinicId).catch(() => undefined)
    }
    setStep('service')
    setFlow(emptyFlow())
    setConfirmedId(null)
    setSlotTaken(false)
  }, [open, flow.hold, clinicId])

  const goBack = () => {
    if (step === 'provider') setStep('service')
    else if (step === 'schedule') setStep('provider')
    else if (step === 'review') setStep('schedule')
  }

  const handleSelectService = (service: Service) => {
    setFlow((f) => ({ ...f, service, provider: null, date: null, slot: null, hold: null }))
    setStep('provider')
  }

  const handleSelectProvider = (provider: Provider | null) => {
    setFlow((f) => ({ ...f, provider, date: null, slot: null, hold: null }))
    setStep('schedule')
  }

  const handleSelectSlot = async (slot: TimeSlot, locationId: string | null) => {
    if (!clinicId || !flow.service) return
    try {
      // Release any prior hold first.
      if (flow.hold) {
        await releaseSlotHold(flow.hold.id, clinicId).catch(() => undefined)
      }
      const hold = await createSlotHold({
        clinicId,
        providerId: slot.providerId,
        serviceId: flow.service.id,
        locationId: slot.locationId ?? locationId ?? undefined,
        timezone: slot.timezone,
        startTime: slot.start,
        endTime: slot.end,
      })
      setFlow((f) => ({ ...f, slot, hold, locationId: slot.locationId ?? locationId }))
      setSlotTaken(false)
      setStep('review')
    } catch (err) {
      clientLog.error('[booking] request failed', err)
      if (isSlotUnavailableError(err)) {
        setFlow((f) => ({ ...f, slot: null, hold: null }))
        showSlotTaken()
      } else {
        toast.error('Could not reserve that time. Please try again.')
      }
    }
  }

  const handleConfirm = async () => {
    if (!clinicId || !user || !flow.service || !flow.slot) return
    setSubmitting(true)
    try {
      const { appointment, clientSecret } = await createAppointment({
        clinicId,
        locationId: flow.locationId ?? undefined,
        providerId: flow.slot.providerId,
        serviceId: flow.service.id,
        patientId: user.id,
        startTime: flow.slot.start,
        endTime: flow.slot.end,
        slotHoldId: flow.hold?.id,
      })
      setFlow((f) => ({ ...f, hold: null })) // hold converts on success
      if (clientSecret) {
        onOpenChange(false)
        toast.info('Complete payment to finish booking.')
        router.push(`/payment/${appointment.id}`) // the page loads its own PaymentIntent; no secret in the URL
        return
      }
      setConfirmedId(appointment.id)
      toast.dismiss()
      setStep('success')
    } catch (err: unknown) {
      if (isSlotUnavailableError(err)) {
        // The hold expired or the slot went to someone else: nothing was
        // booked. Return to the time picker with what is still open.
        setFlow((f) => ({ ...f, slot: null, hold: null }))
        showSlotTaken()
        setStep('schedule')
        return
      }
      toast.error(bookingErrorMessage(err, 'Could not confirm booking.'))
    } finally {
      setSubmitting(false)
    }
  }

  const resetForAnother = () => {
    setFlow(emptyFlow())
    setConfirmedId(null)
    setStep('service')
  }

  // Auth gate — if a non-patient somehow opens this, nudge them.
  const unauthorized = open && (!isAuthenticated || !clinicId)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0'
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[61] flex max-h-[92vh] w-[96vw] max-w-[820px]',
            '-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[24px] bg-white',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95'
          )}
          style={{ boxShadow: '0 40px 80px -20px rgba(15, 23, 42, 0.35)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-7 py-5">
            <div className="flex items-center gap-3">
              {step !== 'service' && step !== 'success' && (
                <button
                  type="button"
                  onClick={goBack}
                  aria-label="Back"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <div>
                <DialogPrimitive.Title className="text-[15px] font-semibold text-slate-900">
                  {step === 'success' ? 'Appointment confirmed' : 'Book an appointment'}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-[12px] text-slate-500">
                  {headerSubtitle(step)}
                </DialogPrimitive.Description>
              </div>
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Stepper */}
          {step !== 'success' && <Stepper step={step} />}

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-7 py-6">
            {unauthorized ? (
              <UnauthorizedState onClose={() => onOpenChange(false)} />
            ) : step === 'service' && clinicId ? (
              <ServiceStep clinicId={clinicId} onPick={handleSelectService} />
            ) : step === 'provider' && clinicId && flow.service ? (
              <ProviderStep
                clinicId={clinicId}
                service={flow.service}
                onPick={handleSelectProvider}
              />
            ) : step === 'schedule' && clinicId && flow.service ? (
              <ScheduleStep
                key={availabilityKey}
                clinicId={clinicId}
                service={flow.service}
                provider={flow.provider}
                slotTaken={slotTaken}
                initialDate={flow.date}
                onDateChange={(date) => setFlow((f) => ({ ...f, date }))}
                onPick={handleSelectSlot}
                onJoinWaitlist={() => onOpenChange(false)}
              />
            ) : step === 'review' && flow.service && flow.slot ? (
              <ReviewStep flow={flow} submitting={submitting} onConfirm={handleConfirm} />
            ) : step === 'success' && confirmedId ? (
              <SuccessState
                appointmentId={confirmedId}
                onBookAnother={resetForAnother}
                onClose={() => onOpenChange(false)}
              />
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function headerSubtitle(step: Step) {
  switch (step) {
    case 'service':
      return 'Pick the visit you need.'
    case 'provider':
      return 'Choose your clinician.'
    case 'schedule':
      return 'Pick a date and time.'
    case 'review':
      return 'Review the details and confirm.'
    case 'success':
      return 'Your visit is on the books.'
    default:
      return ''
  }
}

function Stepper({ step }: { step: Step }) {
  const steps: Array<{ id: Step; label: string }> = [
    { id: 'service', label: 'Service' },
    { id: 'provider', label: 'Provider' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'review', label: 'Review' },
  ]
  const activeIndex = steps.findIndex((s) => s.id === step)
  return (
    <ol className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-7 py-3">
      {steps.map((s, i) => {
        const isActive = i === activeIndex
        const isDone = i < activeIndex
        return (
          <li key={s.id} className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold',
                isDone
                  ? 'bg-teal-600 text-white'
                  : isActive
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-400 ring-1 ring-slate-200'
              )}
            >
              {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                'truncate text-[12px] font-medium',
                isActive || isDone ? 'text-slate-900' : 'text-slate-400'
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span
                className={cn('mx-1 h-px w-6 sm:w-10', isDone ? 'bg-teal-600' : 'bg-slate-200')}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ───────────────────────── Step: Service ─────────────────────────

function ServiceStep({
  clinicId,
  onPick,
}: {
  clinicId: string
  onPick: (service: Service) => void
}) {
  const [services, setServices] = React.useState<Service[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await getClinicServices(clinicId)
        if (!cancelled) setServices(res)
      } catch (err) {
        clientLog.error('[booking] request failed', err)
        if (!cancelled) setError('Could not load services.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clinicId])

  if (error) return <ErrorBlock message={error} />
  if (!services) return <LoadingBlock />
  if (services.length === 0)
    return (
      <EmptyBlock
        title="No services yet"
        body="Your clinic hasn't published services. Check back soon."
      />
    )

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {services.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onPick(s)}
            className="group flex w-full flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
          >
            <div className="flex w-full items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-teal-600">
                  {s.discipline?.name ?? 'Clinic'}
                </p>
                <p className="mt-1 line-clamp-2 text-[15px] font-semibold text-slate-900">
                  {s.name}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-900" />
            </div>
            <div className="flex items-center gap-4 text-[12px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {s.duration} min
              </span>
              <span className="font-semibold text-slate-900">
                ${Number(s.defaultPrice).toFixed(0)}
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ───────────────────────── Step: Provider ─────────────────────────

function ProviderStep({
  clinicId,
  service,
  onPick,
}: {
  clinicId: string
  service: Service
  onPick: (provider: Provider | null) => void
}) {
  const [providers, setProviders] = React.useState<Provider[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const all = await getClinicProviders(clinicId)
        const eligible = all.filter((p) =>
          (p.providerServices ?? []).some((ps) => ps.serviceId === service.id)
        )
        if (!cancelled) setProviders(eligible)
      } catch (err) {
        clientLog.error('[booking] request failed', err)
        if (!cancelled) setError('Could not load providers.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clinicId, service.id])

  if (error) return <ErrorBlock message={error} />
  if (!providers) return <LoadingBlock />

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onPick(null)}
        className="group flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-teal-50 via-white to-sky-50 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-teal-700 ring-1 ring-teal-100">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-slate-900">Any available clinician</p>
          <p className="text-[12px] text-slate-500">Get the earliest opening across the team.</p>
        </div>
        <ArrowRight className="h-4 w-4 text-slate-400 transition-colors group-hover:text-slate-900" />
      </button>

      {providers.length === 0 && (
        <EmptyBlock
          title="No clinicians available"
          body="No one on the team currently offers this service."
        />
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {providers.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="group flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <UserRound className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-slate-900">
                  Dr. {p.firstName} {p.lastName}
                </p>
                <p className="truncate text-[12px] text-slate-500">
                  {p.discipline?.name ?? p.disciplines?.[0]?.discipline?.name ?? 'Clinician'}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-900" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ───────────────────────── Step: Schedule ─────────────────────────

function ScheduleStep({
  clinicId,
  service,
  provider,
  slotTaken,
  initialDate,
  onDateChange,
  onPick,
  onJoinWaitlist,
}: {
  clinicId: string
  service: Service
  provider: Provider | null
  slotTaken: boolean
  initialDate: string | null
  onDateChange: (date: string) => void
  onPick: (slot: TimeSlot, locationId: string | null) => void
  onJoinWaitlist: () => void
}) {
  const router = useRouter()
  const [locations, setLocations] = React.useState<Location[]>([])
  const [date, setDate] = React.useState<string>(() => initialDate ?? todayISO())
  const [slots, setSlots] = React.useState<TimeSlot[] | null>(null)
  const [loadingSlots, setLoadingSlots] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    getClinicLocations(clinicId)
      .then(setLocations)
      .catch(() => setLocations([]))
  }, [clinicId])

  React.useEffect(() => {
    let cancelled = false
    setLoadingSlots(true)
    setError(null)
    ;(async () => {
      try {
        const res = await getAvailability(
          clinicId,
          service.id,
          date,
          provider?.id,
          locations[0]?.id
        )
        if (!cancelled) setSlots(res)
      } catch (err) {
        clientLog.error('[booking] request failed', err)
        if (!cancelled) {
          setError('Could not load availability.')
          setSlots([])
        }
      } finally {
        if (!cancelled) setLoadingSlots(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clinicId, service.id, date, provider?.id, locations])

  const dateOptions = React.useMemo(buildDateOptions, [])
  const locationId = locations[0]?.id ?? null

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Select a date
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {dateOptions.map((d) => {
            const active = d.value === date
            return (
              <button
                key={d.value}
                type="button"
                onClick={() => {
                  setDate(d.value)
                  onDateChange(d.value)
                }}
                className={cn(
                  'flex min-w-[66px] flex-col items-center rounded-2xl border px-3 py-2.5 transition-colors',
                  active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                )}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                  {d.weekday}
                </span>
                <span className="mt-1 text-[17px] font-bold tabular-nums">{d.day}</span>
                <span className="text-[10px] opacity-70">{d.month}</span>
              </button>
            )
          })}
        </div>
      </div>

      {slotTaken && (
        <p
          role="status"
          data-testid="slot-taken-notice"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"
        >
          {SLOT_TAKEN_MESSAGE}
        </p>
      )}

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Available times
        </p>
        {error ? (
          <ErrorBlock message={error} />
        ) : loadingSlots ? (
          <LoadingBlock />
        ) : !slots || slots.length === 0 ? (
          <div className="space-y-3">
            <EmptyBlock
              title="Fully booked"
              body="Try a different date — mornings tend to open up first."
            />
            {provider && (
              <button
                type="button"
                onClick={() => {
                  // The full booking page hosts the waitlist form; IDs only in the URL.
                  onJoinWaitlist()
                  router.push(
                    `/book/${service.id}?clinicId=${encodeURIComponent(clinicId)}&providerId=${encodeURIComponent(provider.id)}`
                  )
                }}
                className="w-full rounded-full border border-slate-200 bg-white py-2.5 text-[13px] font-semibold text-slate-800 hover:border-slate-300"
              >
                Join the waitlist for Dr. {provider.lastName}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {slots.map((s) => (
              <button
                key={`${s.providerId}-${s.start}`}
                type="button"
                onClick={() => onPick(s, locationId)}
                className="rounded-xl border border-slate-200 bg-white py-2.5 text-[13px] font-semibold text-slate-800 transition-colors hover:border-slate-900 hover:bg-slate-900 hover:text-white"
              >
                {formatClock(s.start, s.timezone)}
              </button>
            ))}
          </div>
        )}
      </div>

      {locations[0] && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
          <MapPin className="h-3.5 w-3.5" />
          {locations[0].name} · {locations[0].timezone}
        </p>
      )}
    </div>
  )
}

// ───────────────────────── Step: Review ─────────────────────────

function ReviewStep({
  flow,
  submitting,
  onConfirm,
}: {
  flow: FlowState
  submitting: boolean
  onConfirm: () => void
}) {
  const svc = flow.service!
  const slot = flow.slot!
  const price = Number(svc.defaultPrice)
  const policy = describeCancellationPolicy(
    cancellationTerms(svc, { startTime: slot.start, priceAtBooking: svc.defaultPrice })
  )
  const d = new Date(slot.start)
  const longDate = d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-teal-600">
          {svc.discipline?.name ?? 'Appointment'}
        </p>
        <h3 className="mt-1 text-[18px] font-bold text-slate-900">{svc.name}</h3>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <ReviewRow icon={UserRound} label="Clinician">
            {flow.provider
              ? `Dr. ${flow.provider.firstName} ${flow.provider.lastName}`
              : 'Any available'}
          </ReviewRow>
          <ReviewRow icon={CalendarCheck} label="Date">
            {longDate}
          </ReviewRow>
          <ReviewRow icon={Clock} label="Time">
            {formatClock(slot.start, slot.timezone)} – {formatClock(slot.end, slot.timezone)}
          </ReviewRow>
          <ReviewRow icon={MapPin} label="Timezone">
            {slot.timezone}
          </ReviewRow>
        </dl>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Visit fee
          </p>
          <p data-testid="booking-policy" className="text-[11.5px] text-slate-500">
            {policy}
          </p>
        </div>
        <p className="text-2xl font-black text-slate-900">${price.toFixed(0)}</p>
      </div>

      <button
        type="button"
        onClick={onConfirm}
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Confirming…
          </>
        ) : (
          <>
            Confirm booking <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </div>
  )
}

function ReviewRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={1.75} />
      <div className="min-w-0">
        <dt className="text-[10.5px] font-semibold uppercase tracking-widest text-slate-400">
          {label}
        </dt>
        <dd className="mt-0.5 text-[13px] font-medium text-slate-900">{children}</dd>
      </div>
    </div>
  )
}

// ───────────────────────── Success ─────────────────────────

function SuccessState({
  appointmentId,
  onBookAnother,
  onClose,
}: {
  appointmentId: string
  onBookAnother: () => void
  onClose: () => void
}) {
  const router = useRouter()
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-teal-700">
        <CheckCircle2 className="h-7 w-7" />
      </div>
      <p className="mt-5 text-[17px] font-bold text-slate-900">You're on the calendar.</p>
      <p className="mt-1 max-w-[340px] text-[13px] text-slate-500">
        We've emailed a confirmation with reminders ahead of your visit.
      </p>
      <div className="mt-7 flex w-full max-w-xs flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            onClose()
            router.push(`/account/appointments/${appointmentId}`)
          }}
          className="w-full rounded-full bg-slate-900 py-3 text-[13px] font-semibold text-white transition-colors hover:bg-slate-800"
        >
          View appointment
        </button>
        <button
          type="button"
          onClick={onBookAnother}
          className="w-full rounded-full border border-slate-200 bg-white py-3 text-[13px] font-semibold text-slate-800 hover:border-slate-300"
        >
          Book another
        </button>
      </div>
    </div>
  )
}

// ───────────────────────── States ─────────────────────────

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center py-10 text-slate-400">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  )
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-4 text-[13px] text-destructive">
      {message}
    </div>
  )
}

function EmptyBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
      <p className="text-[14px] font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-[12.5px] text-slate-500">{body}</p>
    </div>
  )
}

function UnauthorizedState({ onClose }: { onClose: () => void }) {
  return (
    <div className="py-6 text-center">
      <p className="text-[14px] font-semibold text-slate-900">Sign in to book</p>
      <p className="mt-1 text-[12.5px] text-slate-500">
        You need a patient account to book with your clinic.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-5 rounded-full border border-slate-200 px-5 py-2 text-[12px] font-semibold text-slate-700 hover:border-slate-300"
      >
        Close
      </button>
    </div>
  )
}

// ───────────────────────── Helpers ─────────────────────────

function todayISO(): string {
  const d = new Date()
  return isoDate(d)
}

function isoDate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function buildDateOptions() {
  const out: Array<{ value: string; weekday: string; day: string; month: string }> = []
  const now = new Date()
  for (let i = 0; i < 14; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    out.push({
      value: isoDate(d),
      weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
      day: String(d.getDate()),
      month: d.toLocaleDateString(undefined, { month: 'short' }),
    })
  }
  return out
}

function formatClock(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }
}
