'use client'

/**
 * ChaosToClaritySection — chapter 3.
 *
 * Split-screen: the real pain on the left (8 disconnected tools, daily-life
 * micro-frustrations) versus the calm single MedoFlow surface on the right.
 * Customer-quote anchor below grounds the abstraction in a real person.
 */

import React from 'react'
import {
  AlertCircle,
  Calendar,
  CreditCard,
  FileText,
  Mail,
  MessageSquare,
  Phone,
  Receipt,
  Users,
} from 'lucide-react'
import { SectionHeader } from './primitives'

const messyTools = [
  'Jane App',
  'Calendly',
  'Google Sheets',
  'Stripe Dashboard',
  'SimplePractice',
  'Heidi Health',
  'Mailchimp',
  'Squarespace',
]

const dailyPains = [
  { icon: Calendar, label: 'Double-booked Tuesday', tone: 'red' as const },
  { icon: Mail, label: '47 unread patient emails', tone: 'amber' as const },
  { icon: FileText, label: '12 charts still open from Monday', tone: 'red' as const },
  { icon: Receipt, label: '$8,420 in unpaid invoices', tone: 'amber' as const },
  { icon: Phone, label: '6 voicemails, none returned', tone: 'red' as const },
  { icon: AlertCircle, label: 'Insurance denial — 3rd this week', tone: 'red' as const },
]

function PainCard() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-rose-200 bg-rose-50/40 p-6">
      <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-rose-600 ring-1 ring-rose-200">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
        </span>
        Tuesday, 6:42 PM
      </div>

      <p className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-rose-700/80">
        Your clinic, right now
      </p>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {messyTools.map((name, i) => (
          <span
            key={name}
            className="rounded-full border border-rose-200 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-rose-900/70"
          >
            {name}
          </span>
        ))}
      </div>

      <div className="space-y-2">
        {dailyPains.map((p, i) => {
          const Icon = p.icon
          return (
            <div
              key={p.label}
              className="flex items-center gap-3 rounded-lg bg-white/70 px-3 py-2.5 ring-1 ring-rose-100"
            >
              <span
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${
                  p.tone === 'red' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-700'
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              </span>
              <span className="text-[13px] font-medium text-ink">{p.label}</span>
            </div>
          )
        })}
      </div>

      <p className="mt-5 text-[12px] italic text-rose-700/70">
        Sound familiar? This is what 8 disconnected tools looks like.
      </p>
    </div>
  )
}

function CalmCard() {
  const calmRows = [
    {
      icon: Calendar,
      title: 'Today · 12 booked',
      subtitle: '3 telehealth · 9 in-clinic · 2 prepaid',
      right: '+2 vs avg',
    },
    {
      icon: FileText,
      title: 'Charts caught up',
      subtitle: 'Last note signed 12 min ago',
      right: '0 backlog',
    },
    {
      icon: CreditCard,
      title: 'Collected today',
      subtitle: '14 payments · 2 packages sold',
      right: '$4,280',
    },
    {
      icon: Users,
      title: 'New patients this week',
      subtitle: 'Booked through your MedoFlow site',
      right: '9',
    },
  ]

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-hairline bg-white p-6 shadow-card">
      <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-teal-wash px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-teal ring-1 ring-teal/20">
        <span className="h-1.5 w-1.5 rounded-full bg-teal" />
        On track
      </div>

      <p className="mb-5 text-[12px] font-semibold uppercase tracking-wider text-teal">
        Same clinic, on MedoFlow
      </p>

      <div className="space-y-3">
        {calmRows.map((row, i) => {
          const Icon = row.icon
          return (
            <div
              key={row.title}
              className="flex items-center justify-between rounded-lg bg-canvas px-3.5 py-3 ring-1 ring-hairline"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-wash text-teal">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </span>
                <div>
                  <p className="text-[13px] font-medium text-ink">{row.title}</p>
                  <p className="text-[11px] text-ink-muted">{row.subtitle}</p>
                </div>
              </div>
              <span className="text-[12px] font-semibold text-teal">{row.right}</span>
            </div>
          )
        })}
      </div>

      <p className="mt-5 text-[12px] italic text-ink-muted">One screen. One bill. Home by 6.</p>
    </div>
  )
}

function FlowOrb() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 md:flex">
      <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-card-hover ring-1 ring-hairline">
        <div className="absolute inset-0 rounded-full bg-teal/20" />
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-teal">
          <path
            d="M5 12h14m-6-6 6 6-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  )
}

export function ChaosToClaritySection() {
  return (
    <section className="mf-zone-white relative py-28 md:py-36">
      <div className="container mx-auto px-6">
        <SectionHeader
          eyebrow="The problem"
          title={
            <>
              You didn't start a clinic <br className="hidden md:block" />
              <span className="text-ink-muted">to manage software.</span>
            </>
          }
          description="Most clinics juggle 6 to 10 disconnected tools. The cost isn't just the bills — it's the 2 hours every night reconciling them."
        />

        <div className="relative mx-auto mt-16 grid max-w-6xl grid-cols-1 gap-6 md:grid-cols-2 md:gap-10">
          <div className="relative min-h-[480px]">
            <PainCard />
          </div>

          <FlowOrb />

          <div className="relative min-h-[480px]">
            <CalmCard />
          </div>
        </div>

        <figure className="mx-auto mt-20 max-w-3xl text-center">
          <MessageSquare className="mx-auto h-5 w-5 text-teal" strokeWidth={1.5} />
          <blockquote className="mf-display mt-5 text-[clamp(22px,3vw,32px)] leading-[1.3] text-ink">
            "I was paying for 7 tools that didn't talk to each other.
            <br className="hidden md:block" />
            <span className="text-teal">MedoFlow replaced all of them.</span> I haven't worked past
            6 PM in three months."
          </blockquote>
          <figcaption className="mt-6 text-[14px] text-ink-muted">
            <span className="font-medium text-ink">Dr. Sarah Chen</span> · Founder, Atlas
            Physiotherapy · Austin, TX
          </figcaption>
        </figure>
      </div>
    </section>
  )
}
