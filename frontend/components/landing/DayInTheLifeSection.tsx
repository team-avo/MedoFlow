'use client'

/**
 * DayInTheLifeSection — pinned-scroll cinematic.
 *
 * Sticky inner viewport. Four moments of a real Tuesday at Atlas Physio
 * advance as the user scrolls. Each moment shows a real product UI slice
 * and a quote from someone in the clinic at that exact moment.
 */

import React, { useRef } from 'react'
import { motion, useScroll, useTransform, MotionValue } from 'framer-motion'
import { Calendar, Mic, CreditCard, BarChart3, Sun, Sunrise, Coffee, Moon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MeshGradient } from './motion/MeshGradient'

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

function MomentPanel({
  moment,
  idx,
  progress,
  total,
}: {
  moment: Moment
  idx: number
  progress: MotionValue<number>
  total: number
}) {
  // Each moment is visible during a window of the scroll progress.
  // Hard-edged windows — no overlap — so moments don't stack visually.
  const window = 1 / total
  const start = idx * window
  const end = start + window
  // Tiny fade-in/out (2% of window) at the edges only.
  const fadeMs = window * 0.08
  const inEnd = start + fadeMs
  const outStart = end - fadeMs
  const opacity = useTransform(
    progress,
    [Math.max(0, start - 0.001), start, inEnd, outStart, end, Math.min(1, end + 0.001)],
    [0, 0, 1, 1, 0, 0]
  )
  const y = useTransform(progress, [start, inEnd, outStart, end], [30, 0, 0, -30])

  const Icon = moment.icon

  return (
    <motion.div
      style={{ opacity, y }}
      className="absolute inset-0 flex items-center justify-center px-6"
    >
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 md:grid-cols-2">
        {/* Left: copy + quote */}
        <div className="text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 backdrop-blur-sm">
            <Icon className="h-3.5 w-3.5 text-teal-bright" strokeWidth={2} />
            <span className="text-[11px] font-medium text-white/70">
              {moment.time} {moment.ampm} · {moment.feature}
            </span>
          </div>

          <h3 className="mf-display mt-5 text-[clamp(28px,4vw,44px)] leading-[1.1] text-white">
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

        {/* Right: live product surface */}
        <div className="max-w-md">
          <MomentVisual moment={moment} idx={idx} />
        </div>
      </div>
    </motion.div>
  )
}

export function DayInTheLifeSection() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end end'],
  })

  // Time-of-day indicator line — fills as you scroll through the day.
  const timelineWidth = useTransform(scrollYProgress, [0, 1], ['0%', '100%'])

  return (
    <section ref={ref} className="relative h-[400vh] bg-[#0B1E35]">
      <MeshGradient variant="navy" />

      <div className="sticky top-0 flex h-screen flex-col overflow-hidden">
        {/* Top-left header (always visible) */}
        <div className="absolute left-6 top-8 z-20 md:left-12 md:top-12">
          <p className="mf-eyebrow text-teal-bright">A day in the life</p>
          <h2 className="mf-display mt-2 text-[22px] text-white md:text-[28px]">
            Atlas Physiotherapy · Tuesday
          </h2>
        </div>

        {/* Time-of-day icons (top-right) */}
        <div className="absolute right-6 top-8 z-20 hidden items-center gap-3 md:right-12 md:top-12 md:flex">
          {[Sunrise, Sun, Coffee, Moon].map((I, i) => (
            <span
              key={i}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.04] text-white/40 ring-1 ring-white/10"
            >
              <I className="h-3 w-3" strokeWidth={1.5} />
            </span>
          ))}
        </div>

        {/* Slides */}
        <div className="relative flex-1">
          {moments.map((m, i) => (
            <MomentPanel
              key={m.time}
              moment={m}
              idx={i}
              progress={scrollYProgress}
              total={moments.length}
            />
          ))}
        </div>

        {/* Bottom timeline */}
        <div className="relative z-20 mx-6 mb-8 md:mx-12 md:mb-12">
          <div className="relative h-[2px] w-full overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="absolute inset-y-0 left-0 origin-left rounded-full"
              style={{
                width: timelineWidth,
                background: 'linear-gradient(90deg, #0D9488, #5EEAD4)',
              }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[10px] font-mono text-white/40">
            <span>8 AM</span>
            <span>11 AM</span>
            <span>2 PM</span>
            <span>6 PM</span>
          </div>
        </div>
      </div>
    </section>
  )
}
