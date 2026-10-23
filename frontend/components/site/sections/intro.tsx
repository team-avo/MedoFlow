'use client'

import type { Cta, ImageRef, Section } from '@/lib/site/types'
import { CtaButton, SiteImage, arr, str } from '../primitives'

export function HeroSection({ section, first }: { section: Section; first: boolean }) {
  const s = section.settings
  const image = (s.image as ImageRef | null) ?? null
  const Title = first ? 'h1' : 'h2'
  const text = (
    <>
      {str(s.eyebrow) && <span className="mf-eyebrow">{str(s.eyebrow)}</span>}
      <Title className="mf-hero-title">{str(s.headline)}</Title>
      {str(s.subheadline) && <p className="mf-hero-sub">{str(s.subheadline)}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '2rem' }}>
        <CtaButton
          cta={s.primaryCta as Cta | null}
          kind={section.variant === 'image' ? 'light' : 'primary'}
        />
        <CtaButton cta={s.secondaryCta as Cta | null} kind="secondary" />
      </div>
    </>
  )

  if (section.variant === 'image' && (image?.url || image?.src)) {
    return (
      <section className="mf-hero-image">
        <SiteImage image={image} className="" eager={first} />
        <div className="mf-container">
          <div style={{ maxWidth: '40rem' }}>{text}</div>
        </div>
      </section>
    )
  }
  if (section.variant === 'split') {
    return (
      <section className="mf-section">
        <div className="mf-container mf-split">
          <div>{text}</div>
          <div style={{ aspectRatio: '4 / 3' }}>
            <SiteImage image={image} eager={first} />
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className="mf-section mf-section-alt">
      <div
        className="mf-container mf-center"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        <div
          style={{
            maxWidth: '48rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          {text}
        </div>
        {image && (
          <div style={{ marginTop: '3rem', width: '100%', aspectRatio: '21 / 9' }}>
            <SiteImage image={image} eager={first} />
          </div>
        )}
      </div>
    </section>
  )
}

export function TrustBarSection({ section }: { section: Section }) {
  const s = section.settings
  const stats = arr<{ value: string; label: string }>(s.stats).filter((x) => x.value || x.label)
  const logos = arr<ImageRef>(s.logos)
  return (
    <section
      style={{
        padding: '2.5rem 0',
        borderBottom: '1px solid color-mix(in srgb, var(--site-text) 8%, transparent)',
      }}
    >
      <div className="mf-container">
        {str(s.heading) && (
          <p className="mf-muted mf-center" style={{ fontWeight: 600, marginBottom: '1.5rem' }}>
            {str(s.heading)}
          </p>
        )}
        {section.variant === 'logos' ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '2.5rem',
            }}
          >
            {logos.map((l, i) => (
              <div key={i} style={{ height: '2.5rem', width: '8rem', opacity: 0.8 }}>
                <SiteImage image={l} className="" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mf-grid mf-grid-4 mf-center">
            {stats.map((x, i) => (
              <div key={i}>
                <div
                  className="mf-heading"
                  style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--site-primary)' }}
                >
                  {x.value}
                </div>
                <div className="mf-muted" style={{ fontSize: '0.9rem' }}>
                  {x.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
