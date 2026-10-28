'use client'

/**
 * CommerceSection — chapter 6.
 *
 * Tells the revenue story. Three product surfaces visible side-by-side:
 * the package, the membership, the commission. Animated $$$ ticker
 * flowing from "visits" to "revenue." Customer quote anchors it.
 */

import React from 'react'
import { Package, Repeat, TrendingUp, ArrowRight, Sparkles } from 'lucide-react'
import { SectionHeader } from './primitives'

function RevenueTicker() {
  return (
    <div className="text-center">
      <p className="mf-eyebrow text-teal-bright">Average new revenue · year one</p>
      <p className="mf-display mt-3 text-[clamp(56px,9vw,108px)] leading-none text-white">
        +$47,280
      </p>
      <p className="mt-3 text-[14px] text-white/60">
        Per clinic — from packages, memberships, and recovered no-shows
      </p>
    </div>
  )
}

const products = [
  {
    icon: Package,
    title: 'Session packages',
    sub: 'Sell 10-session bundles upfront. Stripe collects. We track usage.',
    accent: '5 sessions left',
    example: '"10-Visit PT Pack — $450"',
  },
  {
    icon: Repeat,
    title: 'Memberships',
    sub: 'Recurring billing on Stripe. Auto-discount on every visit.',
    accent: '$99/mo · 23 active',
    example: '"Wellness Member — 20% off services"',
  },
  {
    icon: TrendingUp,
    title: 'Provider commissions',
    sub: 'Flat-rate or % rules. Posted automatically on every invoice.',
    accent: 'Dr. Chen · $1,240 this week',
    example: '"15% on services, 8% on retail"',
  },
] as const

export function CommerceSection() {
  return (
    <section className="relative overflow-hidden bg-[#0B1E35] py-32 md:py-40">
      {/* Atmospheric glow */}
      <div
        className="pointer-events-none absolute -top-32 left-1/2 h-[640px] w-[640px] -translate-x-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(13,148,136,0.4), transparent 70%)' }}
        aria-hidden
      />

      <div className="container relative mx-auto px-6">
        <div className="text-center">
          <p className="mf-eyebrow text-teal-bright">Built to grow revenue, not just track it</p>
          <h2 className="mf-display mx-auto mt-4 max-w-4xl text-[clamp(34px,5vw,64px)] leading-[1.05] text-white">
            Most clinic software <span className="text-white/40">records</span> revenue.
            <br />
            MedoFlow <span className="text-teal-bright">generates it.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-[16px] leading-relaxed text-white/60">
            Packages, memberships, commerce, commissions — built in. No third-party plug-ins. No CSV
            exports to your accountant.
          </p>
        </div>

        <div className="mt-20">
          <RevenueTicker />
        </div>

        {/* Three product surfaces */}
        <div className="mx-auto mt-20 grid max-w-6xl grid-cols-1 gap-5 md:grid-cols-3">
          {products.map((p, i) => {
            const Icon = p.icon
            return (
              <div
                key={p.title}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:bg-white/[0.05]"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-bright/15 text-teal-bright">
                    <Icon className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <ArrowRight
                    className="h-4 w-4 text-white/30 transition-transform group-hover:text-teal-bright"
                    strokeWidth={2}
                  />
                </div>

                <h3 className="mf-display mt-5 text-[20px] text-white">{p.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-white/60">{p.sub}</p>

                <div className="mt-5 rounded-lg bg-white/[0.04] p-3 ring-1 ring-white/5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    Live in your clinic
                  </p>
                  <p className="mt-1 text-[12px] text-white/80">{p.example}</p>
                  <p className="mt-1 text-[12px] font-semibold text-teal-bright">{p.accent}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Customer anchor */}
        <figure className="mx-auto mt-24 max-w-3xl text-center">
          <Sparkles className="mx-auto h-5 w-5 text-teal-bright" strokeWidth={1.5} />
          <blockquote className="mf-display mt-5 text-[clamp(20px,2.6vw,28px)] leading-[1.4] text-white">
            "We launched a $99/mo membership in 20 minutes.
            <br className="hidden md:block" />
            <span className="text-teal-bright">$32K in recurring revenue</span> in the first
            quarter."
          </blockquote>
          <figcaption className="mt-6 text-[14px] text-white/50">
            <span className="font-medium text-white/80">Marcus Yeung</span> · Owner, Pine Wellness ·
            Seattle
          </figcaption>
        </figure>
      </div>
    </section>
  )
}
