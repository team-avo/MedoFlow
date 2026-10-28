'use client'

/**
 * Hero — the opening statement on a static brand backdrop (gradient + grid).
 * No 3D scene, parallax or entrance animation: it paints once and is done.
 */

import React from 'react'
import Link from 'next/link'
import { ArrowRight, Sparkles, ChevronDown } from 'lucide-react'
import { BrandGradient } from './BrandGradient'
import { useAuthModal } from '@/components/auth/AuthModal'

export function HeroSection() {
  const { openLogin } = useAuthModal()

  return (
    <section className="relative min-h-[640px] w-full overflow-hidden bg-[#0B1E35] md:h-[100vh] md:min-h-[720px]">
      <BrandGradient variant="navy" />

      {/* Fine grid texture for high-tech feel */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }}
        aria-hidden
      />

      {/* Vignette to ground the typography — darker at the edges only */}
      <div
        className="absolute inset-0 z-[1]"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at center, transparent 0%, rgba(11, 30, 53, 0.0) 35%, rgba(11, 30, 53, 0.45) 75%, rgba(11, 30, 53, 0.7) 100%)',
        }}
        aria-hidden
      />

      {/* Foreground content */}
      <div className="relative z-10 flex h-full items-center py-28 md:py-0">
        <div className="container mx-auto px-6">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mf-eyebrow inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} style={{ color: '#5EEAD4' }} />
              <span className="text-white/70">The clinic operating system · Built on AI</span>
            </div>

            <h1 className="mf-display mt-7 text-[clamp(44px,7vw,84px)] leading-[1.02] tracking-[-0.02em] text-white">
              The clinic OS that
              <br />
              <span className="inline-block bg-gradient-to-r from-[#5EEAD4] via-[#2DD4BF] to-[#5EEAD4] bg-clip-text text-transparent">
                runs itself.
              </span>
            </h1>

            <p className="mx-auto mt-7 max-w-xl text-[17px] leading-relaxed text-white/70">
              Scheduling, EMR, billing, payments, an ambient AI scribe — and soon, an AI front desk
              that answers your phone. One platform. One bill. No stitching.
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={openLogin}
                className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-[15px] font-semibold text-[#0B1E35] shadow-[0_10px_40px_-10px_rgba(94,234,212,0.6)] transition-shadow hover:shadow-[0_14px_50px_-10px_rgba(94,234,212,0.8)]"
              >
                Start free trial
                <ArrowRight className="h-4 w-4 transition-transform" />
              </button>

              <Link
                href="#how-it-works"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-white/[0.08]"
              >
                See the product
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[13px] text-white/50">
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-[#5EEAD4]" />
                No credit card
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-[#5EEAD4]" />
                14-day trial
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-[#5EEAD4]" />
                HIPAA &amp; SOC2 aligned
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2">
        <div className="flex flex-col items-center gap-2 text-white/50">
          <span className="mf-eyebrow text-[10px]">Scroll</span>
          <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
        </div>
      </div>
    </section>
  )
}
