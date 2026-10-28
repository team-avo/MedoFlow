'use client'

import React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQueries } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  getAppointmentsByPatient,
  getVisitsByPatient,
  getPrescriptionsByPatient,
  getPlansByPatient,
  getFormResponsesByPatient,
  type TimelineEvent,
  type TimelineEventType,
} from '@/lib/patientTimelineApi'
import type { PatientAppointment } from '@/lib/patientApi'
import type { VisitRecord } from '@/lib/patientApi'
import type { Prescription } from '@/lib/patientApi'
import type { TreatmentPlan } from '@/lib/treatmentPlanApi'
import { AppCard, AppCardContent, AppPageHeader, AppButton } from '@/components/ui-system'

// ───────────────────── Helpers ─────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function buildTimelineEvents(
  appointments: PatientAppointment[],
  visits: VisitRecord[],
  prescriptions: Prescription[],
  plans: TreatmentPlan[],
  formResponses: {
    id: string
    template: { name: string }
    appointmentId?: string | null
    createdAt: string
  }[]
): TimelineEvent[] {
  const events: TimelineEvent[] = []

  appointments
    .filter((a) => a.status === 'COMPLETED')
    .forEach((a) => {
      events.push({
        id: `apt-${a.id}`,
        type: 'APPOINTMENT',
        title: `${a.service.name} — ${a.location.name}`,
        description: `${a.provider.firstName} ${a.provider.lastName}`,
        date: a.startTime,
        appointmentId: a.id,
      })
    })

  visits
    .filter((v) => v.status === 'FINAL')
    .forEach((v) => {
      const desc = v.note ?? v.assessment ?? v.plan ?? 'Visit completed'
      events.push({
        id: `visit-${v.id}`,
        type: 'VISIT',
        title: 'Visit note finalized',
        description: desc.slice(0, 100) + (desc.length > 100 ? '…' : ''),
        date: v.updatedAt,
        appointmentId: v.appointmentId,
        visitId: v.id,
      })
    })

  prescriptions.forEach((p) => {
    events.push({
      id: `rx-${p.id}`,
      type: 'PRESCRIPTION',
      title: 'Prescription',
      description: p.notes.slice(0, 100) + (p.notes.length > 100 ? '…' : ''),
      date: p.createdAt,
      appointmentId: p.appointment?.id,
    })
  })

  formResponses.forEach((fr) => {
    events.push({
      id: `form-${fr.id}`,
      type: 'FORM_SUBMITTED',
      title: 'Intake Form Submitted',
      description: fr.template.name,
      date: fr.createdAt,
      appointmentId: fr.appointmentId ?? undefined,
    })
  })

  plans.forEach((p) => {
    events.push({
      id: `plan-created-${p.id}`,
      type: 'PLAN_CREATED',
      title: `Plan created: ${p.name}`,
      description: p.discipline.name,
      date: p.createdAt,
    })
    if (p.status === 'COMPLETED') {
      events.push({
        id: `plan-completed-${p.id}`,
        type: 'PLAN_COMPLETED',
        title: `Plan completed: ${p.name}`,
        description: `${p.sessionsCompleted}/${p.totalSessions} sessions`,
        date: p.updatedAt,
      })
    } else if (p.status === 'DISCONTINUED') {
      events.push({
        id: `plan-discontinued-${p.id}`,
        type: 'PLAN_DISCONTINUED',
        title: `Plan discontinued: ${p.name}`,
        description: p.notes ?? undefined,
        date: p.updatedAt,
      })
    }
  })

  return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

// ───────────────────── Colors ─────────────────────

const TYPE_COLORS: Record<TimelineEventType, string> = {
  APPOINTMENT: 'bg-blue-500',
  VISIT: 'bg-purple-500',
  PRESCRIPTION: 'bg-green-500',
  PLAN_CREATED: 'bg-cyan-500',
  PLAN_COMPLETED: 'bg-emerald-500',
  PLAN_DISCONTINUED: 'bg-gray-400',
  FORM_SUBMITTED: 'bg-cyan-500',
}

// ───────────────────── Skeleton ─────────────────────

function TimelineSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <div className="flex flex-col items-center">
            <div className="h-4 w-4 animate-pulse rounded-full bg-gray-200" />
            <div className="mt-2 h-16 w-0.5 bg-gray-200 last:hidden" />
          </div>
          <AppCard className="flex-1 animate-pulse">
            <AppCardContent className="py-4">
              <div className="h-4 w-3/5 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-2/5 rounded bg-gray-200" />
              <div className="mt-2 h-3 w-full rounded bg-gray-200" />
            </AppCardContent>
          </AppCard>
        </div>
      ))}
    </div>
  )
}

// ───────────────────── Timeline Card ─────────────────────

function TimelineEventCard({ event }: { event: TimelineEvent }) {
  const href = event.appointmentId
    ? `/dashboard/provider/appointments/${event.appointmentId}`
    : null

  const content = (
    <AppCard className="transition-colors hover:shadow-md hover:border-slate-300">
      <AppCardContent className="py-5 px-6">
        <h3 className="font-bold text-slate-900">{event.title}</h3>
        {event.description && (
          <p className="mt-1 text-sm text-slate-500 line-clamp-2 leading-relaxed">
            {event.description}
          </p>
        )}
        <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
          {formatDate(event.date)}
        </p>
      </AppCardContent>
    </AppCard>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="block transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded-2xl"
      >
        {content}
      </Link>
    )
  }

  return content
}

// ───────────────────── Page ─────────────────────

export default function ProviderPatientTimelinePage() {
  const params = useParams()
  const patientId = params.patientId as string
  const { user } = useAuth()
  const clinicId = user?.clinicId ?? undefined

  const [appointmentsQuery, visitsQuery, prescriptionsQuery, plansQuery, formResponsesQuery] =
    useQueries({
      queries: [
        {
          queryKey: ['appointments', 'patient', patientId],
          queryFn: () => getAppointmentsByPatient(patientId, clinicId),
          enabled: !!patientId,
        },
        {
          queryKey: ['visits', 'patient', patientId],
          queryFn: () => getVisitsByPatient(patientId, clinicId),
          enabled: !!patientId && !!clinicId,
        },
        {
          queryKey: ['prescriptions', 'patient', patientId],
          queryFn: () => getPrescriptionsByPatient(patientId, clinicId),
          enabled: !!patientId && !!clinicId,
        },
        {
          queryKey: ['treatmentPlans', patientId],
          queryFn: () => getPlansByPatient(patientId),
          enabled: !!patientId,
        },
        {
          queryKey: ['formResponses', 'patient', patientId],
          queryFn: () => getFormResponsesByPatient(patientId, clinicId),
          enabled: !!patientId && !!clinicId,
        },
      ],
    })

  const isLoading =
    appointmentsQuery.isLoading ||
    visitsQuery.isLoading ||
    prescriptionsQuery.isLoading ||
    plansQuery.isLoading ||
    formResponsesQuery.isLoading

  const isError =
    appointmentsQuery.isError ||
    visitsQuery.isError ||
    prescriptionsQuery.isError ||
    plansQuery.isError ||
    formResponsesQuery.isError

  const error =
    appointmentsQuery.error ??
    visitsQuery.error ??
    prescriptionsQuery.error ??
    plansQuery.error ??
    formResponsesQuery.error

  const events = React.useMemo(() => {
    if (isLoading || isError) return []
    return buildTimelineEvents(
      appointmentsQuery.data ?? [],
      visitsQuery.data ?? [],
      prescriptionsQuery.data ?? [],
      plansQuery.data ?? [],
      formResponsesQuery.data ?? []
    )
  }, [
    isLoading,
    isError,
    appointmentsQuery.data,
    visitsQuery.data,
    prescriptionsQuery.data,
    plansQuery.data,
    formResponsesQuery.data,
  ])

  const refetch = () => {
    appointmentsQuery.refetch()
    visitsQuery.refetch()
    prescriptionsQuery.refetch()
    plansQuery.refetch()
    formResponsesQuery.refetch()
  }

  return (
    <div className="space-y-10">
      <AppPageHeader
        title="Clinical Timeline"
        description="Chronological history of appointments, clinical notes, prescriptions, and care plans."
      />

      {isLoading ? (
        <TimelineSkeleton />
      ) : isError ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center">
          <p className="text-sm font-medium text-destructive">
            {(error as { message?: string })?.message ?? 'Failed to load timeline.'}
          </p>
          <AppButton variant="outline" size="sm" onClick={refetch} className="mt-4 rounded-full">
            Retry
          </AppButton>
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-slate-200"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="mt-4 text-sm font-bold text-slate-400">
            No clinical events recorded for this patient yet.
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[7px] top-4 bottom-4 w-0.5 bg-slate-200" aria-hidden />
          <div className="space-y-4">
            {events.map((event, i) => (
              <div key={event.id} className="relative flex gap-6">
                <div className="relative z-10 flex flex-col items-center pt-5">
                  <div
                    className={`h-4 w-4 shrink-0 rounded-full ring-4 ring-white ${TYPE_COLORS[event.type]}`}
                  />
                </div>
                <div className="flex-1 pb-6">
                  <TimelineEventCard event={event} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
