/**
 * SEO for clinic-site pages: <title>, description, canonical URL, OpenGraph,
 * robots, favicon and schema.org JSON-LD — all derived from the render
 * payload, so every route kind gets them the same way.
 */
import type { Metadata } from 'next'
import type { RenderPayload } from './types'
import { markdownToText } from './markdown'

function absolute(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  return path === '/' ? `${b}/` : `${b}${path}`
}

export function pageTitle(p: RenderPayload): string {
  const name = p.site.name
  const suffix = p.site.settings.seo.titleSuffix
  const own =
    p.page?.seoTitle ||
    (p.entity?.type === 'service' && p.entity.service.name) ||
    (p.entity?.type === 'provider' && p.entity.provider.name) ||
    (p.entity?.type === 'product' && p.entity.product.name) ||
    (p.route.key === 'store' && 'Shop') ||
    (p.route.key === 'book' && 'Book an appointment') ||
    (p.route.key === 'not-found' && 'Page not found') ||
    (p.page?.kind === 'HOME' ? '' : p.page?.title) ||
    ''
  const base = own ? `${own} | ${name}` : name
  return suffix ? `${base} ${suffix}` : base
}

export function pageDescription(p: RenderPayload): string {
  if (p.page?.seoDescription) return p.page.seoDescription
  if (p.entity?.type === 'provider' && p.entity.provider.bio)
    return p.entity.provider.bio.slice(0, 160)
  if (p.entity?.type === 'product' && p.entity.product.description)
    return p.entity.product.description.slice(0, 160)
  if (p.entity?.type === 'service') {
    const s = p.entity.service
    return `${s.name} at ${p.site.name} — ${s.durationMinutes} minutes. Book online.`
  }
  const firstText = p.page?.sections
    .map((s) =>
      typeof s.settings.subheadline === 'string'
        ? s.settings.subheadline
        : typeof s.settings.body === 'string'
          ? markdownToText(s.settings.body)
          : ''
    )
    .find(Boolean)
  return (
    p.site.settings.seo.description ||
    firstText ||
    `${p.site.name} — book an appointment online.`
  ).slice(0, 300)
}

/** A favicon from the clinic's initial and primary colour (never MedoFlow's icon). */
export function initialIcon(p: RenderPayload): string {
  const letter = (p.site.name.trim()[0] ?? '·').toUpperCase().replace(/[<&>"']/g, '')
  const color = /^#[0-9a-fA-F]{6}$/.test(p.site.settings.theme.colors.primary)
    ? p.site.settings.theme.colors.primary
    : '#0f172a'
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='${color}'/><text x='32' y='44' font-size='34' font-family='Arial,sans-serif' font-weight='700' text-anchor='middle' fill='white'>${letter}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function siteMetadata(p: RenderPayload, opts: { status: number }): Metadata {
  const canonical =
    p.site.canonicalBase && p.route.key !== 'not-found'
      ? absolute(p.site.canonicalBase, p.route.path)
      : undefined
  const og = p.site.settings.seo.ogImage?.url ?? p.site.settings.brand.logo?.url ?? undefined
  const favicon =
    p.site.settings.brand.favicon?.url ?? p.site.settings.brand.logo?.url ?? initialIcon(p)
  const noindex = p.preview || p.page?.noindex || opts.status !== 200
  return {
    title: pageTitle(p),
    description: pageDescription(p),
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title: pageTitle(p),
      description: pageDescription(p),
      siteName: p.site.name,
      type: 'website',
      ...(canonical ? { url: canonical } : {}),
      ...(og && og.startsWith('http') ? { images: [{ url: og }] } : {}),
    },
    robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
    icons: { icon: favicon },
  }
}

/** schema.org data: the clinic on every page, plus the page's own entity. */
export function jsonLd(p: RenderPayload): Record<string, unknown>[] {
  const url = p.site.canonicalBase ? absolute(p.site.canonicalBase, '/') : undefined
  const loc = p.data.locations.find((l) => !l.isVirtual)
  const clinic: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
    name: p.site.name,
    ...(url ? { url } : {}),
    ...(loc?.phone ? { telephone: loc.phone } : {}),
    ...(loc && loc.addressLines.length
      ? { address: { '@type': 'PostalAddress', streetAddress: loc.addressLines.join(', ') } }
      : {}),
  }
  const out = [clinic]
  if (p.entity?.type === 'provider') {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'Physician',
      name: p.entity.provider.name,
      ...(p.entity.provider.disciplines.length
        ? { medicalSpecialty: p.entity.provider.disciplines }
        : {}),
      ...(url ? { worksFor: { '@type': 'MedicalClinic', name: p.site.name, url } } : {}),
    })
  }
  if (p.entity?.type === 'product') {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.entity.product.name,
      ...(p.entity.product.description ? { description: p.entity.product.description } : {}),
      offers: {
        '@type': 'Offer',
        price: p.entity.product.price,
        priceCurrency: 'USD',
        availability: p.entity.product.inStock
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      },
    })
  }
  if (p.entity?.type === 'service') {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'MedicalProcedure',
      name: p.entity.service.name,
      ...(url ? { provider: { '@type': 'MedicalClinic', name: p.site.name, url } } : {}),
    })
  }
  return out
}

/** JSON for a <script type="application/ld+json">, safe against "</script>" breakouts. */
export const safeJsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')
