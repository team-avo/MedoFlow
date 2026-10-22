'use client'

/**
 * Replaces the marketing hero on the clinic site once a patient who belongs
 * to that clinic is signed in. Shopify-style: same domain, same brand, but
 * the chrome shifts from "convert me" to "what do I need today."
 *
 * Tiles surface: next confirmed appointment, latest unpaid invoice, latest
 * approved visit summary. Each tile deep-links into the existing /account
 * pages or opens the in-page hub modal.
 */

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarCheck, ClipboardList, Receipt, Sparkles } from 'lucide-react'
import { getMyAppointments, getMyInvoices, type PatientAppointment } from '@/lib/patientApi'
import type { PatientHubTab } from './PatientHubModal'
import { formatShortDateTime as formatDateTime } from '@/lib/timezone'

interface InvoiceLite {
  id: string
  total?: number | string
  amountDue?: number | string
  status?: string
  createdAt?: string
}

interface Props {
  firstName: string
  themeColor: string
  routeId: string
  onOpenHub: (tab: PatientHubTab) => void
}

function pickNextAppointment(list: PatientAppointment[] | undefined): PatientAppointment | null {
  if (!list?.length) return null
  const now = Date.now()
  const upcoming = list
    .filter((a) => new Date(a.startTime).getTime() >= now && a.status !== 'CANCELLED')
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  return upcoming[0] ?? null
}

function pickOpenInvoice(list: InvoiceLite[] | undefined): InvoiceLite | null {
  if (!list?.length) return null
  const open = list.find(
    (i) =>
      (i.status ?? '').toUpperCase() !== 'PAID' && (i.status ?? '').toUpperCase() !== 'CANCELLED'
  )
  return open ?? list[0] ?? null
}

export function PatientWelcomeCard({ firstName, themeColor, routeId, onOpenHub }: Props) {
  const { data: appointments } = useQuery({
    queryKey: ['patient-appointments-welcome'],
    queryFn: () => getMyAppointments(),
    staleTime: 60_000,
  })
  const { data: invoices } = useQuery({
    queryKey: ['patient-invoices-welcome'],
    queryFn: () => getMyInvoices() as Promise<InvoiceLite[]>,
    staleTime: 60_000,
  })

  const nextAppt = pickNextAppointment(appointments)
  const openInvoice = pickOpenInvoice(invoices)

  const apptValue = nextAppt ? formatDateTime(nextAppt.startTime) : 'Nothing booked yet'
  const apptSub = nextAppt
    ? `${nextAppt.service?.name ?? 'Visit'} · Dr. ${nextAppt.provider?.firstName ?? ''} ${nextAppt.provider?.lastName ?? ''}`.trim()
    : 'Pick a service to get started.'

  const invoiceValue = openInvoice
    ? typeof openInvoice.amountDue !== 'undefined'
      ? `$${Number(openInvoice.amountDue).toFixed(2)}`
      : typeof openInvoice.total !== 'undefined'
        ? `$${Number(openInvoice.total).toFixed(2)}`
        : '—'
    : 'All settled'
  const invoiceSub = openInvoice
    ? `Invoice ${openInvoice.id.slice(0, 8)} · ${openInvoice.status ?? 'OPEN'}`
    : 'No outstanding balance.'

  return (
    <section
      className="relative overflow-hidden border-b border-slate-100"
      style={{
        background: `linear-gradient(135deg, ${themeColor}10 0%, ${themeColor}05 60%, transparent 100%)`,
      }}
    >
      <div className="mx-auto max-w-7xl px-4 py-10 lg:px-8 lg:py-14">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
          <Sparkles className="h-3.5 w-3.5" style={{ color: themeColor }} />
          You're signed in
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
          Welcome back, {firstName}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 md:text-base">
          Here's a quick look at what's next. Scroll down to keep browsing the clinic.
        </p>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Tile
            icon={CalendarCheck}
            label="Next appointment"
            value={apptValue}
            sub={apptSub}
            cta={nextAppt ? 'View appointments' : 'Book a visit'}
            themeColor={themeColor}
            onClick={() => {
              if (nextAppt) onOpenHub('appointments')
              else {
                window.location.assign(`/clinic/${routeId}/store`)
              }
            }}
          />
          <Tile
            icon={Receipt}
            label="Billing"
            value={invoiceValue}
            sub={invoiceSub}
            cta="Open billing"
            themeColor={themeColor}
            onClick={() => window.location.assign('/account/billing')}
          />
          <Tile
            icon={ClipboardList}
            label="Visit summaries"
            value="View your records"
            sub="Notes from past visits, signed by your provider."
            cta="Open summaries"
            themeColor={themeColor}
            onClick={() => onOpenHub('visits')}
          />
        </div>
      </div>
    </section>
  )
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
  cta,
  themeColor,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub: string
  cta: string
  themeColor: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full flex-col items-start gap-2 rounded-2xl border border-slate-100 bg-white/80 p-5 text-left shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
          style={{ backgroundColor: themeColor }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
      </div>
      <p className="text-xl font-bold leading-tight text-slate-900">{value}</p>
      <p className="text-xs leading-relaxed text-slate-500">{sub}</p>
      <span
        className="mt-auto inline-flex items-center gap-1 pt-2 text-xs font-bold transition-transform group-hover:translate-x-0.5"
        style={{ color: themeColor }}
      >
        {cta}
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </button>
  )
}
