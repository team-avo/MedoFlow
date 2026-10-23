'use client'

/** Content sections: image + text, gallery, testimonials, FAQ, video, text, steps, spacer. */
import type { Cta, ImageRef, Section } from '@/lib/site/types'
import { CtaButton, SectionHeading, SiteImage, SiteMarkdown, arr, bool, str } from '../primitives'
import { EmptyHint } from './clinic'

export function ImageWithTextSection({ section }: { section: Section }) {
  const s = section.settings
  return (
    <section className="mf-section" id={section.id}>
      <div
        className={`mf-container mf-split ${section.variant === 'image-right' ? 'mf-split-reverse' : ''}`}
      >
        <div style={{ aspectRatio: '4 / 3' }}>
          <SiteImage image={s.image as ImageRef | null} />
        </div>
        <div>
          {str(s.heading) && <h2 className="mf-section-title">{str(s.heading)}</h2>}
          <SiteMarkdown source={s.body} />
          <div style={{ marginTop: '1.5rem' }}>
            <CtaButton cta={s.cta as Cta | null} />
          </div>
        </div>
      </div>
    </section>
  )
}

export function GallerySection({ section }: { section: Section }) {
  const s = section.settings
  const images = arr<ImageRef>(s.images)
  return (
    <section className="mf-section" id={section.id}>
      <div className="mf-container">
        <SectionHeading heading={s.heading} />
        {images.length === 0 && <EmptyHint>Add photos from your media library.</EmptyHint>}
        {section.variant === 'strip' ? (
          <div
            style={{
              display: 'grid',
              gridAutoFlow: 'column',
              gridAutoColumns: 'minmax(16rem, 1fr)',
              gap: '1rem',
              overflowX: 'auto',
              scrollSnapType: 'x mandatory',
            }}
          >
            {images.map((img, i) => (
              <div key={i} style={{ aspectRatio: '4 / 3', scrollSnapAlign: 'start' }}>
                <SiteImage image={img} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mf-grid mf-grid-3">
            {images.map((img, i) => (
              <div key={i} style={{ aspectRatio: '4 / 3' }}>
                <SiteImage image={img} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export function TestimonialsSection({ section }: { section: Section }) {
  const s = section.settings
  const items = arr<{ quote: string; author: string; detail: string }>(s.items).filter(
    (x) => x.quote
  )
  if (section.variant === 'quote') {
    const q = items[0]
    return (
      <section className="mf-section mf-section-alt" id={section.id}>
        <div className="mf-container mf-center" style={{ maxWidth: '50rem' }}>
          <SectionHeading heading={s.heading} center />
          {q ? (
            <figure style={{ margin: 0 }}>
              <blockquote
                className="mf-heading"
                style={{
                  fontSize: 'clamp(1.4rem, 1rem + 1.6cqw, 2.1rem)',
                  fontWeight: 500,
                  margin: 0,
                }}
              >
                “{q.quote}”
              </blockquote>
              {(q.author || q.detail) && (
                <figcaption className="mf-muted" style={{ marginTop: '1.25rem' }}>
                  {q.author && <strong style={{ color: 'var(--site-text)' }}>{q.author}</strong>}
                  {q.detail && <span> · {q.detail}</span>}
                </figcaption>
              )}
            </figure>
          ) : (
            <EmptyHint>Add a review.</EmptyHint>
          )}
        </div>
      </section>
    )
  }
  return (
    <section className="mf-section mf-section-alt" id={section.id}>
      <div className="mf-container">
        <SectionHeading heading={s.heading} />
        {items.length === 0 && (
          <EmptyHint>Add reviews (only with your patients’ consent).</EmptyHint>
        )}
        <div className="mf-grid mf-grid-3">
          {items.map((t, i) => (
            <figure key={i} className="mf-card" style={{ margin: 0 }}>
              <div
                aria-hidden
                style={{ color: 'var(--site-accent)', fontSize: '2rem', lineHeight: 1 }}
              >
                “
              </div>
              <blockquote style={{ margin: '0.25rem 0 1rem' }}>{t.quote}</blockquote>
              <figcaption className="mf-muted" style={{ fontSize: '0.9rem' }}>
                {t.author && <strong style={{ color: 'var(--site-text)' }}>{t.author}</strong>}
                {t.detail && <span style={{ display: 'block' }}>{t.detail}</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}

export function FaqSection({ section }: { section: Section }) {
  const s = section.settings
  const items = arr<{ question: string; answer: string }>(s.items).filter((x) => x.question)
  const list = (xs: typeof items) => (
    <div>
      {xs.map((x, i) => (
        <details key={i} className="mf-faq-item">
          <summary>{x.question}</summary>
          <div style={{ paddingBottom: '1.1rem' }}>
            <SiteMarkdown source={x.answer} className="mf-prose mf-muted" />
          </div>
        </details>
      ))}
    </div>
  )
  const half = Math.ceil(items.length / 2)
  return (
    <section className="mf-section" id={section.id}>
      <div
        className="mf-container"
        style={{ maxWidth: section.variant === 'two-column' ? undefined : '52rem' }}
      >
        <SectionHeading heading={s.heading} />
        {items.length === 0 && <EmptyHint>Add questions and answers.</EmptyHint>}
        {section.variant === 'two-column' ? (
          <div className="mf-grid mf-grid-2" style={{ gap: '0 3rem' }}>
            {list(items.slice(0, half))}
            {list(items.slice(half))}
          </div>
        ) : (
          list(items)
        )}
      </div>
    </section>
  )
}

/** YouTube / Vimeo URL → privacy-friendly embed URL (allow-listed hosts only). */
export function embedUrl(url: string): string | null {
  const yt = /^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,20})$/.exec(url)
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`
  const vimeo = /^https:\/\/(?:www\.)?vimeo\.com\/(\d{4,12})$/.exec(url)
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}?dnt=1`
  return null
}

export function VideoSection({ section }: { section: Section }) {
  const s = section.settings
  const src = embedUrl(str(s.url))
  return (
    <section className="mf-section" id={section.id}>
      <div
        className="mf-container"
        style={{ maxWidth: section.variant === 'wide' ? undefined : '56rem' }}
      >
        <SectionHeading heading={s.heading} />
        {src ? (
          <div
            style={{
              position: 'relative',
              aspectRatio: '16 / 9',
              borderRadius: 'var(--site-radius)',
              overflow: 'hidden',
              background: '#000',
            }}
          >
            <iframe
              src={src}
              title={str(s.heading) || 'Video'}
              loading="lazy"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
            />
          </div>
        ) : (
          <EmptyHint>Paste a YouTube or Vimeo link.</EmptyHint>
        )}
        {str(s.caption) && (
          <p className="mf-muted mf-center" style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
            {str(s.caption)}
          </p>
        )}
      </div>
    </section>
  )
}

export function RichTextSection({ section, first }: { section: Section; first: boolean }) {
  const s = section.settings
  const center = section.variant === 'center'
  return (
    <section className="mf-section" id={section.id}>
      <div className={`mf-container ${center ? 'mf-center' : ''}`} style={{ maxWidth: '48rem' }}>
        {str(s.heading) &&
          (first ? (
            <h1 className="mf-section-title">{str(s.heading)}</h1>
          ) : (
            <h2 className="mf-section-title">{str(s.heading)}</h2>
          ))}
        <SiteMarkdown source={s.body} />
      </div>
    </section>
  )
}

export function StepsSection({ section }: { section: Section }) {
  const s = section.settings
  const items = arr<{ title: string; text: string }>(s.items).filter((x) => x.title)
  return (
    <section className="mf-section" id={section.id}>
      <div className="mf-container">
        <SectionHeading heading={s.heading} center />
        <div className={`mf-grid ${items.length >= 4 ? 'mf-grid-4' : 'mf-grid-3'}`}>
          {items.map((x, i) => (
            <div
              key={i}
              className={section.variant === 'cards' ? 'mf-card' : ''}
              style={{ textAlign: section.variant === 'cards' ? 'left' : 'center' }}
            >
              <div
                className="mf-heading"
                style={{
                  width: '2.75rem',
                  height: '2.75rem',
                  borderRadius: 999,
                  display: 'inline-grid',
                  placeItems: 'center',
                  fontWeight: 800,
                  background: 'var(--site-primary)',
                  color: 'var(--site-on-primary)',
                  marginBottom: '1rem',
                }}
              >
                {i + 1}
              </div>
              <h3 style={{ margin: '0 0 0.4rem', fontSize: '1.15rem', fontWeight: 700 }}>
                {x.title}
              </h3>
              {x.text && (
                <p className="mf-muted" style={{ margin: 0 }}>
                  {x.text}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function SpacerSection({ section }: { section: Section }) {
  const size =
    section.variant === 'small' ? '1.5rem' : section.variant === 'large' ? '6rem' : '3rem'
  return (
    <div aria-hidden style={{ padding: `${size} 0` }}>
      {bool(section.settings.divider, false) && (
        <div className="mf-container">
          <hr
            style={{
              border: 0,
              borderTop: '1px solid color-mix(in srgb, var(--site-text) 12%, transparent)',
              margin: 0,
            }}
          />
        </div>
      )}
    </div>
  )
}
