'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getProviderAppointments, type ProviderAppointment } from '@/lib/patientApi'
import {
  getWeekRange,
  getNextWeek,
  getPrevWeek,
  formatWeekLabel,
  getTimeSlots,
  getAppointmentPosition,
  getDayColumn,
  getWeekDates,
  isToday,
} from '@/lib/calendarUtils'
import { formatClockShort } from '@/lib/timezone'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { PageContainer } from '@/components/layout'
import { AppButton } from '@/components/ui-system'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { AppointmentSheet } from '@/components/calendar/AppointmentSheet'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { MedoflowLoader } from '@/components/common/MedoflowLoader'

const SLOT_HEIGHT_PX = 48
const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: 'border-l-4 border-l-blue-500 bg-blue-50/50',
  COMPLETED: 'border-l-4 border-l-emerald-500 bg-emerald-50/50',
  CANCELLED: 'opacity-50 grayscale bg-slate-100',
  PENDING_PROVIDER_APPROVAL: 'border-l-4 border-l-purple-500 bg-purple-50/50',
  PENDING_PAYMENT: 'border-l-4 border-l-amber-500 bg-amber-50/50',
}

export default function ProviderCalendarPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return getWeekRange(d).start
  })
  const [selectedAppointment, setSelectedAppointment] = useState<ProviderAppointment | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [locationFilter, setLocationFilter] = useState<string>('all')

  const isProvider = user?.role === 'PROVIDER'

  const { start, end } = useMemo(() => getWeekRange(weekStart), [weekStart])
  const weekDates = useMemo(() => getWeekDates(start), [start])

  const {
    data: appointments = [],
    refetch,
    isLoading,
  } = useQuery({
    queryKey: ['provider-appointments', start.toISOString(), end.toISOString()],
    queryFn: () => getProviderAppointments(start, end),
    enabled: isProvider && !!user?.clinicId,
  })

  const locations = useMemo(() => {
    const seen = new Set<string>()
    appointments.forEach((a) => {
      if (a.location?.id) seen.add(a.location.id)
    })
    return Array.from(seen).map((id) => {
      const apt = appointments.find((a) => a.location?.id === id)
      return { id, name: apt?.location?.name ?? id }
    })
  }, [appointments])

  const filteredAppointments = useMemo(() => {
    if (locationFilter === 'all') return appointments
    return appointments.filter((a) => a.location?.id === locationFilter)
  }, [appointments, locationFilter])

  const appointmentsByDay = useMemo(() => {
    const map = new Map<number, ProviderAppointment[]>()
    weekDates.forEach((d, i) => map.set(i, []))
    filteredAppointments.forEach((apt) => {
      const aptDate = new Date(apt.startTime)
      const col = getDayColumn(aptDate)
      if (col >= 0 && col < 7) {
        map.get(col)?.push(apt)
      }
    })
    return map
  }, [filteredAppointments, weekDates])

  const handlePrevWeek = () => setWeekStart(getPrevWeek(weekStart))
  const handleNextWeek = () => setWeekStart(getNextWeek(weekStart))

  const handleAppointmentClick = (apt: ProviderAppointment) => {
    setSelectedAppointment(apt)
    setSheetOpen(true)
  }

  const handleSheetSuccess = () => {
    refetch()
  }

  useEffect(() => {
    if (user && !isProvider) {
      router.replace('/dashboard')
    }
  }, [user, isProvider, router])

  if (!user) return null
  if (!isProvider) return null

  const timeSlots = getTimeSlots()

  const statusLegend: Array<{ label: string; dotClass: string }> = [
    { label: 'Confirmed', dotClass: 'bg-blue-500' },
    { label: 'Completed', dotClass: 'bg-emerald-500' },
    { label: 'Pending', dotClass: 'bg-amber-500' },
    { label: 'Approval', dotClass: 'bg-purple-500' },
  ]

  return (
    <PageContainer className="space-y-8">
      {/* Hero header */}
      <div className="relative overflow-clip rounded-3xl border border-[#E5E7EB] bg-gradient-to-br from-[#1E3A5F] via-[#23436B] to-[#1C8B81] text-white">
        <div className="relative flex flex-col gap-6 p-8 lg:flex-row lg:items-end lg:justify-between lg:p-10">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
              <span className="h-1.5 w-1.5 rounded-full bg-[#14B8A6]" />
              Weekly View
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Clinical Schedule</h1>
            <p className="max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
              Your weekly consultation timeline and availability. Click any block to drill in.
            </p>
          </div>
          {/* Status legend */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-3">
            {statusLegend.map((s) => (
              <div
                key={s.label}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-white/80"
              >
                <span className={cn('h-2 w-2 rounded-full', s.dotClass)} />
                {s.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Card className="border-none shadow-xl rounded-3xl overflow-hidden">
        <CardHeader className="border-b border-slate-100 bg-white p-4 sm:p-6 lg:p-8">
          <div className="flex flex-col gap-4 sm:gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3 sm:gap-6">
              <h3 className="text-xl font-black tracking-tight text-slate-900">Schedule</h3>
              <div className="flex items-center bg-slate-100 p-1 rounded-xl">
                <AppButton
                  variant="ghost"
                  size="icon"
                  onClick={handlePrevWeek}
                  className="h-8 w-8 rounded-lg hover:bg-white hover:shadow-sm"
                >
                  <ChevronLeft className="h-4 w-4" />
                </AppButton>
                <div className="px-4 text-xs font-black uppercase tracking-widest text-slate-500 min-w-[140px] text-center">
                  {formatWeekLabel(start, end)}
                </div>
                <AppButton
                  variant="ghost"
                  size="icon"
                  onClick={handleNextWeek}
                  className="h-8 w-8 rounded-lg hover:bg-white hover:shadow-sm"
                >
                  <ChevronRight className="h-4 w-4" />
                </AppButton>
              </div>
              <AppButton
                variant="outline"
                size="sm"
                className="rounded-full border-slate-200 text-xs font-bold"
                onClick={() => setWeekStart(getWeekRange(new Date()).start)}
              >
                Today
              </AppButton>
            </div>

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
              {locations.length > 1 && (
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger className="h-11 w-full rounded-xl border-slate-100 bg-slate-50 font-medium sm:w-[200px]">
                    <SelectValue placeholder="All Facilities" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-slate-100">
                    <SelectItem value="all">All Facilities</SelectItem>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <p className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-xs font-medium text-slate-500">
              <MedoflowLoader size="sm" label="Loading appointments" />
              Loading this week&apos;s appointments…
            </p>
          )}
          {/* Mobile swipe hint — the grid is intentionally wider than a phone; */}
          {/* make that affordance visible so users know to swipe. */}
          <p className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11.5px] font-medium text-slate-500 md:hidden">
            <ChevronLeft className="h-3 w-3" aria-hidden />
            Swipe to see the whole week
            <ChevronRight className="h-3 w-3" aria-hidden />
          </p>
          <ScrollArea className="w-full">
            <div className="min-w-[1000px] bg-white">
              <div
                className="grid"
                style={{
                  gridTemplateColumns: '80px repeat(7, minmax(120px, 1fr))',
                  gridTemplateRows: `60px repeat(${timeSlots.length}, ${SLOT_HEIGHT_PX}px)`,
                }}
              >
                {/* Header Spacer */}
                <div className="sticky left-0 z-30 border-b border-r border-slate-50 bg-white" />

                {weekDates.map((d, i) => (
                  <div
                    key={i}
                    className={cn(
                      'sticky top-0 z-20 border-b border-slate-50 bg-white flex flex-col items-center justify-center transition-colors',
                      isToday(d) &&
                        'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-1 after:bg-primary-600'
                    )}
                  >
                    <span
                      className={cn(
                        'text-[10px] font-black uppercase tracking-[0.2em]',
                        isToday(d) ? 'text-primary-600' : 'text-slate-400'
                      )}
                    >
                      {format(d, 'EEE')}
                    </span>
                    <span
                      className={cn(
                        'text-xl font-black mt-0.5',
                        isToday(d) ? 'text-primary-600' : 'text-slate-900'
                      )}
                    >
                      {format(d, 'd')}
                    </span>
                  </div>
                ))}

                {timeSlots.map((slot, rowIdx) => (
                  <React.Fragment key={rowIdx}>
                    <div className="sticky left-0 z-10 border-b border-r border-slate-50 bg-white py-1 pr-4 text-right">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                        {format(slot, 'h a')}
                      </span>
                    </div>
                    {weekDates.map((d, colIdx) => {
                      const dayApts = appointmentsByDay.get(colIdx) ?? []
                      const aptToRender = dayApts.find((apt) => {
                        const { top } = getAppointmentPosition(apt.startTime, apt.endTime)
                        return top === rowIdx
                      })

                      return (
                        <div
                          key={`${rowIdx}-${colIdx}`}
                          className={cn(
                            'relative border-b border-r border-slate-50 group',
                            isToday(d) && 'bg-primary-50/10'
                          )}
                          style={{ minHeight: SLOT_HEIGHT_PX }}
                        >
                          {aptToRender &&
                            (() => {
                              const { height } = getAppointmentPosition(
                                aptToRender.startTime,
                                aptToRender.endTime
                              )
                              const statusColor = STATUS_COLORS[aptToRender.status] || 'bg-slate-50'

                              return (
                                <div
                                  key={aptToRender.id}
                                  className={cn(
                                    'absolute inset-x-1 z-10 cursor-pointer overflow-hidden rounded-xl p-3 shadow-sm transition-colors hover:shadow-md hover:z-20',
                                    statusColor
                                  )}
                                  style={{
                                    top: '4px',
                                    height: `${Math.max(1, height) * SLOT_HEIGHT_PX - 8}px`,
                                  }}
                                  onClick={() => handleAppointmentClick(aptToRender)}
                                >
                                  <div className="flex h-full flex-col">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="truncate text-xs font-black text-slate-900 uppercase tracking-tight">
                                        {aptToRender.patient.name}
                                      </p>
                                      <span className="text-[9px] font-bold text-slate-400 bg-white px-1.5 py-0.5 rounded-md border border-slate-100">
                                        {formatClockShort(aptToRender.startTime)}
                                      </span>
                                    </div>
                                    <p className="truncate text-[10px] font-bold text-slate-500 mt-1">
                                      {aptToRender.service.name}
                                    </p>
                                  </div>
                                </div>
                              )
                            })()}
                        </div>
                      )
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <ScrollBar orientation="horizontal" className="bg-slate-50" />
          </ScrollArea>
        </CardContent>
      </Card>

      <AppointmentSheet
        appointment={selectedAppointment}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSuccess={handleSheetSuccess}
        canManageSeries={user?.role === 'FRONT_DESK' || user?.role === 'SUPER_ADMIN'}
      />
    </PageContainer>
  )
}
