'use client'

/**
 * FinalCTA — the close: headline and CTA over a static teal bloom.
 */

import React from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { BrandGradient } from './BrandGradient'
import { useAuthModal } from '@/components/auth/AuthModal'

const words = ['Run', 'your', 'entire', 'practice', 'on', 'a', 'single', 'timeline.']

export function FinalCTASection() {
  const { openLogin } = useAuthModal()
  return (
    <section className="relative overflow-hidden bg-[#0B1E35] py-28 md:py-40">
      <BrandGradient variant="navy" />

      {/* Fine grid */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }}
        aria-hidden
      />

      <div className="relative flex items-center">
        {/* Central teal bloom (static radial gradient, no filter) */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[80vh] max-h-[720px] w-[80vh] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full opacity-50"
          style={{
            background:
              'radial-gradient(circle, rgba(94, 234, 212, 0.55) 0%, rgba(13, 148, 136, 0.25) 30%, transparent 70%)',
          }}
          aria-hidden
        />

        {/* Content */}
        <div className="container relative z-10 mx-auto px-6 text-center">
          <p className="mf-eyebrow mb-6 text-white/60">Ready when you are</p>

          <h2 className="mf-display mx-auto max-w-5xl text-[clamp(40px,7vw,82px)] leading-[1.02] tracking-[-0.02em] text-white">
            <span className="inline-flex flex-wrap justify-center gap-x-[0.25em]">
              {words.slice(0, 6).map((word, i) => (
                <span key={i}>{word}</span>
              ))}
            </span>
            <br />
            <span className="inline-flex flex-wrap justify-center gap-x-[0.25em]">
              {words.slice(6).map((word, i) => (
                <span
                  key={i + 6}
                  className={
                    word === 'timeline.'
                      ? 'bg-gradient-to-r from-[#5EEAD4] via-[#2DD4BF] to-[#5EEAD4] bg-clip-text text-transparent'
                      : ''
                  }
                >
                  {word}
                </span>
              ))}
            </span>
          </h2>

          <p className="mx-auto mt-8 max-w-xl text-[17px] leading-relaxed text-white/70">
            Join 2,400+ clinics already running intake, charting, and billing on MedoFlow.
          </p>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={openLogin}
              className="group inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 text-[15px] font-semibold text-[#0B1E35] shadow-[0_14px_50px_-12px_rgba(94,234,212,0.7)] transition-shadow hover:shadow-[0_18px_60px_-10px_rgba(94,234,212,0.95)]"
            >
              Start free trial
              <ArrowRight className="h-4 w-4 transition-transform" />
            </button>
            <Link
              href="#demo"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-7 py-4 text-[15px] font-medium text-white transition-colors hover:bg-white/[0.08]"
            >
              Book a demo
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[13px] text-white/50">
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-[#5EEAD4]" />
              14-day trial
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-[#5EEAD4]" />
              No credit card
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-[#5EEAD4]" />
              HIPAA &amp; SOC2 aligned
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
