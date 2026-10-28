'use client'

import React from 'react'
import Link from 'next/link'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getAppointmentsByPatient,
  getVisitsByPatient,
  getPrescriptionsByPatient,
} from '@/lib/patientTimelineApi'
import { getPlansByPatient } from '@/lib/treatmentPlanApi'
import { useQuery, useQueries } from '@tanstack/react-query'
import { AppCard, AppCardContent, AppBadge } from '@/components/ui-system'
import { StatusBadge } from '@/components/common/StatusBadge'
import { PatientFilesSection } from '@/components/PatientFilesSection'
import { format } from 'date-fns'

interface PatientRecordSheetProps {
  patientId: string
  clinicId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatDate(iso: string) {
  return format(new Date(iso), 'MMM d, yyyy')
}

function TimelineTab({ patientId, clinicId }: { patientId: string; clinicId?: string }) {
  const [apts, visits, rx] = useQueries({
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
    ],
  })

  const isLoading = apts.isLoading || visits.isLoading || rx.isLoading

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    )
  }

  const appointments = apts.data ?? []
  const visitRecords = visits.data ?? []
  const prescriptions = rx.data ?? []

  const items: { type: string; title: string; date: string; id?: string }[] = []

  appointments.forEach((a) => {
    items.push({
      type: 'Appointment',
      title: `${a.service.name} — ${a.location.name}`,
      date: a.startTime,
      id: a.id,
    })
  })
  visitRecords.forEach((v) => {
    items.push({
      type: 'Visit',
      title: 'Visit note finalized',
      date: v.updatedAt,
      id: v.id,
    })
  })
  prescriptions.forEach((p) => {
    items.push({
      type: 'Prescription',
      title: 'Prescription',
      date: p.createdAt,
      id: p.appointmentId,
    })
  })

  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return (
    <div className="space-y-4 pr-2">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8 italic">
          No timeline events yet.
        </p>
      ) : (
        items.map((item, i) => (
          <AppCard
            key={`${item.type}-${item.id ?? i}`}
            className="border-none shadow-sm hover:shadow-md transition-shadow"
          >
            <AppCardContent className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <AppBadge
                    variant="secondary"
                    className="mb-2 text-[10px] uppercase font-black tracking-widest"
                  >
                    {item.type}
                  </AppBadge>
                  <p className="font-bold text-slate-900 truncate">{item.title}</p>
                  <p className="text-xs font-medium text-slate-400 mt-1">{formatDate(item.date)}</p>
                </div>
                {item.id && item.type === 'Appointment' && (
                  <Link
                    href={`/dashboard/provider/appointments/${item.id}`}
                    className="text-xs font-black text-primary-600 hover:text-primary-700 uppercase tracking-tighter shrink-0"
                  >
                    View
                  </Link>
                )}
              </div>
            </AppCardContent>
          </AppCard>
        ))
      )}
    </div>
  )
}

function TreatmentPlansTab({ patientId }: { patientId: string }) {
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['treatmentPlans', patientId],
    queryFn: () => getPlansByPatient(patientId),
    enabled: !!patientId,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pr-2">
      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8 italic">
          No treatment plans yet.
        </p>
      ) : (
        plans.map((plan) => (
          <AppCard key={plan.id} className="border-none shadow-sm">
            <AppCardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 truncate">{plan.name}</p>
                  <p className="text-xs font-medium text-slate-500 mt-1">
                    {plan.discipline.name} · {plan.sessionsCompleted}/{plan.totalSessions} sessions
                  </p>
                </div>
                <StatusBadge status={plan.status} variant="treatmentPlan" className="shrink-0" />
              </div>
            </AppCardContent>
          </AppCard>
        ))
      )}
    </div>
  )
}

export function PatientRecordSheet({
  patientId,
  clinicId,
  open,
  onOpenChange,
}: PatientRecordSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Patient Record</SheetTitle>
        </SheetHeader>
        <Tabs defaultValue="timeline" className="mt-6">
          <TabsList className="grid w-full grid-cols-3 bg-slate-100 p-1 rounded-2xl h-12">
            <TabsTrigger
              value="timeline"
              className="rounded-xl font-bold text-sm data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm transition-colors"
            >
              Timeline
            </TabsTrigger>
            <TabsTrigger
              value="plans"
              className="rounded-xl font-bold text-sm data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm transition-colors"
            >
              Plans
            </TabsTrigger>
            <TabsTrigger
              value="files"
              className="rounded-xl font-bold text-sm data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm transition-colors"
            >
              Files
            </TabsTrigger>
          </TabsList>
          <ScrollArea className="h-[calc(100vh-12rem)] mt-4">
            <TabsContent value="timeline" className="mt-0">
              <TimelineTab patientId={patientId} clinicId={clinicId} />
            </TabsContent>
            <TabsContent value="plans" className="mt-0">
              <TreatmentPlansTab patientId={patientId} />
            </TabsContent>
            <TabsContent value="files" className="mt-0">
              <PatientFilesSection patientId={patientId} clinicId={clinicId} canDelete={false} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
