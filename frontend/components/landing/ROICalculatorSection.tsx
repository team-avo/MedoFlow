'use client'

/**
 * ROICalculatorSection — make it personal.
 *
 * Two sliders: number of providers, average ticket. We compute three
 * concrete numbers: hours saved per week, dollars recovered from no-shows,
 * incremental annual revenue. Specific to *their* clinic.
 */

import React, { useMemo, useRef, useState } from 'react'
import { Calculator, Clock, DollarSign, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SectionHeader } from './primitives'

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  format: (v: number) => string
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <label className="text-[13px] font-medium text-ink-muted">{label}</label>
        <span className="mf-display text-[28px] leading-none text-navy">{format(value)}</span>
      </div>
      <div className="relative h-6">
        {/* Track */}
        <div
          className="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-hairline"
          aria-hidden
        />
        {/* Filled portion of track */}
        <div
          className="pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-teal to-[#5EEAD4]"
          style={{ width: `calc(${pct}% + 4px)` }}
          aria-hidden
        />
        {/* Visual thumb — solid teal, slightly outset white ring */}
        <div
          className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-transform"
          style={{ left: `${pct}%` }}
          aria-hidden
        >
          <div className="relative h-5 w-5 rounded-full bg-white shadow-[0_2px_8px_rgba(13,148,136,0.35)] ring-1 ring-hairline">
            <div className="absolute inset-[3px] rounded-full bg-gradient-to-br from-teal to-[#5EEAD4]" />
          </div>
        </div>
        {/* Real input — invisible, sits on top for interaction */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="mf-slider absolute inset-0 w-full opacity-0"
        />
      </div>
    </div>
  )
}

function ResultTile({
  icon: Icon,
  label,
  value,
  sub,
  highlight,
  delay,
}: {
  icon: LucideIcon
  label: string
  value: string
  sub: string
  highlight?: boolean
  delay: number
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl p-6 ring-1 ${
        highlight ? 'bg-navy text-white ring-navy' : 'bg-white text-ink ring-hairline'
      }`}
    >
      {highlight && (
        <div
          className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-40"
          style={{
            background: 'radial-gradient(circle, rgba(94,234,212,0.5), transparent 70%)',
          }}
          aria-hidden
        />
      )}
      <div className="relative">
        <span
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${
            highlight ? 'bg-white/10 text-teal-bright' : 'bg-teal-wash text-teal'
          }`}
        >
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
        <p
          className={`mt-4 text-[12px] font-medium uppercase tracking-wider ${
            highlight ? 'text-white/60' : 'text-ink-muted'
          }`}
        >
          {label}
        </p>
        <p
          className={`mf-display mt-1 text-[clamp(28px,4vw,40px)] leading-none ${
            highlight ? 'text-white' : 'text-navy'
          }`}
        >
          {value}
        </p>
        <p className={`mt-2 text-[12px] ${highlight ? 'text-white/60' : 'text-ink-muted'}`}>
          {sub}
        </p>
      </div>
    </div>
  )
}

export function ROICalculatorSection() {
  const [providers, setProviders] = useState(4)
  const [ticket, setTicket] = useState(120)

  const results = useMemo(() => {
    // Hours saved: scribe ~5 min/visit × ~12 visits/provider/day × 5 days = 5 hrs + 2 hrs admin
    const hoursPerWeek = Math.round(providers * 7)
    // No-shows: typical 8% on industry data. Our smart waitlist recovers ~65%.
    // Monthly visits ≈ providers × 12 × 22 days
    const monthlyVisits = providers * 12 * 22
    const recoveredVisitsMo = Math.round(monthlyVisits * 0.08 * 0.65)
    const recoveredDollars = recoveredVisitsMo * ticket
    // Annual revenue uplift: recovered no-shows + 8% package/membership lift
    const annual = recoveredDollars * 12 + providers * ticket * 12 * 22 * 0.08
    return {
      hoursPerWeek,
      recoveredDollars: Math.round(recoveredDollars),
      annual: Math.round(annual / 1000) * 1000,
    }
  }, [providers, ticket])

  return (
    <section className="mf-zone-white relative py-28 md:py-36">
      <div className="container mx-auto px-6">
        <SectionHeader
          eyebrow="Make it personal"
          title={
            <>
              What MedoFlow is worth <span className="text-ink-muted">to your clinic.</span>
            </>
          }
          description="Drag the sliders. The numbers update live. No email gate, no demo call."
        />

        <div className="mx-auto mt-16 grid max-w-6xl grid-cols-1 gap-8 lg:grid-cols-[1fr_1.2fr]">
          {/* Inputs */}
          <div className="rounded-2xl border border-hairline bg-white p-7 shadow-card">
            <div className="mb-6 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-wash text-teal">
                <Calculator className="h-4 w-4" strokeWidth={2} />
              </span>
              <h3 className="mf-display text-[20px] text-ink">Your clinic, today</h3>
            </div>

            <div className="space-y-7">
              <Slider
                label="Providers"
                value={providers}
                onChange={setProviders}
                min={1}
                max={20}
                step={1}
                format={(v) => `${v}`}
              />
              <Slider
                label="Average visit price"
                value={ticket}
                onChange={setTicket}
                min={40}
                max={400}
                step={5}
                format={(v) => `$${v}`}
              />
            </div>

            <div className="mt-8 rounded-xl bg-canvas p-4 text-[12px] text-ink-muted ring-1 ring-hairline">
              Assumes ~12 visits per provider per day, ~22 working days per month. No-show recovery
              based on industry-standard 8% no-show rate and our smart-waitlist 65% backfill.
            </div>
          </div>

          {/* Results */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ResultTile
              icon={Clock}
              label="Hours back per week"
              value={`${results.hoursPerWeek}`}
              sub="AI scribe + auto-billing + portal self-serve"
              delay={0.05}
            />
            <ResultTile
              icon={DollarSign}
              label="No-shows recovered / mo"
              value={`$${results.recoveredDollars.toLocaleString()}`}
              sub="ML prediction + smart waitlist fills the slot"
              delay={0.15}
            />
            <div className="sm:col-span-2">
              <ResultTile
                icon={Sparkles}
                label="Estimated annual lift"
                value={`+$${results.annual.toLocaleString()}`}
                sub="Recovered visits + package & membership uplift · pays for MedoFlow ~30× over"
                highlight
                delay={0.25}
              />
            </div>
          </div>
        </div>

        {/* Quote */}
        <figure className="mx-auto mt-20 max-w-3xl text-center">
          <blockquote className="mf-display text-[clamp(20px,2.6vw,28px)] leading-[1.4] text-ink">
            "We modeled it at 18 hrs/week saved. <span className="text-teal">It's been 22.</span>
            <br className="hidden md:block" />
            That's a full extra clinician's worth of admin time, gone."
          </blockquote>
          <figcaption className="mt-5 text-[13px] text-ink-muted">
            <span className="font-medium text-ink">Dr. Priya Nair</span> · Owner, Lotus Family Med ·
            Phoenix
          </figcaption>
        </figure>
      </div>

      <style jsx global>{`
        .mf-slider {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          cursor: grab;
          outline: none;
          margin: 0;
        }
        .mf-slider:active {
          cursor: grabbing;
        }
        .mf-slider::-webkit-slider-runnable-track {
          background: transparent;
          height: 24px;
        }
        .mf-slider::-moz-range-track {
          background: transparent;
          height: 24px;
        }
        .mf-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          background: transparent;
          border: none;
          cursor: grab;
        }
        .mf-slider::-moz-range-thumb {
          width: 24px;
          height: 24px;
          background: transparent;
          border: none;
          cursor: grab;
        }
      `}</style>
    </section>
  )
}
