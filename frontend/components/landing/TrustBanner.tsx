'use client'

/**
 * MetricsBar (TrustBanner) — headline numbers on plain tiles and a wrapping
 * row of specialties. Static: no counters, tilt or marquee.
 */

import React from 'react'

type Metric = { value: number; suffix: string; prefix?: string; label: string }

const metrics: Metric[] = [
  { value: 2400, suffix: '+', label: 'Clinics across 14 specialties' },
  { value: 18, suffix: ' hrs', label: 'Admin time saved per provider / week' },
  { value: 99.98, suffix: '%', label: 'Uptime across charting + payments' },
]

const specialties = [
  'Primary Care',
  'Dermatology',
  'Mental Health',
  'Orthopedics',
  'Pediatrics',
  'Cardiology',
  'Med Spas',
  'Wellness Clinics',
  'Internal Medicine',
  'Neurology',
  'Physiotherapy',
  'Chiropractic',
]

function formatMetric({ value, suffix, prefix }: Metric) {
  return `${prefix ?? ''}${Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(2)}${suffix}`
}

function MetricTile({ metric }: { metric: Metric }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-hairline bg-white p-7 shadow-card transition-shadow hover:shadow-card-hover">
      {/* Soft gradient sheen on hover */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at top right, rgba(13, 148, 136, 0.08), transparent 70%)',
        }}
        aria-hidden
      />
      <p className="mf-display text-[clamp(34px,4.5vw,52px)] leading-none text-navy">
        {formatMetric(metric)}
      </p>
      <p className="mt-3 max-w-[18rem] text-[13px] leading-relaxed text-ink-muted">
        {metric.label}
      </p>
    </div>
  )
}

export function TrustBanner() {
  return (
    <section className="relative bg-canvas border-y border-hairline overflow-hidden">
      {/* Top accent line — bleeds teal from hero */}
      <div
        className="absolute left-0 right-0 top-0 h-[1px]"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(13, 148, 136, 0.4), transparent)',
        }}
        aria-hidden
      />

      <div className="container mx-auto px-6 py-20">
        <div className="mb-12 text-center">
          <p className="mf-eyebrow text-ink-muted">Trusted by clinics nationwide</p>
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 md:grid-cols-3">
          {metrics.map((m) => (
            <MetricTile key={m.label} metric={m} />
          ))}
        </div>
      </div>

      {/* Specialties — a static, wrapping row */}
      <div className="border-t border-hairline px-6 py-7">
        <ul className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {specialties.map((name) => (
            <li
              key={name}
              className="flex items-center gap-2.5 whitespace-nowrap text-[13px] font-medium text-ink-muted"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-teal/40" aria-hidden />
              {name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
