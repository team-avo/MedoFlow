'use client'

/**
 * Hero — cinematic opening.
 *
 * The 3D ClinicStack lives behind the typography. Scroll progress drives
 * camera pull-back and content opacity, creating a sense of arrival.
 */

import React, { useRef } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { motion, useScroll, useTransform } from 'framer-motion'
import { ArrowRight, Sparkles, ChevronDown } from 'lucide-react'
import { MeshGradient } from './motion/MeshGradient'
import { MagneticButton } from './motion/MagneticButton'
import { useAuthModal } from '@/components/auth/AuthModal'

const ClinicStack = dynamic(() => import('./three/ClinicStack'), {
  ssr: false,
  loading: () => <div className="h-full w-full" aria-hidden />,
})

const eyebrowMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
}

export function HeroSection() {
  const { openLogin } = useAuthModal()
  const containerRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start'],
  })

  // Parallax — content drifts up, 3D drifts down, creates depth.
  const contentY = useTransform(scrollYProgress, [0, 1], ['0%', '-30%'])
  const sceneY = useTransform(scrollYProgress, [0, 1], ['0%', '15%'])
  const sceneScale = useTransform(scrollYProgress, [0, 1], [1, 1.12])
  const contentOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0])
  const sceneOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0.3])

  return (
    <section
      ref={containerRef}
      className="relative h-[100vh] min-h-[760px] w-full overflow-hidden bg-[#0B1E35]"
    >
      {/* Atmospheric gradient — drifts continuously */}
      <MeshGradient variant="navy" />

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

      {/* 3D scene — fills the viewport behind the copy */}
      <motion.div
        className="absolute inset-0 z-0"
        style={{ y: sceneY, scale: sceneScale, opacity: sceneOpacity }}
        aria-hidden
      >
        <ClinicStack className="absolute inset-0 h-full w-full" />
      </motion.div>

      {/* Vignette to ground typography — darker at edges only, lets the 3D show through center */}
      <div
        className="absolute inset-0 z-[1]"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at center, transparent 0%, rgba(11, 30, 53, 0.0) 35%, rgba(11, 30, 53, 0.45) 75%, rgba(11, 30, 53, 0.7) 100%)',
        }}
        aria-hidden
      />
      {/* Light text-area scrim — keeps copy readable but lets the 3D glow through */}
      <div
        className="absolute left-1/2 top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2"
        style={{
          width: '70vw',
          maxWidth: '760px',
          height: '50vh',
          background:
            'radial-gradient(ellipse at center, rgba(11, 30, 53, 0.30) 0%, rgba(11, 30, 53, 0.08) 60%, transparent 90%)',
          filter: 'blur(40px)',
        }}
        aria-hidden
      />

      {/* Foreground content */}
      <motion.div
        className="relative z-10 flex h-full items-center"
        style={{ y: contentY, opacity: contentOpacity }}
      >
        <div className="container mx-auto px-6">
          <div className="mx-auto max-w-3xl text-center">
            <motion.div
              {...eyebrowMotion}
              className="mf-eyebrow inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5 backdrop-blur-sm"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} style={{ color: '#5EEAD4' }} />
              <span className="text-white/70">The clinic operating system · Built on AI</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="mf-display mt-7 text-[clamp(44px,7vw,84px)] leading-[1.02] tracking-[-0.02em] text-white"
            >
              The clinic OS that
              <br />
              <span className="inline-block bg-gradient-to-r from-[#5EEAD4] via-[#2DD4BF] to-[#5EEAD4] bg-clip-text text-transparent">
                runs itself.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto mt-7 max-w-xl text-[17px] leading-relaxed text-white/70"
            >
              Scheduling, EMR, billing, payments, an ambient AI scribe — and soon, an AI front desk
              that answers your phone. One platform. One bill. No stitching.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="mt-10 flex flex-wrap items-center justify-center gap-3"
            >
              <MagneticButton
                onClick={openLogin}
                className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-[15px] font-semibold text-[#0B1E35] shadow-[0_10px_40px_-10px_rgba(94,234,212,0.6)] transition-shadow hover:shadow-[0_14px_50px_-10px_rgba(94,234,212,0.8)]"
              >
                Start free trial
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </MagneticButton>

              <Link
                href="#how-it-works"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 text-[15px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/[0.08]"
              >
                See the product
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.7 }}
              className="mt-8 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[13px] text-white/50"
            >
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
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: [0, 6, 0] }}
        transition={{
          opacity: { duration: 0.6, delay: 1.2 },
          y: { duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 1.2 },
        }}
        className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2"
      >
        <div className="flex flex-col items-center gap-2 text-white/50">
          <span className="mf-eyebrow text-[10px]">Scroll</span>
          <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
        </div>
      </motion.div>
    </section>
  )
}
