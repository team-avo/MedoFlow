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
 *   9. FinalCTA       — the close
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

export default function PublicHomePage() {
  return (
    <div className="flex flex-col">
      <HeroSection />
      <TrustBanner />
      <ChaosToClaritySection />
      <BentoGridSection />
      <DayInTheLifeSection />
      <CommerceSection />
      <ROICalculatorSection />
      <TestimonialsSection />
      <FinalCTASection />
    </div>
  )
}
