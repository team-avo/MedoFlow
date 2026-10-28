'use client'

/**
 * DayInTheLifeSection — four moments of a real Tuesday at Atlas Physio,
 * stacked as a timeline. Each shows a product UI slice and the person in
 * the clinic at that moment. Plain document flow: no pinning or scroll-
 * driven animation.
 */

import React from 'react'
import { Mic, Sunrise, Coffee, Moon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BrandGradient } from './BrandGradient'

type Moment = {
  time: string
  ampm: string
  icon: LucideIcon
  title: string
  body: string
  who: string
  role: string
  feature: string
}

const moments: Moment[] = [
  {
    time: '8:42',
    ampm: 'AM',
    icon: Sunrise,
    title: 'Coffee, then a one-glance brief.',
    body: 'Sarah opens MedoFlow on the iPad. Twelve appointments today, two new patients, three telehealth. The AI has already pre-charted the regulars from their last visit.',
    who: 'Dr. Sarah Chen',
    role: 'Owner & Physiotherapist',
    feature: 'Morning brief',
  },
  {
    time: '10:38',
    ampm: 'AM',
    icon: Mic,
    title: 'The consult ends. The note is already written.',
    body: 'During the session, MedoFlow listened. Now Sarah reviews a structured SOAP note, edits three lines, signs. The patient gets a friendly summary in their portal before they reach the parking lot.',
    who: 'Dr. Sarah Chen',
    role: 'Physiotherapist',
    feature: 'AI Scribe',
  },
  {
    time: '1:15',
    ampm: 'PM',
    icon: Coffee,
    title: 'A walk-in. No chaos. No "let me check."',
    body: 'Maya at the front desk opens the POS. Adds the session, an exercise band from inventory, applies the membership discount. Stripe ping. Receipt sent. Commission posted to Sarah automatically.',
    who: 'Maya Patel',
    role: 'Front Desk',
    feature: 'Point of Sale',
  },
  {
    time: '6:04',
    ampm: 'PM',
    icon: Moon,
    title: 'End of day. The numbers are already in.',
    body: "No spreadsheet to update. No reconciliation. MedoFlow shows revenue, top services, who came in, who didn't, and which two patients need a follow-up call this week. Sarah closes the iPad. Drives home.",
    who: 'Dr. Sarah Chen',
    role: 'Owner',
    feature: 'Analytics',
  },
]

function MomentVisual({ moment, idx }: { moment: Moment; idx: number }) {
  if (idx === 0) {
    return (
      <div className="rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/10">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/50">
          Tuesday · 12 appointments
        </p>
        <div className="space-y-1.5">
          {[
            { t: '9:00', n: 'New patient · Wellness check' },
            { t: '10:30', n: 'James R. · Follow-up' },
            { t: '11:45', n: 'Emily W. · Consultation' },
            { t: '1:30', n: 'Telehealth · Marco V.' },
            { t: '2:45', n: 'New patient · Post-op intake' },
          ].map((s) => (
            <div
              key={s.t}
              className="flex items-center justify-between rounded bg-white/[0.04] px-2.5 py-2 text-[11px]"
            >
              <span className="font-mono text-white/60">{s.t}</span>
              <span className="text-white/80">{s.n}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (idx === 1) {
    return (
      <div className="rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/10">
        <div className="mb-3 flex items-center justify-between">
          <span className="rounded-full bg-teal-bright/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-bright">
            SOAP · Auto-generated
          </span>
          <span className="text-[10px] font-mono text-white/40">04:12</span>
        </div>
        <div className="space-y-2.5 text-[12px]">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Subjective
            </p>
            <p className="mt-0.5 text-white/80">
              Pain down to 3/10 from 7. Sleeping through night.
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Assessment
            </p>
            <p className="mt-0.5 text-white/80">L4-L5 strain resolving. Mobility 80% baseline.</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Plan</p>
            <p className="mt-0.5 text-white/80">Continue PT 2×/wk. Add foam roll. Re-eval 2wk.</p>
          </div>
        </div>
      </div>
    )
  }
  if (idx === 2) {
    return (
      <div className="rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/10">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/50">
          Walk-in · Maya Patel
        </p>
        <div className="space-y-1.5 text-[12px]">
          <div className="flex justify-between text-white/80">
            <span>30-min session</span>
            <span>$85.00</span>
          </div>
          <div className="flex justify-between text-white/80">
            <span>Exercise band · qty 1</span>
            <span>$24.00</span>
          </div>
          <div className="flex justify-between text-white/50">
            <span>Wellness member 15% off</span>
            <span>−$16.35</span>
          </div>
          <div className="my-2 h-px bg-white/10" />
          <div className="flex justify-between text-[13px] font-semibold text-white">
            <span>Total</span>
            <span>$92.65</span>
          </div>
          <button className="mt-2 w-full rounded-md bg-teal-bright px-2 py-2 text-[11px] font-semibold text-navy">
            Tap card · Stripe Terminal
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/10">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-white/50">
        Today's wrap
      </p>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Revenue', v: '$4,280', d: '+12% vs avg' },
          { label: 'Visits', v: '12', d: '0 no-shows' },
          { label: 'New patients', v: '3', d: 'via website' },
          { label: 'Follow-ups due', v: '2', d: 'queued' },
        ].map((m) => (
          <div key={m.label} className="rounded-lg bg-white/[0.04] p-3">
            <p className="text-[10px] uppercase tracking-wider text-white/50">{m.label}</p>
            <p className="mf-display mt-1 text-[18px] text-white">{m.v}</p>
            <p className="text-[10px] text-teal-bright">{m.d}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function MomentPanel({ moment, idx }: { moment: Moment; idx: number }) {
  const Icon = moment.icon

  return (
    <li className="relative pl-8 md:pl-12">
      {/* Timeline dot */}
      <span
        className="absolute left-0 top-1.5 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-[#0B1E35] ring-2 ring-teal-bright/60"
        aria-hidden
      >
        <span className="h-1.5 w-1.5 rounded-full bg-teal-bright" />
      </span>

      <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-12">
        {/* Left: copy + quote */}
        <div className="min-w-0 text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5">
            <Icon className="h-3.5 w-3.5 text-teal-bright" strokeWidth={2} />
            <span className="text-[11px] font-medium text-white/70">
              {moment.time} {moment.ampm} · {moment.feature}
            </span>
          </div>

          <h3 className="mf-display mt-5 text-[clamp(26px,3.6vw,40px)] leading-[1.15] text-white">
            {moment.title}
          </h3>

          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-white/70">{moment.body}</p>

          <div className="mt-7 flex items-center gap-3 border-l-2 border-teal-bright/40 pl-4">
            <div>
              <p className="text-[13px] font-medium text-white">{moment.who}</p>
              <p className="text-[11px] text-white/50">{moment.role} · Atlas Physiotherapy</p>
            </div>
          </div>
        </div>

        {/* Right: product surface */}
        <div className="w-full max-w-md">
          <MomentVisual moment={moment} idx={idx} />
        </div>
      </div>
    </li>
  )
}

export function DayInTheLifeSection() {
  return (
    <section className="relative overflow-hidden bg-[#0B1E35] py-24 md:py-32">
      <BrandGradient variant="navy" />

      <div className="container relative mx-auto px-6">
        <div className="mx-auto max-w-6xl">
          <p className="mf-eyebrow text-teal-bright">A day in the life</p>
          <h2 className="mf-display mt-2 text-[26px] text-white md:text-[34px]">
            Atlas Physiotherapy · Tuesday
          </h2>

          <ol className="relative mt-14 space-y-16 border-l border-white/10 md:space-y-20">
            {moments.map((m, i) => (
              <MomentPanel key={m.time} moment={m} idx={i} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
