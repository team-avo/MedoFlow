'use client'

/** Conversion sections: contact form (→ Enquiries inbox) and booking banner. */
import React from 'react'
import { CheckCircle2, MapPin, Phone } from 'lucide-react'
import type { Cta, ImageRef, Section } from '@/lib/site/types'
import { SITE_API_BASE } from '@/lib/site/renderApi'
import { buttonClass } from '@/lib/site/theme'
import { useSite } from '../SiteContext'
import { CtaButton, SiteImage, bool, str } from '../primitives'

export function ContactFormSection({ section }: { section: Section }) {
  const { mode, settings, data, base, currentPath } = useSite()
  const s = section.settings
  const [state, setState] = React.useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = React.useState('')
  const startedAt = React.useRef(Date.now())
  const askPhone = bool(s.askPhone, true)

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (mode !== 'live') return
    const f = new FormData(e.currentTarget)
    setState('sending')
    setError('')
    const clinicSlug = base.startsWith('/s/') ? base.slice(3) : undefined
    try {
      const res = await fetch(`${SITE_API_BASE}/api/v1/public/sites/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(clinicSlug ? { clinic: clinicSlug } : { host: window.location.host }),
          name: String(f.get('name') ?? ''),
          email: String(f.get('email') ?? ''),
          phone: askPhone ? String(f.get('phone') ?? '') || undefined : undefined,
          message: String(f.get('message') ?? ''),
          website: String(f.get('website') ?? ''),
          startedAt: startedAt.current,
          sourcePath: currentPath,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
          error?: string
        } | null
        throw new Error(body?.message || body?.error || 'Could not send your message')
      }
      setState('sent')
    } catch (err) {
      setError((err as Error).message)
      setState('error')
    }
  }

  const location = data.locations.find((l) => !l.isVirtual)
  const form =
    state === 'sent' ? (
      <div
        className="mf-card"
        role="status"
        style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}
      >
        <CheckCircle2 aria-hidden style={{ color: 'var(--site-primary)', flexShrink: 0 }} />
        <p style={{ margin: 0 }}>
          {str(s.successMessage, 'Thanks — we will be in touch shortly.')}
        </p>
      </div>
    ) : (
      <form className="mf-card" onSubmit={onSubmit} aria-label="Contact form" noValidate={false}>
        <label className="mf-field">
          <span className="mf-label">Name</span>
          <input className="mf-input" name="name" required maxLength={120} autoComplete="name" />
        </label>
        <label className="mf-field">
          <span className="mf-label">Email</span>
          <input
            className="mf-input"
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
          />
        </label>
        {askPhone && (
          <label className="mf-field">
            <span className="mf-label">Phone (optional)</span>
            <input className="mf-input" name="phone" type="tel" maxLength={40} autoComplete="tel" />
          </label>
        )}
        <label className="mf-field">
          <span className="mf-label">Message</span>
          <textarea className="mf-input" name="message" required rows={5} maxLength={4000} />
        </label>
        {/* Honeypot: hidden from people and screen readers, filled in by bots. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '-10000px',
            width: 1,
            height: 1,
            overflow: 'hidden',
          }}
        >
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        {str(s.consentText) && (
          <p className="mf-muted" style={{ fontSize: '0.825rem', margin: '0 0 1rem' }}>
            {str(s.consentText)}
          </p>
        )}
        {state === 'error' && (
          <p role="alert" style={{ color: '#b91c1c', margin: '0 0 1rem', fontSize: '0.9rem' }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          className={buttonClass(settings.theme)}
          disabled={state === 'sending' || mode !== 'live'}
        >
          {state === 'sending' ? 'Sending…' : str(s.submitLabel, 'Send message')}
        </button>
        {mode !== 'live' && (
          <p className="mf-muted" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
            The form works on your published site.
          </p>
        )}
      </form>
    )

  return (
    <section className="mf-section" id={section.id}>
      <div
        className={`mf-container ${section.variant === 'split' ? 'mf-split' : ''}`}
        style={{ maxWidth: section.variant === 'split' ? undefined : '40rem' }}
      >
        <div>
          {str(s.heading) && <h2 className="mf-section-title">{str(s.heading)}</h2>}
          {str(s.intro) && <p className="mf-section-intro">{str(s.intro)}</p>}
          {section.variant === 'split' && location && (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {location.phone && (
                <a
                  href={`tel:${location.phone.replace(/[^\d+]/g, '')}`}
                  style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                >
                  <Phone size={18} aria-hidden /> {location.phone}
                </a>
              )}
              {location.addressLines.length > 0 && (
                <span className="mf-muted" style={{ display: 'flex', gap: 8 }}>
                  <MapPin size={18} aria-hidden /> {location.addressLines.join(', ')}
                </span>
              )}
            </div>
          )}
        </div>
        {form}
      </div>
    </section>
  )
}

export function BookingCtaSection({ section }: { section: Section }) {
  const s = section.settings
  const image = s.image as ImageRef | null
  if (section.variant === 'split') {
    return (
      <section className="mf-section" id={section.id}>
        <div className="mf-container mf-split">
          <div>
            <h2 className="mf-section-title">{str(s.heading)}</h2>
            {str(s.text) && <p className="mf-section-intro">{str(s.text)}</p>}
            <CtaButton cta={s.cta as Cta | null} />
          </div>
          <div style={{ aspectRatio: '4 / 3' }}>
            <SiteImage image={image} />
          </div>
        </div>
      </section>
    )
  }
  return (
    <section
      style={{
        background: 'var(--site-primary)',
        color: 'var(--site-on-primary)',
        padding: 'calc(var(--site-section-y) * 0.8) 0',
      }}
      id={section.id}
    >
      <div className="mf-container mf-center">
        <h2 className="mf-section-title" style={{ color: 'inherit' }}>
          {str(s.heading)}
        </h2>
        {str(s.text) && (
          <p style={{ opacity: 0.9, fontSize: '1.1rem', margin: '0 0 1.75rem' }}>{str(s.text)}</p>
        )}
        <CtaButton cta={s.cta as Cta | null} kind="light" />
      </div>
    </section>
  )
}
