'use client'

/**
 * PatientHubModal — single dialog opened from the clinic-site avatar menu.
 *
 * Replaces the old standalone /account/* pages so a clinic-site visitor
 * never bounces off their clinic landing. One modal with four tabs:
 *
 *   • Overview     — next visit + quick stats
 *   • Appointments — all appointments with status badges
 *   • Visits       — past visit summaries
 *   • Profile      — name / email / role (read-only for the demo)
 */

import React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Loader2,
  Mail,
  MapPin,
  ShoppingBag,
  Stethoscope,
  User as UserIcon,
  X,
} from 'lucide-react'
import { formatShortDateTime as formatDateTime } from '@/lib/timezone'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import { getMyAppointments, type PatientAppointment } from '@/lib/patientApi'
import { cn } from '@/lib/utils'

export type PatientHubTab = 'overview' | 'appointments' | 'visits' | 'profile'

const TAB_LABELS: Record<PatientHubTab, string> = {
  overview: 'My account',
  appointments: 'Appointments',
  visits: 'Visit history',
  profile: 'Profile',
}

export function PatientHubModal({
  open,
  onOpenChange,
  initialTab = 'overview',
  themeColor,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initialTab?: PatientHubTab
  themeColor: string
}) {
  const { user, isAuthenticated } = useAuth()
  const [tab, setTab] = React.useState<PatientHubTab>(initialTab)

  React.useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  const { data: appointments, isLoading: appointmentsLoading } = useQuery({
    queryKey: ['patient-appointments'],
    queryFn: () => getMyAppointments(),
    enabled: open && isAuthenticated && user?.role === 'PATIENT',
  })

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[60] bg-slate-900/60',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0'
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[61] flex max-h-[92vh] w-[96vw] max-w-[820px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[24px] bg-white shadow-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            // Fade only; the slide pair re-applies the -50% centring that the
            // enter/exit keyframes would otherwise reset (no visible movement).
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-1/2'
          )}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between border-b border-slate-100 px-7 py-5"
            style={{ background: `linear-gradient(90deg, ${themeColor}10 0%, transparent 100%)` }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-2xl text-white"
                style={{ backgroundColor: themeColor }}
              >
                <UserIcon className="h-5 w-5" />
              </div>
              <div>
                <DialogPrimitive.Title className="text-base font-bold text-slate-900">
                  {user?.name || 'Your account'}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-xs text-slate-500">
                  {user?.email}
                </DialogPrimitive.Description>
              </div>
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-100 px-5 pt-3">
            {(Object.keys(TAB_LABELS) as PatientHubTab[]).map((t) => {
              const isActive = tab === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    'relative inline-flex items-center gap-2 px-4 py-3 text-sm font-bold transition-colors',
                    isActive ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                  )}
                >
                  {TAB_LABELS[t]}
                  {isActive && (
                    <span
                      className="absolute inset-x-3 -bottom-px h-[2px] rounded-full"
                      style={{ backgroundColor: themeColor }}
                    />
                  )}
                </button>
              )
            })}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-7">
            {tab === 'overview' && (
              <OverviewPanel
                appointments={appointments}
                loading={appointmentsLoading}
                themeColor={themeColor}
                onClose={() => onOpenChange(false)}
              />
            )}
            {tab === 'appointments' && (
              <AppointmentsPanel
                appointments={appointments}
                loading={appointmentsLoading}
                themeColor={themeColor}
              />
            )}
            {tab === 'visits' && (
              <VisitsPanel appointments={appointments} loading={appointmentsLoading} />
            )}
            {tab === 'profile' && <ProfilePanel themeColor={themeColor} />}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// ─────────────────────────── Overview ──────────────────────────────

function OverviewPanel({
  appointments,
  loading,
  themeColor,
  onClose,
}: {
  appointments: PatientAppointment[] | undefined
  loading: boolean
  themeColor: string
  onClose: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  // Pull the clinic id/slug out of the current path so the Shop tile can
  // route to /clinic/<id>/store. The hub is always opened from inside a
  // /clinic/* route, so this is reliable.
  const clinicMatch = pathname?.match(/^\/clinic\/([^/?#]+)/)
  const clinicRouteId = clinicMatch?.[1] ?? null

  if (loading) return <Spinner />
  const now = new Date()
  const upcoming = (appointments ?? [])
    .filter((a) => new Date(a.startTime) > now && a.status !== 'CANCELLED')
    .sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime))
  const past = (appointments ?? []).filter(
    (a) => new Date(a.startTime) <= now || a.status === 'COMPLETED'
  )
  const next = upcoming[0]

  return (
    <div className="space-y-6">
      {next ? (
        <div
          className="rounded-2xl border p-5"
          style={{ backgroundColor: `${themeColor}10`, borderColor: `${themeColor}30` }}
        >
          <p
            className="text-[10px] font-black uppercase tracking-widest"
            style={{ color: themeColor }}
          >
            Your next visit
          </p>
          <p className="mt-2 text-xl font-bold text-slate-900">{next.service.name}</p>
          <p className="mt-1 text-sm text-slate-600">
            {formatDateTime(next.startTime)} · Dr. {next.provider.firstName}{' '}
            {next.provider.lastName}
          </p>
          {next.location?.name && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <MapPin className="h-3.5 w-3.5" />
              {next.location.name}
            </p>
          )}
        </div>
      ) : (
        <EmptyState
          icon={CalendarCheck}
          title="No upcoming visits"
          body="When you book, the next appointment will appear here."
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Upcoming" value={String(upcoming.length)} />
        <StatCard label="Completed" value={String(past.length)} />
        <StatCard label="Total visits" value={String((appointments ?? []).length)} />
      </div>

      {/* Shop tile — routes to the dedicated clinic storefront */}
      {clinicRouteId && (
        <button
          type="button"
          onClick={() => {
            onClose()
            router.push(`/clinic/${clinicRouteId}/store`)
          }}
          className="group relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-2xl border p-5 text-left transition-colors hover:shadow-md"
          style={{ borderColor: `${themeColor}30`, backgroundColor: `${themeColor}08` }}
        >
          <div className="flex items-center gap-4">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
              style={{ backgroundColor: themeColor }}
            >
              <ShoppingBag className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[15px] font-bold text-slate-900">Shop the storefront</p>
              <p className="mt-0.5 text-[12px] text-slate-500">Curated products from your clinic</p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 transition-transform" style={{ color: themeColor }} />
        </button>
      )}
    </div>
  )
}

// ─────────────────────────── Appointments ──────────────────────────────

function AppointmentsPanel({
  appointments,
  loading,
  themeColor,
}: {
  appointments: PatientAppointment[] | undefined
  loading: boolean
  themeColor: string
}) {
  if (loading) return <Spinner />
  if (!appointments || appointments.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No appointments yet"
        body="Book a service from the clinic page to see it listed here."
      />
    )
  }
  const sorted = [...appointments].sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime))
  return (
    <div className="space-y-3">
      {sorted.map((appt) => (
        <div
          key={appt.id}
          className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-4">
            <div
              className="hidden h-10 w-10 items-center justify-center rounded-xl sm:flex"
              style={{ backgroundColor: `${themeColor}15`, color: themeColor }}
            >
              <Stethoscope className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">{appt.service.name}</p>
              <p className="mt-1 text-xs text-slate-500">
                {formatDateTime(appt.startTime)} · Dr. {appt.provider.firstName}{' '}
                {appt.provider.lastName}
              </p>
              {appt.location?.name && (
                <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  {appt.location.name}
                </p>
              )}
            </div>
          </div>
          <StatusBadge status={appt.status} themeColor={themeColor} />
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────── Visits ──────────────────────────────

function VisitsPanel({
  appointments,
  loading,
}: {
  appointments: PatientAppointment[] | undefined
  loading: boolean
}) {
  if (loading) return <Spinner />
  const completed = (appointments ?? []).filter((a) => a.status === 'COMPLETED')
  if (completed.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No visit records yet"
        body="Once a clinician finalises notes from your visit, they'll show up here."
      />
    )
  }
  return (
    <div className="space-y-3">
      {completed.map((appt) => (
        <div key={appt.id} className="rounded-2xl border border-slate-100 bg-white p-5">
          <p className="text-sm font-bold text-slate-900">{appt.service.name}</p>
          <p className="mt-1 text-xs text-slate-500">
            {formatDateTime(appt.startTime)} · Dr. {appt.provider.firstName}{' '}
            {appt.provider.lastName}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Visit complete. Detailed notes are reviewed by your clinician and shared with you on
            request.
          </p>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────── Profile ──────────────────────────────

function ProfilePanel({ themeColor }: { themeColor: string }) {
  const { user } = useAuth()
  if (!user) return null
  return (
    <div className="space-y-5">
      <div
        className="flex items-center gap-4 rounded-2xl border p-5"
        style={{ backgroundColor: `${themeColor}10`, borderColor: `${themeColor}30` }}
      >
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full text-white text-lg font-black"
          style={{ backgroundColor: themeColor }}
        >
          {user.name?.[0]?.toUpperCase() ?? 'P'}
        </div>
        <div>
          <p className="text-base font-bold text-slate-900">{user.name}</p>
          <p className="text-xs text-slate-500">{user.email}</p>
        </div>
      </div>

      <div className="grid gap-3">
        <FieldRow icon={UserIcon} label="Full name" value={user.name} />
        <FieldRow icon={Mail} label="Email" value={user.email} />
        <FieldRow
          icon={Stethoscope}
          label="Account type"
          value={user.role === 'PATIENT' ? 'Patient' : user.role}
        />
      </div>

      <p className="text-xs text-slate-400">
        Need to update your details? Reach out to the clinic and we'll handle it for you.
      </p>
    </div>
  )
}

function FieldRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3">
      <Icon className="h-4 w-4 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="truncate text-sm font-medium text-slate-900">{value}</p>
      </div>
    </div>
  )
}

// ─────────────────────────── Bits ──────────────────────────────

function Spinner() {
  return (
    <div className="flex justify-center py-12 text-slate-300">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  body: string
}) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-12 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-bold text-slate-700">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500">{body}</p>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <p className="text-2xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
    </div>
  )
}

function StatusBadge({ status, themeColor }: { status: string; themeColor: string }) {
  const styles: Record<string, { label: string; bg: string; fg: string }> = {
    CONFIRMED: { label: 'Confirmed', bg: `${themeColor}15`, fg: themeColor },
    PENDING: { label: 'Pending', bg: '#FEF3C7', fg: '#B45309' },
    COMPLETED: { label: 'Completed', bg: '#D1FAE5', fg: '#047857' },
    CANCELED: { label: 'Cancelled', bg: '#FEE2E2', fg: '#B91C1C' },
    NO_SHOW: { label: 'No-show', bg: '#FEE2E2', fg: '#B91C1C' },
  }
  const s = styles[status] ?? { label: status, bg: '#F1F5F9', fg: '#475569' }
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wider"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  )
}
