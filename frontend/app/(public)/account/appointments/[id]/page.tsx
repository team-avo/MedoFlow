'use client'

import React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { getAppointmentById, getVisitByAppointment, getMyPrescriptions } from '@/lib/patientApi'
import { getPatientForms } from '@/lib/formsApi'
import { getByAppointment } from '@/lib/consultationApi'
import { PatientFilesSection } from '@/components/PatientFilesSection'
import { StatusBadge } from '@/components/common/StatusBadge'
import {
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppButton,
  StickySummaryPanel,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { IntakeFormsSection } from '@/components/intake/IntakeFormsSection'
import { PatientAppointmentActions } from '@/components/appointments/PatientAppointmentActions'
import {
  ArrowLeft,
  Video,
  FileText,
  History,
  Stethoscope,
  ClipboardCheck,
  ShieldCheck,
  Download,
  AlertCircle,
} from 'lucide-react'

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function PatientAppointmentDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()

  const {
    data: appointment,
    isLoading: appointmentLoading,
    error: appointmentError,
  } = useQuery({
    queryKey: ['patient', 'appointment', id],
    queryFn: () => getAppointmentById(id),
    enabled: !!id,
  })

  const { data: visitData } = useQuery({
    queryKey: ['patient', 'visit', id],
    queryFn: () => (appointment ? getVisitByAppointment(id) : null),
    enabled: !!appointment?.id,
  })
  const visitRecord = visitData?.visitRecord ?? null
  const patientSummary = visitData?.patientSummary

  const { data: allPrescriptions } = useQuery({
    queryKey: ['patient', 'prescriptions'],
    queryFn: () => getMyPrescriptions(),
    enabled: !!appointment,
  })

  const prescriptions = allPrescriptions?.filter((p) => p.appointmentId === id) ?? []

  const { data: formResponses = [], isLoading: formsLoading } = useQuery({
    queryKey: ['forms', 'patient', appointment?.patientId, appointment?.clinicId],
    queryFn: () => getPatientForms(appointment!.patientId, appointment!.clinicId),
    enabled: !!appointment?.patientId && !!appointment?.clinicId,
  })

  const { data: consultationSession } = useQuery({
    queryKey: ['consultation', 'appointment', id],
    queryFn: () => getByAppointment(id),
    enabled: !!appointment?.id,
    refetchInterval: 10000,
  })

  if (appointmentLoading || !appointment) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-12 w-48" />
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-96 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-slate-50 min-h-screen">
      {/* Header */}
      <div className="px-8 py-6 bg-white border-b sticky top-0 z-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <AppButton
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
              className="rounded-full"
            >
              <ArrowLeft className="h-5 w-5" />
            </AppButton>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black text-slate-900">{appointment.service.name}</h1>
                <StatusBadge status={appointment.status} variant="appointment" />
              </div>
              <p className="text-sm text-slate-500 font-medium">
                Dr. {appointment.provider.firstName} {appointment.provider.lastName} ·{' '}
                {formatDateTime(appointment.startTime)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {consultationSession?.joinToken && (
              <AppButton size="lg" className="rounded-full shadow-lg shadow-primary-100" asChild>
                <Link href={`/consultation/${consultationSession.joinToken}`}>
                  <Video className="mr-2 h-5 w-5" /> Join Consultation
                </Link>
              </AppButton>
            )}
          </div>
        </div>
      </div>

      <PageContainer className="py-8">
        <div className="grid gap-8 lg:grid-cols-3 items-start">
          <div className="lg:col-span-2 space-y-8">
            {/* Visit Summary - Featured care info */}
            {patientSummary &&
            (patientSummary.diagnosis ||
              patientSummary.treatmentPlan ||
              patientSummary.nextSteps) ? (
              <AppCard className="border-none shadow-md overflow-hidden bg-primary-600 text-white">
                <AppCardHeader className="border-none pb-0">
                  <AppCardTitle className="text-xl font-bold flex items-center gap-2 text-white">
                    <ClipboardCheck className="h-6 w-6" />
                    Care Summary
                  </AppCardTitle>
                </AppCardHeader>
                <AppCardContent className="p-8 space-y-8">
                  {patientSummary.diagnosis && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-black uppercase tracking-[0.2em] text-primary-200">
                        Diagnosis / Findings
                      </h3>
                      <p className="text-lg font-medium leading-relaxed">
                        {patientSummary.diagnosis}
                      </p>
                    </div>
                  )}
                  {patientSummary.treatmentPlan && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-black uppercase tracking-[0.2em] text-primary-200">
                        Treatment Plan
                      </h3>
                      <p className="text-lg font-medium leading-relaxed">
                        {patientSummary.treatmentPlan}
                      </p>
                    </div>
                  )}
                  {patientSummary.nextSteps && (
                    <div className="p-4 bg-white/10 rounded-2xl border border-white/10">
                      <h3 className="text-xs font-black uppercase tracking-widest text-primary-100 mb-2">
                        Next Steps
                      </h3>
                      <p className="text-sm font-medium">{patientSummary.nextSteps}</p>
                    </div>
                  )}
                </AppCardContent>
              </AppCard>
            ) : (
              <AppCard className="border-none shadow-sm overflow-hidden bg-white">
                <AppCardContent className="p-12 text-center space-y-4">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                    <History className="h-8 w-8 text-slate-200" />
                  </div>
                  <div className="max-w-xs mx-auto">
                    <h3 className="font-bold text-slate-900">Clinical documentation in progress</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Your care summary will appear here once the provider has finalized their
                      notes.
                    </p>
                  </div>
                </AppCardContent>
              </AppCard>
            )}

            {/* Prescriptions */}
            <AppCard className="border-none shadow-sm overflow-hidden bg-white">
              <AppCardHeader className="bg-slate-50/50 border-b-0 py-6">
                <AppCardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary-600" />
                  Prescriptions & Orders
                </AppCardTitle>
              </AppCardHeader>
              <AppCardContent className="p-8">
                {prescriptions.length > 0 ? (
                  <div className="space-y-4">
                    {prescriptions.map((rx) => (
                      <div
                        key={rx.id}
                        className="p-6 bg-slate-50 rounded-2xl border border-slate-100 flex justify-between items-start gap-4"
                      >
                        <div className="space-y-1">
                          <p className="text-lg font-bold text-slate-900 whitespace-pre-wrap">
                            {rx.notes}
                          </p>
                          <p className="text-xs text-slate-500 font-medium">
                            Issued by Dr. {rx.provider.lastName} on{' '}
                            {new Date(rx.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <AppButton variant="outline" size="sm" className="rounded-full bg-white">
                          <Download className="h-4 w-4 mr-2" /> PDF
                        </AppButton>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center py-6 text-slate-400 text-sm italic">
                    No prescriptions issued for this visit.
                  </p>
                )}
              </AppCardContent>
            </AppCard>

            {/* Forms & Files */}
            <IntakeFormsSection
              responses={formResponses}
              appointmentId={id}
              isLoading={formsLoading}
            />

            <PatientFilesSection
              patientId={appointment.patientId}
              clinicId={appointment.clinicId}
              canDelete={false}
              canUpload={false}
              asPatient
            />
          </div>

          <div className="lg:col-span-1 space-y-8">
            {/* Reschedule / cancel (F1.3) — upcoming, live visits only */}
            <PatientAppointmentActions appointment={appointment} />

            {/* Sidebar Summary */}
            <StickySummaryPanel
              title="Visit Details"
              items={[
                { label: 'Provider', value: `Dr. ${appointment.provider.lastName}` },
                { label: 'Date', value: new Date(appointment.startTime).toLocaleDateString() },
                {
                  label: 'Time',
                  value: new Date(appointment.startTime).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  }),
                },
                {
                  label: 'Status',
                  value: <StatusBadge status={appointment.status} variant="appointment" />,
                },
                {
                  label: 'Payment',
                  value: (
                    <span className="text-emerald-600 font-bold uppercase tracking-tighter text-xs">
                      Paid
                    </span>
                  ),
                  isTotal: true,
                },
              ]}
              footer="Receipt available in Billing history."
            />

            {/* AI Scribe Consent Panel */}
            {consultationSession?.joinToken && consultationSession.consentStatus !== 'GRANTED' && (
              <AppCard className="border-amber-100 bg-amber-50/50">
                <AppCardContent className="p-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <h4 className="font-bold text-amber-900 text-sm">
                        Action Required: Recording Consent
                      </h4>
                      <p className="text-xs text-amber-700 mt-1">
                        Your provider has requested to use AI Scribe for this session. Please
                        provide your consent to continue.
                      </p>
                    </div>
                  </div>
                  <AppButton
                    className="w-full bg-amber-600 hover:bg-amber-700 border-none rounded-full text-xs font-bold"
                    asChild
                  >
                    <Link href={`/consultation/${consultationSession.joinToken}`}>
                      Open Consent Panel
                    </Link>
                  </AppButton>
                </AppCardContent>
              </AppCard>
            )}

            {/* Security Note */}
            <div className="p-6 bg-slate-900 rounded-[2rem] text-white">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-emerald-500 rounded-lg">
                  <ShieldCheck className="h-4 w-4 text-white" />
                </div>
                <h4 className="font-bold text-sm">Your Privacy</h4>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                All visit records are encrypted and stored in compliance with HIPAA regulations.
                Only you and your assigned clinical team have access to this information.
              </p>
            </div>
          </div>
        </div>
      </PageContainer>
    </div>
  )
}
