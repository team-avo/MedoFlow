'use client'

/**
 * Section type → component. Every type in lib/site/sections.ts must have an
 * entry (unit-tested), so a section added to the schema can't silently
 * render nothing.
 */
import React from 'react'
import type { Section, SectionType } from '@/lib/site/types'
import { SECTION_BY_TYPE } from '@/lib/site/sections'
import { useSite } from '../SiteContext'
import { HeroSection, TrustBarSection } from './intro'
import {
  FeaturedProductsSection,
  LocationsHoursSection,
  PricingSection,
  ProviderBiosSection,
  ServiceGridSection,
} from './clinic'
import {
  FaqSection,
  GallerySection,
  ImageWithTextSection,
  RichTextSection,
  SpacerSection,
  StepsSection,
  TestimonialsSection,
  VideoSection,
} from './content'
import { BookingCtaSection, ContactFormSection } from './conversion'

type SectionComponent = React.ComponentType<{ section: Section; first: boolean }>

export const SECTION_COMPONENTS: Record<SectionType, SectionComponent> = {
  hero: HeroSection,
  'trust-bar': TrustBarSection,
  'service-grid': ServiceGridSection,
  'provider-bios': ProviderBiosSection,
  'image-with-text': ImageWithTextSection,
  gallery: GallerySection,
  testimonials: TestimonialsSection,
  faq: FaqSection,
  pricing: PricingSection,
  'featured-products': FeaturedProductsSection,
  'locations-hours': LocationsHoursSection,
  'contact-form': ContactFormSection,
  'booking-cta': BookingCtaSection,
  video: VideoSection,
  'rich-text': RichTextSection,
  steps: StepsSection,
  spacer: SpacerSection,
}

class SectionBoundary extends React.Component<
  { children: React.ReactNode; label: string },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    // One broken section must never take the whole page down.
    return this.state.failed ? null : this.props.children
  }
}

export function SectionList({
  sections,
  selectedId,
  onSelect,
}: {
  sections: Section[]
  selectedId?: string | null
  onSelect?: (id: string) => void
}) {
  const { mode } = useSite()
  const visible = mode === 'editor' ? sections : sections.filter((s) => !s.hidden)
  return (
    <>
      {visible.map((section, i) => {
        const Component = SECTION_COMPONENTS[section.type]
        if (!Component) return null
        const body = (
          <SectionBoundary label={section.type}>
            <Component section={section} first={i === 0} />
          </SectionBoundary>
        )
        if (mode !== 'editor') return <React.Fragment key={section.id}>{body}</React.Fragment>
        return (
          <div
            key={section.id}
            className="mf-edit-frame"
            data-selected={selectedId === section.id}
            data-hidden={section.hidden}
            data-section-id={section.id}
            onClick={() => onSelect?.(section.id)}
          >
            <span className="mf-edit-tag">
              {SECTION_BY_TYPE.get(section.type)?.label ?? section.type}
              {section.hidden ? ' · hidden' : ''}
            </span>
            {body}
          </div>
        )
      })}
    </>
  )
}
