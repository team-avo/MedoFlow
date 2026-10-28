'use client'

/**
 * PublicFooter — premium cinematic close.
 *
 * Layout: oversized brand statement → trust strip → newsletter →
 * refined link columns → quiet legal bar. Each row separated by a
 * gradient hairline so the footer feels like a deliberate composition,
 * not a sitemap dump.
 */

import React from 'react'
import Link from 'next/link'
import { ArrowRight, ShieldCheck, Activity, Lock, Sparkles } from 'lucide-react'
import { BrandLogo } from '@/components/common/BrandLogo'
import { BrandGradient } from '@/components/landing/BrandGradient'

type FooterColumn = {
  title: string
  links: { href: string; label: string }[]
}

const columns: FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/#pricing', label: 'Pricing' },
      { href: '/register', label: 'Start free trial' },
    ],
  },
  {
    title: 'Built for',
    links: [
      { href: '#', label: 'Primary care' },
      { href: '#', label: 'Specialists' },
      { href: '#', label: 'Mental health' },
      { href: '#', label: 'Med spas' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '#', label: 'Documentation' },
      { href: '#', label: 'API reference' },
      { href: '#', label: 'Case studies' },
      { href: '#', label: 'Blog' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '#', label: 'About' },
      { href: '#', label: 'Careers' },
      { href: '#', label: 'Contact' },
      { href: '#', label: 'Press' },
    ],
  },
]

const trustItems = [
  { icon: ShieldCheck, label: 'HIPAA compliant' },
  { icon: Lock, label: 'SOC 2 Type II' },
  { icon: Activity, label: '99.98% uptime' },
] as const

function GradientDivider() {
  return (
    <div
      className="h-px w-full"
      style={{
        background:
          'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%)',
      }}
      aria-hidden
    />
  )
}

export function PublicFooter() {
  return (
    <footer className="relative overflow-hidden bg-[#0B1E35]">
      <BrandGradient variant="navy" />

      {/* Fine grid texture — only at top, fading down */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'linear-gradient(to bottom, black 0%, transparent 80%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 80%)',
        }}
        aria-hidden
      />

      <div className="container relative z-10 mx-auto px-6 lg:px-8">
        {/* ─── Top: oversized brand statement ───────────────────────── */}
        <div className="grid gap-12 pt-24 lg:grid-cols-[1.3fr_1fr] lg:gap-20 lg:pt-32">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5">
              <Sparkles className="h-3.5 w-3.5 text-[#5EEAD4]" strokeWidth={2} />
              <span className="text-[11px] font-medium uppercase tracking-wider text-white/70">
                MedoFlow
              </span>
            </div>

            <h3 className="mf-display mt-6 text-[clamp(36px,5vw,60px)] leading-[1.05] tracking-[-0.02em] text-white">
              The operating system <br className="hidden md:block" />
              <span className="bg-gradient-to-r from-[#5EEAD4] via-[#2DD4BF] to-[#5EEAD4] bg-clip-text text-transparent">
                for modern clinics.
              </span>
            </h3>

            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-white/60">
              Intake to paid, on one timeline. Built for clinics that want to grow, not get
              nickel-and-dimed.
            </p>

            {/* Trust strip */}
            <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-3">
              {trustItems.map((item) => {
                const Icon = item.icon
                return (
                  <div
                    key={item.label}
                    className="flex items-center gap-2 text-[12.5px] text-white/65"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5EEAD4]/10 text-[#5EEAD4] ring-1 ring-[#5EEAD4]/20">
                      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                    </span>
                    {item.label}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Newsletter — refined */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
            <p className="mf-eyebrow text-[#5EEAD4]">Stay in the loop</p>
            <h4 className="mf-display mt-3 text-[22px] leading-snug text-white">
              Get product updates &amp; clinic-ops insights.
            </h4>
            <p className="mt-2 text-[13px] leading-relaxed text-white/55">
              Twice a month. No spam, no fluff. Unsubscribe in one click.
            </p>

            <form
              className="mt-6"
              onSubmit={(e) => {
                e.preventDefault()
              }}
            >
              <div className="group flex items-center gap-2 rounded-[12px] border border-white/15 bg-[#0B1E35]/60 p-1.5 transition-colors focus-within:border-[#5EEAD4]/50">
                <input
                  id="footer-email"
                  type="email"
                  required
                  placeholder="you@clinic.com"
                  className="flex-1 bg-transparent px-3 py-2 text-[13px] text-white placeholder:text-white/35 focus:outline-none"
                />
                <button
                  type="submit"
                  className="group/btn inline-flex items-center gap-1.5 rounded-[8px] bg-white px-4 py-2 text-[13px] font-semibold text-[#0B1E35] shadow-[0_4px_20px_-4px_rgba(94,234,212,0.4)] transition-colors hover:shadow-[0_8px_28px_-4px_rgba(94,234,212,0.7)]"
                >
                  Subscribe
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" />
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="mt-20">
          <GradientDivider />
        </div>

        {/* ─── Middle: brand + link columns ────────────────────────── */}
        <div className="grid gap-12 py-16 lg:grid-cols-[1fr_2.4fr] lg:gap-20">
          <div className="max-w-sm">
            <BrandLogo size="lg" tone="light" />
            <p className="mt-5 text-[13px] leading-relaxed text-white/55">
              &copy; {new Date().getFullYear()} MedoFlow Inc.
              <br />
              Built for independent clinics.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
            {columns.map((c, ci) => (
              <div key={c.title}>
                <h4 className="mf-eyebrow text-white/45">{c.title}</h4>
                <ul className="mt-5 space-y-3">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      <Link
                        href={l.href}
                        className="group inline-flex items-center gap-1.5 text-[13.5px] text-white/70 transition-colors hover:text-white"
                      >
                        <span
                          className="bg-gradient-to-r from-[#5EEAD4] to-[#5EEAD4] bg-no-repeat transition-[background-size] duration-300"
                          style={{
                            backgroundSize: '0% 1px',
                            backgroundPosition: '0 100%',
                          }}
                        >
                          {l.label}
                        </span>
                        <ArrowRight
                          className="h-3 w-3 -translate-x-1 opacity-0 transition-colors group-hover:opacity-100"
                          strokeWidth={2}
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <GradientDivider />

        {/* ─── Bottom: quiet legal bar ─────────────────────────────── */}
        <div className="flex flex-col items-start justify-between gap-4 py-8 md:flex-row md:items-center">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-white/45">
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              All systems operational
            </span>
            <span className="hidden md:inline text-white/20">·</span>
            <span>Made with care in San Francisco</span>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-white/55">
            <Link href="#" className="transition-colors hover:text-white">
              Privacy
            </Link>
            <Link href="#" className="transition-colors hover:text-white">
              Terms
            </Link>
            <Link href="#" className="transition-colors hover:text-white">
              HIPAA notice
            </Link>
            <Link href="#" className="transition-colors hover:text-white">
              Security
            </Link>
            <Link href="#" className="transition-colors hover:text-white">
              Status
            </Link>
          </div>
        </div>
      </div>

      {/* Giant low-opacity wordmark — Stripe/Linear-style premium touch */}
      <div
        aria-hidden
        className="pointer-events-none relative -mb-12 mt-4 select-none overflow-hidden"
      >
        <p
          className="mf-display text-center text-[clamp(120px,22vw,260px)] font-bold leading-[0.85] tracking-[-0.05em]"
          style={{
            background:
              'linear-gradient(180deg, rgba(94, 234, 212, 0.10) 0%, rgba(94, 234, 212, 0.0) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          MedoFlow
        </p>
      </div>
    </footer>
  )
}
