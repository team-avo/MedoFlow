'use client'

import React from 'react'
import type { Cta, ImageRef, ResolvedLink } from '@/lib/site/types'
import { siteHref, isExternalLink } from '@/lib/site/links'
import { parseMarkdown, type Inline } from '@/lib/site/markdown'
import { withSiteBase } from '@/lib/site/routes'
import { buttonClass } from '@/lib/site/theme'
import { useSite } from './SiteContext'

export function SiteImage({
  image,
  className = 'mf-img',
  eager = false,
  fallbackAlt = '',
}: {
  image: ImageRef | null | undefined
  className?: string
  eager?: boolean
  fallbackAlt?: string
}) {
  const src = image?.url ?? image?.src
  if (!src) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- clinic images come from the site-assets CDN or bundled samples; next/image optimisation isn't configured for the Workers build
    <img
      src={src}
      alt={image?.alt || fallbackAlt}
      className={className}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      width={image?.width ?? undefined}
      height={image?.height ?? undefined}
    />
  )
}

/** <a> for a resolved site link; renders plain text when the target is gone. */
export function SiteLinkAnchor({
  link,
  className,
  children,
  ...rest
}: {
  link: ResolvedLink | null | undefined
  className?: string
  children: React.ReactNode
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const { base, currentPath } = useSite()
  const href = siteHref(base, link)
  if (!href) return <span className={className}>{children}</span>
  const external = isExternalLink(link) && href.startsWith('https:')
  const current = !external && href === withSiteBase(base, currentPath)
  return (
    <a
      href={href}
      className={className}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...(current ? { 'aria-current': 'page' as const } : {})}
      {...rest}
    >
      {children}
    </a>
  )
}

export function CtaButton({
  cta,
  kind = 'primary',
  className = '',
}: {
  cta: Cta | null | undefined
  kind?: 'primary' | 'secondary' | 'light'
  className?: string
}) {
  const { settings } = useSite()
  if (!cta?.label) return null
  const cls = kind === 'light' ? 'mf-btn mf-btn-light' : buttonClass(settings.theme, kind)
  return (
    <SiteLinkAnchor link={cta.link} className={`${cls} ${className}`}>
      {cta.label}
    </SiteLinkAnchor>
  )
}

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  const { base } = useSite()
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <React.Fragment key={i}>{n.v}</React.Fragment>
          case 'strong':
            return (
              <strong key={i}>
                <InlineNodes nodes={n.c} />
              </strong>
            )
          case 'em':
            return (
              <em key={i}>
                <InlineNodes nodes={n.c} />
              </em>
            )
          case 'link':
            return (
              <a
                key={i}
                href={n.internal ? withSiteBase(base, n.href) : n.href}
                {...(n.internal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
              >
                <InlineNodes nodes={n.c} />
              </a>
            )
        }
      })}
    </>
  )
}

/** Renders the safe markdown subset as React elements (never HTML). */
export function SiteMarkdown({
  source,
  className = 'mf-prose',
}: {
  source: unknown
  className?: string
}) {
  const text = typeof source === 'string' ? source : ''
  if (!text.trim()) return null
  return (
    <div className={className}>
      {parseMarkdown(text).map((b, i) =>
        b.t === 'p' ? (
          <p key={i}>
            <InlineNodes nodes={b.c} />
          </p>
        ) : (
          <ul key={i}>
            {b.items.map((item, j) => (
              <li key={j}>
                <InlineNodes nodes={item} />
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}

export function SectionHeading({
  heading,
  intro,
  center = false,
  as: Tag = 'h2',
}: {
  heading?: unknown
  intro?: unknown
  center?: boolean
  as?: 'h1' | 'h2'
}) {
  const h = typeof heading === 'string' ? heading.trim() : ''
  const i = typeof intro === 'string' ? intro.trim() : ''
  if (!h && !i) return null
  return (
    <div className={center ? 'mf-center' : ''}>
      {h && <Tag className="mf-section-title">{h}</Tag>}
      {i ? <p className="mf-section-intro">{i}</p> : <div style={{ height: '1.5rem' }} />}
    </div>
  )
}

export const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
export const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
export const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
export const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

export const formatPrice = (amount: string | number) => {
  const n = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(n)) return ''
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: n % 1 ? 2 : 0,
  }).format(n)
}

export const initials = (name: string) =>
  name
    .replace(/^(dr\.?|mr\.?|ms\.?|mrs\.?)\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

/** URL of the app's booking flow for a service (works on every site host). */
export const bookingHref = (clinicId: string, serviceId: string) =>
  `/book/${encodeURIComponent(serviceId)}?clinicId=${encodeURIComponent(clinicId)}`
