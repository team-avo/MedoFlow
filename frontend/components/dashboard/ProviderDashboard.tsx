'use client'

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { getProviderAppointments } from '@/lib/patientApi'
import { getTreatmentPlans } from '@/lib/treatmentPlanApi'
import {
  AppCard,
  AppCardHeader,
  AppCardTitle,
  AppCardContent,
  AppButton,
  AppPageHeader,
  KPIStatCard,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import {
  Calendar,
  CalendarDays,
  Activity,
  Video,
  User,
  Clock,
  ChevronRight,
  Mic,
  Sparkles,
  Zap,
  ArrowUpRight,
} from 'lucide-react'
import { cn, getGreetingName } from '@/lib/utils'

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function dayLabel(d: Date, today: Date): string {
  if (isSameDay(d, today)) return 'Today'
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (isSameDay(d, tomorrow)) return 'Tomorrow'
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Minutes between `iso` and now; positive = in the future.
 */
function minutesFromNow(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
}

function countdownLabel(minutes: number): string {
  if (minutes < 0) return 'In progress'
  if (minutes === 0) return 'Starting now'
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  if (hours < 24) return rem === 0 ? `in ${hours}h` : `in ${hours}h ${rem}m`
  const days = Math.floor(hours / 24)
  return `in ${days}d`
}

export function ProviderDashboard() {
  const { user } = useAuth()
  if (user && user.role !== 'PROVIDER') {
    return null
  }
  return <ProviderDashboardContent />
}

function ProviderDashboardContent() {
  const { user } = useAuth()
  const clinicId = user?.clinicId ?? ''

  // Today (00:00 local) → 7 days out, so the dashboard can surface the next
  // few days of AI-Scribe-ready sessions, not just today.
  const today = React.useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const rangeEnd = React.useMemo(() => {
    const d = new Date(today)
    d.setDate(d.getDate() + 7)
    d.setHours(23, 59, 59, 999)
    return d
  }, [today])
  const todayEnd = React.useMemo(() => {
    const d = new Date(today)
    d.setHours(23, 59, 59, 999)
    return d
  }, [today])

  const { data: appointments = [], isLoading: appointmentsLoading } = useQuery({
    queryKey: ['provider-appointments', today.toISOString(), rangeEnd.toISOString()],
    queryFn: () => getProviderAppointments(today, rangeEnd),
    enabled: !!clinicId,
  })

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ['treatment-plans', 'ACTIVE'],
    queryFn: () => getTreatmentPlans('ACTIVE'),
    enabled: !!clinicId,
  })

  // Live clock — recompute "in 5 min" countdowns every 30 s.
  const [now, setNow] = React.useState<Date>(() => new Date())
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const upcoming = React.useMemo(() => {
    return (appointments || [])
      .filter(
        (a) =>
          a.status !== 'CANCELLED' &&
          a.status !== 'NO_SHOW' &&
          new Date(a.endTime).getTime() > now.getTime() - 5 * 60_000
      )
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  }, [appointments, now])

  const todaysUpcoming = upcoming.filter((a) => new Date(a.startTime) <= todayEnd)

  const currentAppointment =
    upcoming.find((a) => new Date(a.startTime) <= now && new Date(a.endTime) >= now) || upcoming[0]

  // Group upcoming by day for the Scribe queue.
  const grouped = React.useMemo(() => {
    const groups = new Map<string, { label: string; items: typeof upcoming }>()
    for (const apt of upcoming.slice(0, 10)) {
      const d = new Date(apt.startTime)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const label = dayLabel(d, today)
      if (!groups.has(key)) groups.set(key, { label, items: [] })
      groups.get(key)!.items.push(apt)
    }
    return Array.from(groups.values())
  }, [upcoming, today])

  // Pick a sensible "next break" — a 30+ minute gap between visits, or a
  // default mid-day marker if the schedule is empty.
  const nextBreak = React.useMemo(() => {
    for (let i = 0; i < todaysUpcoming.length - 1; i++) {
      const thisEnd = new Date(todaysUpcoming[i]!.endTime).getTime()
      const nextStart = new Date(todaysUpcoming[i + 1]!.startTime).getTime()
      if (nextStart - thisEnd >= 30 * 60_000) {
        return new Date(thisEnd).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })
      }
    }
    return todaysUpcoming.length ? '—' : '12:30 PM'
  }, [todaysUpcoming])

  const isLoading = appointmentsLoading || plansLoading

  return (
    <PageContainer className="space-y-8">
      {/* Hero — gradient welcome card with live "next up" chip */}
      <div className="relative overflow-clip rounded-3xl border border-[#E5E7EB] bg-gradient-to-br from-[#1E3A5F] via-[#23436B] to-[#1C8B81] text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-10 bottom-0 h-60 w-60 rounded-full bg-[#14B8A6]/25 blur-3xl"
        />
        <div className="relative flex flex-col gap-8 p-8 lg:flex-row lg:items-center lg:justify-between lg:p-10">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/80 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-[#14B8A6]" />
              Clinical Workspace
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Welcome, {getGreetingName(user?.name, 'Provider')}
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
              Here&apos;s what your clinical day looks like. AI Scribe is ready the moment you are.
            </p>
          </div>

          {/* Next-up chip */}
          {currentAppointment ? (
            <div className="flex min-w-[280px] flex-col gap-3 rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/65">
                  Next up
                </p>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#14B8A6]/20 px-2.5 py-1 text-[11px] font-semibold text-[#5EEAD4]">
                  <Clock className="h-3 w-3" />
                  {countdownLabel(minutesFromNow(currentAppointment.startTime))}
                </span>
              </div>
              <div>
                <p className="text-lg font-semibold leading-tight">
                  {currentAppointment.patient?.name ?? 'Patient'}
                </p>
                <p className="text-xs text-white/65">
                  {currentAppointment.service?.name ?? 'Consultation'} ·{' '}
                  {formatTime(currentAppointment.startTime)}
                </p>
              </div>
              <div className="flex gap-2">
                <AppButton
                  asChild
                  size="sm"
                  className="flex-1 rounded-lg bg-white font-semibold text-[#1E3A5F] hover:bg-white/90"
                >
                  <Link
                    href={`/dashboard/provider/appointments/${currentAppointment.id}/consultation`}
                    className="inline-flex items-center justify-center gap-1.5"
                  >
                    <Mic className="h-3.5 w-3.5" />
                    Start Scribe
                  </Link>
                </AppButton>
                <AppButton
                  asChild
                  size="sm"
                  variant="outline"
                  className="rounded-lg border-white/30 bg-transparent text-white hover:bg-white/10"
                >
                  <Link href={`/dashboard/provider/appointments/${currentAppointment.id}`}>
                    Charts
                  </Link>
                </AppButton>
              </div>
            </div>
          ) : (
            <div className="flex min-w-[280px] flex-col gap-3 rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/65">
                Your week
              </p>
              <p className="text-base leading-snug text-white/85">
                No upcoming visits in the next 7 days. Enjoy the breather.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* KPI row — tinted cards for a livelier feel */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <KPIStatCard
          label="Today's Volume"
          value={isLoading ? '...' : todaysUpcoming.length}
          icon={CalendarDays}
          description="Scheduled consultations"
          iconClassName="text-[#0D9488] bg-[#F0FDFA]"
        />
        <KPIStatCard
          label="Active Plans"
          value={isLoading ? '...' : plans.length}
          icon={Activity}
          description="Patients under your care"
          iconClassName="text-[#6366F1] bg-[#EEF2FF]"
        />
        <KPIStatCard
          label="Next Break"
          value={nextBreak}
          icon={Clock}
          description="Gap between visits"
          iconClassName="text-[#F59E0B] bg-[#FFFBEB]"
        />
      </div>

      {/* AI Scribe queue — the main attraction */}
      <div className="grid gap-6 lg:grid-cols-3">
        <AppCard className="overflow-hidden border border-[#E5E7EB] shadow-none lg:col-span-2">
          <AppCardHeader className="flex flex-row items-center justify-between border-b border-[#E5E7EB] bg-gradient-to-r from-white via-[#F7FDFC] to-[#F0FDFA] py-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0D9488] to-[#14B8A6] text-white shadow-sm">
                <Mic className="h-4 w-4" />
              </span>
              <div>
                <AppCardTitle className="text-base font-bold">
                  Upcoming AI Scribe Sessions
                </AppCardTitle>
                <p className="text-xs font-medium text-slate-500">
                  Next{' '}
                  {upcoming.length === 0
                    ? '7 days'
                    : `${upcoming.length} visit${upcoming.length > 1 ? 's' : ''}`}
                </p>
              </div>
            </div>
            <AppButton
              asChild
              size="sm"
              variant="outline"
              className="border-[#E5E7EB] bg-white text-[#1E3A5F] hover:bg-[#FAFAFA]"
            >
              <Link href="/dashboard/provider/calendar">Full Calendar</Link>
            </AppButton>
          </AppCardHeader>
          <AppCardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center p-12">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[#0D9488]" />
              </div>
            ) : upcoming.length === 0 ? (
              <div className="flex flex-col items-center gap-3 p-12 text-center text-slate-500">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F0FDFA] to-[#EEF2FF]">
                  <Sparkles className="h-6 w-6 text-[#0D9488]" />
                </div>
                <p className="text-sm font-medium">No upcoming sessions in the next 7 days.</p>
                <p className="text-xs text-slate-400">
                  When a patient books, it&apos;ll appear here — one tap to start the Scribe.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {grouped.map((group) => (
                  <div key={group.label} className="px-6 py-4">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                      {group.label}
                    </p>
                    <div className="space-y-2">
                      {group.items.map((apt) => {
                        const isCurrent = currentAppointment?.id === apt.id
                        const mins = minutesFromNow(apt.startTime)
                        const imminent = mins >= 0 && mins <= 15
                        return (
                          <div
                            key={apt.id}
                            className={cn(
                              'group flex items-center gap-4 rounded-2xl border p-4 transition-all',
                              isCurrent
                                ? 'border-[#0D9488]/40 bg-gradient-to-r from-[#F0FDFA] to-white shadow-[0_0_0_3px_rgba(13,148,136,0.08)]'
                                : imminent
                                  ? 'border-[#0D9488]/20 bg-gradient-to-r from-[#F7FDFC] to-white'
                                  : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50'
                            )}
                          >
                            {/* Time pill */}
                            <div
                              className={cn(
                                'flex flex-col items-center justify-center rounded-xl px-3 py-2 text-center',
                                isCurrent
                                  ? 'bg-[#0D9488] text-white'
                                  : 'bg-slate-100 text-slate-700'
                              )}
                            >
                              <span className="text-sm font-bold leading-tight">
                                {formatTime(apt.startTime).split(' ')[0]}
                              </span>
                              <span className="text-[9px] font-bold uppercase tracking-wider opacity-70">
                                {formatTime(apt.startTime).split(' ')[1]}
                              </span>
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate font-semibold text-slate-900">
                                  {apt.patient?.name ?? 'Patient'}
                                </p>
                                {isCurrent && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#0D9488] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                                    <span className="h-1 w-1 animate-pulse rounded-full bg-white" />
                                    Now
                                  </span>
                                )}
                                {!isCurrent && imminent && (
                                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                                    Soon · {countdownLabel(mins)}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-xs text-slate-500">
                                {apt.service?.name ?? 'Consultation'} ·{' '}
                                {(apt.service as any)?.duration || 30} min
                              </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                              <AppButton
                                asChild
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                aria-label="Join video room"
                              >
                                <Link
                                  href={`/dashboard/provider/appointments/${apt.id}/consultation`}
                                >
                                  <Video className="h-4 w-4" />
                                </Link>
                              </AppButton>
                              <AppButton
                                asChild
                                size="sm"
                                className={cn(
                                  'rounded-lg font-semibold shadow-none',
                                  isCurrent || imminent
                                    ? 'bg-gradient-to-r from-[#0D9488] to-[#14B8A6] text-white hover:from-[#0F766E] hover:to-[#0D9488]'
                                    : 'bg-[#1E3A5F] text-white hover:bg-[#172D4B]'
                                )}
                              >
                                <Link
                                  href={`/dashboard/provider/appointments/${apt.id}/consultation`}
                                  className="inline-flex items-center gap-1.5"
                                >
                                  <Mic className="h-3.5 w-3.5" />
                                  Scribe
                                </Link>
                              </AppButton>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AppCardContent>
        </AppCard>

        {/* Side rail — Scribe primer + quick links */}
        <div className="space-y-6">
          <AppCard className="relative overflow-hidden border-none bg-gradient-to-br from-[#1E3A5F] via-[#233F63] to-[#0F766E] text-white shadow-card">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-3xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-10 -left-4 h-32 w-32 rounded-full bg-[#14B8A6]/25 blur-2xl"
            />
            <AppCardContent className="relative space-y-5 p-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
                <Zap className="h-3 w-3" />
                AI Scribe
              </div>
              <h3 className="text-xl font-bold leading-tight">Documentation that writes itself.</h3>
              <p className="text-sm leading-relaxed text-white/70">
                Medoflow AI Scribe listens to your consultation and drafts the SOAP note while you
                focus on the patient.
              </p>
              <AppButton className="w-full rounded-lg bg-white font-semibold text-[#1E3A5F] hover:bg-white/90">
                Learn how it works
              </AppButton>
            </AppCardContent>
          </AppCard>

          <AppCard className="overflow-hidden border border-[#E5E7EB] shadow-none">
            <AppCardHeader className="border-b border-[#E5E7EB] bg-[#FAFAFA]">
              <AppCardTitle className="text-sm font-bold">Quick Links</AppCardTitle>
            </AppCardHeader>
            <AppCardContent className="p-0">
              <div className="grid grid-cols-1 divide-y divide-slate-100">
                <QuickLink
                  href="/dashboard/provider/calendar"
                  icon={Calendar}
                  label="My Schedule"
                  tint="bg-[#EEF2FF] text-[#6366F1]"
                />
                <QuickLink
                  href="/dashboard/provider/patients"
                  icon={User}
                  label="My Patients"
                  tint="bg-[#F0FDFA] text-[#0D9488]"
                />
                <QuickLink
                  href="/dashboard/analytics"
                  icon={Activity}
                  label="Personal Performance"
                  tint="bg-[#FFFBEB] text-[#F59E0B]"
                />
              </div>
            </AppCardContent>
          </AppCard>
        </div>
      </div>
    </PageContainer>
  )
}

function QuickLink({
  href,
  icon: Icon,
  label,
  tint,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  tint: string
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between p-4 transition-colors hover:bg-slate-50"
    >
      <div className="flex items-center gap-3">
        <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg', tint)}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">
          {label}
        </span>
      </div>
      <ArrowUpRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500" />
    </Link>
  )
}
