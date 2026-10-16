'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Trash2,
  ArrowLeft,
  Calendar,
  User as UserIcon,
  FileText,
  Video,
  Receipt,
  ShieldCheck,
  Clock,
  Plus,
  Stethoscope,
  Activity,
  History,
  AlertCircle,
} from 'lucide-react'
import {
  getAppointmentById,
  getPatientEntitlements,
  getVisitByAppointment,
  createVisitRecord,
} from '@/lib/patientApi'
import {
  getInvoicesByAppointment,
  createInvoice,
  finalizeInvoice,
  payInvoice,
  updateInvoiceItem,
  deleteInvoiceItem,
  type Invoice,
  type InvoiceItem,
} from '@/lib/invoiceApi'
import {
  AppCard,
  AppCardContent,
  AppCardHeader,
  AppCardTitle,
  AppButton,
  AppPageHeader,
  StickySummaryPanel,
} from '@/components/ui-system'
import { PageContainer } from '@/components/layout'
import { PrescriptionForm } from '@/components/records/PrescriptionForm'
import { extractApiError } from '@/lib/apiErrors'
import { StatusBadge } from '@/components/common/StatusBadge'
import { AppInput } from '@/components/ui-system'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AddServiceDialog } from '@/components/invoice/AddServiceDialog'
import { IntakeFormsSection } from '@/components/intake/IntakeFormsSection'
import { PatientRecordSheet } from '@/components/patient/PatientRecordSheet'
import { ManualNoteModal } from '@/components/visit/ManualNoteModal'
import { Skeleton } from '@/components/ui/skeleton'
import { getPatientForms } from '@/lib/formsApi'
import {
  createPrescription,
  getPrescriptionsByPatient,
  type Prescription,
} from '@/lib/prescriptionApi'
import { useAppToast } from '@/hooks/useAppToast'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function ProviderAppointmentDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const toast = useAppToast()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isProvider = user?.role === 'PROVIDER'

  const [addServiceOpen, setAddServiceOpen] = useState(false)
  const [recordSheetOpen, setRecordSheetOpen] = useState(false)
  const [prescriptionOpen, setPrescriptionOpen] = useState(false)
  const [manualNoteOpen, setManualNoteOpen] = useState(false)

  const { data: appointment, isLoading: appointmentLoading } = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => getAppointmentById(id),
    enabled: !!id,
  })

  const { data: visitData } = useQuery({
    queryKey: ['visit', id],
    queryFn: () => (appointment ? getVisitByAppointment(id) : null),
    enabled: !!appointment?.id,
  })
  const visitRecord = visitData?.visitRecord ?? null

  const { data: invoices = [], refetch: refetchInvoices } = useQuery({
    queryKey: ['invoices', 'appointment', id],
    queryFn: () => getInvoicesByAppointment(id),
    enabled: !!appointment?.id,
  })

  const { data: formResponses = [], isLoading: formsLoading } = useQuery({
    queryKey: ['forms', 'patient', appointment?.patientId, appointment?.clinicId],
    queryFn: () => getPatientForms(appointment!.patientId, appointment?.clinicId),
    enabled: !!appointment?.patientId,
  })

  const { data: prescriptions = [], refetch: refetchPrescriptions } = useQuery({
    queryKey: ['prescriptions', 'patient', appointment?.patientId],
    queryFn: () => getPrescriptionsByPatient(appointment!.patientId),
    enabled: !!appointment?.patientId && appointment?.status === 'COMPLETED',
  })

  const { data: entitlements } = useQuery({
    queryKey: ['patient-entitlements', appointment?.patientId],
    queryFn: () => getPatientEntitlements(appointment!.patientId),
    enabled: !!appointment?.patientId && isProvider,
  })

  const createPrescriptionMutation = useMutation({
    mutationFn: (notes: string) =>
      createPrescription({ appointmentId: id, patientId: appointment!.patientId, notes }),
    onSuccess: () => {
      setPrescriptionOpen(false)
      refetchPrescriptions()
      toast.success('Prescription added')
    },
    onError: (err) => toast.error(extractApiError(err, 'Failed to create prescription').message),
  })

  const createInvoiceMutation = useMutation({
    mutationFn: () => createInvoice({ appointmentId: id, providerId: appointment!.providerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', 'appointment', id] })
      toast.success('Invoice created')
    },
  })

  const invoice = invoices[0] ?? null

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

  const patientName = (appointment as any).patient?.name ?? 'Patient'
  const patientEmail = (appointment as any).patient?.email ?? null
  const serviceDuration = (appointment.service as any)?.duration

  return (
    <div className="min-h-screen bg-slate-50">
      <PageContainer className="space-y-8 py-8">
        {/* Hero — gradient, patient + status, primary actions */}
        <div className="relative overflow-clip rounded-3xl border border-[#E5E7EB] bg-gradient-to-br from-[#1E3A5F] via-[#23436B] to-[#0F766E] text-white">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -left-10 -bottom-12 h-48 w-48 rounded-full bg-[#14B8A6]/25 blur-3xl"
          />
          <div className="relative flex flex-col gap-6 p-8 lg:p-10">
            <div className="flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/70 transition-colors hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <AppButton
                  variant="outline"
                  size="sm"
                  className="rounded-full border-white/25 bg-white/5 text-white hover:bg-white/15"
                  asChild
                >
                  <Link href={`/dashboard/provider/appointments/${id}/consultation`}>
                    <Video className="mr-2 h-4 w-4" />
                    Join Virtual Room
                  </Link>
                </AppButton>
                <AppButton
                  onClick={() => setRecordSheetOpen(true)}
                  size="sm"
                  className="rounded-full bg-white text-[#1E3A5F] shadow-sm hover:bg-white/90"
                >
                  <UserIcon className="mr-2 h-4 w-4" />
                  Full Clinical Record
                </AppButton>
              </div>
            </div>

            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80 backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#14B8A6]" />
                  {appointment.service.name}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{patientName}</h1>
                  <StatusBadge status={appointment.status} variant="appointment" />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/75">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-4 w-4" />
                    {formatDateTime(appointment.startTime)}
                  </span>
                  {serviceDuration != null && (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-4 w-4" />
                      {serviceDuration} min
                    </span>
                  )}
                  {patientEmail && (
                    <span className="inline-flex items-center gap-1.5">
                      <UserIcon className="h-4 w-4" />
                      {patientEmail}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-8">
            {/* Consultation Section */}
            <AppCard className="overflow-hidden border border-[#E5E7EB] shadow-none">
              <AppCardHeader className="flex flex-row items-center justify-between border-b border-[#E5E7EB] bg-gradient-to-r from-white via-[#F8FAFC] to-[#F0FDFA] py-5">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0D9488] to-[#14B8A6] text-white shadow-sm">
                    <Stethoscope className="h-4 w-4" />
                  </span>
                  <div>
                    <AppCardTitle className="text-base font-bold">Active Consultation</AppCardTitle>
                    <p className="text-xs font-medium text-slate-500">
                      {visitRecord
                        ? visitRecord.isFinalized
                          ? 'Finalised SOAP note'
                          : 'Draft in progress'
                        : 'Ready to start'}
                    </p>
                  </div>
                </div>
              </AppCardHeader>
              <AppCardContent className="p-8">
                {!visitRecord ? (
                  <div className="relative overflow-hidden rounded-3xl border border-[#E2E8F0] bg-gradient-to-br from-[#F8FAFC] via-white to-[#F0FDFA] p-10 text-center">
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-[#14B8A6]/10 blur-2xl"
                    />
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -left-12 -bottom-12 h-40 w-40 rounded-full bg-[#6366F1]/10 blur-2xl"
                    />
                    <div className="relative mx-auto mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0D9488] to-[#14B8A6] text-white shadow-lg shadow-[#14B8A6]/30">
                      <Activity className="h-7 w-7" />
                    </div>
                    <h3 className="relative text-lg font-bold text-slate-900">
                      Ready to document this visit
                    </h3>
                    <p className="relative mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
                      Medoflow AI Scribe listens to your consultation and drafts the SOAP note while
                      you focus on the patient.
                    </p>
                    <div className="relative mt-6 flex flex-wrap items-center justify-center gap-3">
                      <AppButton
                        size="lg"
                        className="rounded-full bg-gradient-to-r from-[#0D9488] to-[#14B8A6] px-8 text-white shadow-md shadow-[#14B8A6]/30 hover:from-[#0F766E] hover:to-[#0D9488]"
                        asChild
                      >
                        <Link
                          href={`/dashboard/provider/appointments/${id}/consultation`}
                          className="inline-flex items-center gap-2"
                        >
                          <Activity className="h-4 w-4" />
                          Enter Consultation Room
                        </Link>
                      </AppButton>
                      <AppButton
                        size="lg"
                        variant="outline"
                        className="rounded-full border-slate-200 bg-white px-8"
                        onClick={() => setManualNoteOpen(true)}
                      >
                        Start manual note
                      </AppButton>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <StatusBadge status={visitRecord.status} variant="visitRecord" />
                      <div className="flex items-center gap-2">
                        {!visitRecord.isFinalized && (
                          <AppButton
                            variant="outline"
                            size="sm"
                            className="rounded-full border-slate-200"
                            onClick={() => setManualNoteOpen(true)}
                          >
                            Edit manually
                          </AppButton>
                        )}
                        {!visitRecord.isFinalized && (
                          <AppButton variant="outline" size="sm" className="rounded-full" asChild>
                            <Link href={`/dashboard/provider/appointments/${id}/consultation`}>
                              Resume Scribe
                            </Link>
                          </AppButton>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-4">
                      {['subjective', 'objective', 'assessment', 'plan'].map(
                        (field) =>
                          visitRecord[field as keyof typeof visitRecord] && (
                            <div key={field} className="space-y-1">
                              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                {field}
                              </label>
                              <p className="p-4 bg-slate-50 rounded-2xl text-sm text-slate-700 whitespace-pre-wrap border border-slate-100">
                                {visitRecord[field as keyof typeof visitRecord] as string}
                              </p>
                            </div>
                          )
                      )}
                    </div>
                  </div>
                )}
              </AppCardContent>
            </AppCard>

            {/* Prescriptions */}
            {appointment.status === 'COMPLETED' && (
              <AppCard className="border-none shadow-sm overflow-hidden">
                <AppCardHeader className="flex flex-row items-center justify-between bg-slate-50/50 border-b-0 py-6">
                  <AppCardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary-600" /> Prescriptions
                  </AppCardTitle>
                  {!prescriptionOpen && (
                    <AppButton
                      variant="ghost"
                      size="sm"
                      className="rounded-full text-primary-600"
                      onClick={() => setPrescriptionOpen(true)}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Add New
                    </AppButton>
                  )}
                </AppCardHeader>
                <AppCardContent className="p-8 space-y-4">
                  {prescriptionOpen && (
                    <PrescriptionForm
                      onSubmit={(notes) => createPrescriptionMutation.mutate(notes)}
                      onCancel={() => setPrescriptionOpen(false)}
                      isSubmitting={createPrescriptionMutation.isPending}
                    />
                  )}
                  <div className="space-y-3">
                    {prescriptions.map((rx: any) => (
                      <div
                        key={rx.id}
                        className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm"
                      >
                        <p className="text-sm text-slate-700 whitespace-pre-wrap font-medium">
                          {rx.notes}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-3 uppercase font-bold tracking-tighter">
                          Issued on {new Date(rx.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    ))}
                    {prescriptions.length === 0 && !prescriptionOpen && (
                      <p className="text-center py-6 text-slate-400 text-sm">
                        No prescriptions issued for this visit.
                      </p>
                    )}
                  </div>
                </AppCardContent>
              </AppCard>
            )}

            {/* Forms Section */}
            <IntakeFormsSection
              responses={formResponses}
              appointmentId={id}
              isLoading={formsLoading}
            />
          </div>

          <div className="lg:col-span-1 space-y-8">
            {/* Billing Rail */}
            <div className="sticky top-32 space-y-6">
              {!invoice ? (
                <AppCard className="relative overflow-hidden border-dashed border-slate-200 bg-gradient-to-br from-white to-[#F8FAFC] p-8 text-center">
                  <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF2FF] text-[#6366F1]">
                    <Receipt className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">No active invoice</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                    Invoices are usually generated automatically upon booking.
                  </p>
                  <AppButton
                    className="mt-5 w-full rounded-full"
                    onClick={() => createInvoiceMutation.mutate()}
                  >
                    Create Manual Invoice
                  </AppButton>
                </AppCard>
              ) : (
                <StickySummaryPanel
                  title="Billing Details"
                  items={[
                    {
                      label: 'Status',
                      value: <StatusBadge status={invoice.status} variant="invoice" />,
                    },
                    { label: 'Subtotal', value: `$${invoice.subtotal}` },
                    { label: 'Tax', value: `$${invoice.taxAmount}` },
                    { label: 'Total', value: `$${invoice.totalAmount}`, isTotal: true },
                  ]}
                  actions={
                    <div className="space-y-3">
                      {invoice.status === 'DRAFT' && (
                        <AppButton
                          className="w-full rounded-full h-12"
                          onClick={() => setAddServiceOpen(true)}
                        >
                          Add Billable Item
                        </AppButton>
                      )}
                      <AppButton
                        variant="outline"
                        className="w-full rounded-full h-12 bg-white"
                        asChild
                      >
                        <Link href={`/dashboard/front-desk/invoices/${invoice.id}`}>
                          View Full Invoice
                        </Link>
                      </AppButton>
                    </div>
                  }
                />
              )}

              {/* Entitlements Rail */}
              {entitlements && (
                <AppCard className="overflow-hidden border border-[#E5E7EB] bg-gradient-to-br from-white to-[#F0FDFA] shadow-none">
                  <AppCardHeader className="border-b border-[#E5E7EB]/60 bg-white/50 py-4">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#F0FDFA] text-[#0D9488]">
                        <ShieldCheck className="h-4 w-4" />
                      </span>
                      <AppCardTitle className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
                        Patient Entitlements
                      </AppCardTitle>
                    </div>
                  </AppCardHeader>
                  <AppCardContent className="space-y-4 p-5">
                    {entitlements.activeMembershipBenefit ? (
                      <div className="rounded-2xl border border-[#0D9488]/20 bg-gradient-to-r from-[#F0FDFA] to-white p-4">
                        <p className="text-sm font-bold text-slate-900">
                          {entitlements.activeMembershipBenefit.membershipName}
                        </p>
                        <span className="mt-1.5 inline-flex items-center rounded-full bg-[#0D9488] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                          {Number(entitlements.activeMembershipBenefit.serviceDiscountPercent)}% off
                          services
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs italic text-slate-400">No active membership.</p>
                    )}

                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                        Wellness Packages
                      </p>
                      {entitlements.packages.length === 0 ? (
                        <p className="text-xs italic text-slate-400">No pre-paid packages.</p>
                      ) : (
                        entitlements.packages.map((pkg: any) => (
                          <div
                            key={pkg.id}
                            className="flex items-center justify-between rounded-xl bg-white p-3 text-xs font-medium text-slate-700 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ring-1 ring-slate-100"
                          >
                            <span className="truncate">{pkg.package.name}</span>
                            <span className="rounded-full bg-[#F0FDFA] px-2 py-0.5 text-[10px] font-black text-[#0F766E]">
                              {pkg.remainingSessions ??
                                Math.max(pkg.totalSessions - pkg.usedSessions, 0)}{' '}
                              LEFT
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </AppCardContent>
                </AppCard>
              )}

              {/* Clinical Integrity */}
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1E3A5F] via-[#23436B] to-[#0F766E] p-6 text-white">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#14B8A6]/25 blur-2xl"
                />
                <div className="relative flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#14B8A6] to-[#0D9488] text-white shadow-[0_0_16px_rgba(20,184,166,0.3)]">
                    <History className="h-4 w-4" />
                  </span>
                  <div>
                    <h4 className="text-sm font-bold">Clinical Integrity</h4>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5EEAD4]">
                      Immutable audit trail
                    </p>
                  </div>
                </div>
                <p className="relative mt-4 text-[11.5px] leading-relaxed text-white/70">
                  All clinical documentation is immutable once finalised. Medoflow tracks every edit
                  made to the SOAP record for clinical audit purposes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </PageContainer>

      <PatientRecordSheet
        patientId={appointment.patientId}
        clinicId={appointment.clinicId}
        open={recordSheetOpen}
        onOpenChange={setRecordSheetOpen}
      />

      <ManualNoteModal
        open={manualNoteOpen}
        onOpenChange={setManualNoteOpen}
        appointmentId={id}
        patientId={appointment.patientId}
        existingVisit={visitRecord}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['visit', id] })
          queryClient.invalidateQueries({ queryKey: ['appointment', id] })
        }}
      />

      {invoice && (
        <AddServiceDialog
          open={addServiceOpen}
          onOpenChange={setAddServiceOpen}
          invoiceId={invoice.id}
          onSuccess={() => refetchInvoices()}
        />
      )}
    </div>
  )
}
