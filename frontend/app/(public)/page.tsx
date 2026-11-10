'use client'

/**
 * Public landing page.
 *
 * A story in sections, rendered as plain static markup (no scroll-jacking,
 * 3D or reveal animation — it paints once and scrolls natively):
 *   1. Hero           — the opening statement
 *   2. TrustBanner    — credibility numbers + specialties
 *   3. ChaosSection   — the problem (tension)
 *   4. BentoGrid      — the four-pillar solution (resolve)
 *   5. DayInTheLife   — what a real day feels like
 *   6. Commerce       — zoom into the revenue angle
 *   7. ROICalculator  — make it personal
 *   8. Testimonials   — social proof
 *   9. Pricing        — the plans (#pricing) → /get-started (WS4)
 *  10. FinalCTA       — the close
 */

import React from 'react'
import { HeroSection } from '@/components/landing/HeroSection'
import { TrustBanner } from '@/components/landing/TrustBanner'
import { ChaosToClaritySection } from '@/components/landing/ChaosToClaritySection'
import { BentoGridSection } from '@/components/landing/BentoGridSection'
import { DayInTheLifeSection } from '@/components/landing/DayInTheLifeSection'
import { CommerceSection } from '@/components/landing/CommerceSection'
import { ROICalculatorSection } from '@/components/landing/ROICalculatorSection'
import { TestimonialsSection } from '@/components/landing/TestimonialsSection'
import { FinalCTASection } from '@/components/landing/FinalCTASection'
import { PlanCards } from '@/components/marketing/PlanCards'

export default function PublicHomePage() {
  return (
    <div className="flex flex-col">
      <HeroSection />
      <TrustBanner />
      <ChaosToClaritySection />
      <div id="features" />
      <BentoGridSection />
      <DayInTheLifeSection />
      <CommerceSection />
      <ROICalculatorSection />
      <TestimonialsSection />
      <section id="pricing" className="mf-zone-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              Simple plans for every clinic
            </h2>
            <p className="mt-3 text-slate-600">
              Pick a plan, set up your clinic in minutes, and go live with booking, records and your
              own website.
            </p>
          </div>
          <PlanCards />
        </div>
      </section>
      <FinalCTASection />
    </div>
  )
}
