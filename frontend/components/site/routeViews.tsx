'use client'

/**
 * Views for routes that aren't builder pages: service / provider / product
 * detail, the store, the booking picker and the branded 404. One component
 * per route kind (see lib/site/routes.ts).
 */
import { Clock, Globe2, ShoppingBag } from 'lucide-react'
import type { PublicProduct, PublicProvider, PublicService } from '@/lib/site/types'
import { trySitePath, withSiteBase } from '@/lib/site/routes'
import { buttonClass } from '@/lib/site/theme'
import { useSite } from './SiteContext'
import { bookingHref, formatPrice, initials } from './primitives'
import { ProductCard, ProviderCard, ServiceCard } from './sections/clinic'

function Crumb({ label, routeKey }: { label: string; routeKey: 'services' | 'team' | 'store' }) {
  const { base } = useSite()
  return (
    <a
      className="mf-link"
      href={withSiteBase(base, trySitePath(routeKey) ?? '/')}
      style={{ fontSize: '0.9rem' }}
    >
      ← {label}
    </a>
  )
}

export function ServiceView({ service }: { service: PublicService }) {
  const { data, clinicId, settings } = useSite()
  const team = data.providers.filter((p) => p.serviceIds.includes(service.id))
  return (
    <section className="mf-section">
      <div className="mf-container" style={{ maxWidth: '56rem' }}>
        <Crumb label="All services" routeKey="services" />
        {service.discipline && (
          <div style={{ marginTop: '1.5rem' }}>
            <span className="mf-chip">{service.discipline}</span>
          </div>
        )}
        <h1 className="mf-hero-title" style={{ fontSize: 'clamp(2rem, 1.5rem + 2cqw, 3rem)' }}>
          {service.name}
        </h1>
        <div
          className="mf-muted"
          style={{ display: 'flex', gap: '1.5rem', fontSize: '1.05rem', marginBottom: '2rem' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Clock size={18} aria-hidden /> {service.durationMinutes} minutes
          </span>
          {Number(service.price) > 0 && (
            <strong style={{ color: 'var(--site-text)' }}>{formatPrice(service.price)}</strong>
          )}
        </div>
        <a className={buttonClass(settings.theme)} href={bookingHref(clinicId, service.id)}>
          Book this service
        </a>
        {team.length > 0 && (
          <div style={{ marginTop: '4rem' }}>
            <h2 className="mf-section-title" style={{ fontSize: '1.5rem' }}>
              Who provides it
            </h2>
            <div className="mf-grid mf-grid-2">
              {team.map((p) => (
                <ProviderCard key={p.id} provider={p} showBio />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export function ProviderView({ provider }: { provider: PublicProvider }) {
  const { data } = useSite()
  const services = data.services.filter((s) => provider.serviceIds.includes(s.id))
  return (
    <section className="mf-section">
      <div className="mf-container" style={{ maxWidth: '60rem' }}>
        <Crumb label="Our team" routeKey="team" />
        <div
          style={{
            display: 'flex',
            gap: '2rem',
            alignItems: 'center',
            margin: '2rem 0',
            flexWrap: 'wrap',
          }}
        >
          <div className="mf-avatar" style={{ width: '8rem', height: '8rem', fontSize: '2rem' }}>
            {provider.headshotUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- provider headshot from the clinic's own storage
              <img
                src={provider.headshotUrl}
                alt={provider.name}
                className="mf-img"
                style={{ borderRadius: 999 }}
              />
            ) : (
              <span aria-hidden>{initials(provider.name)}</span>
            )}
          </div>
          <div>
            <h1
              className="mf-hero-title"
              style={{ fontSize: 'clamp(2rem, 1.5rem + 2cqw, 2.75rem)', margin: 0 }}
            >
              {provider.name}
            </h1>
            {provider.disciplines.length > 0 && (
              <p className="mf-muted" style={{ margin: '0.25rem 0 0' }}>
                {provider.disciplines.join(' · ')}
              </p>
            )}
            {provider.languages.length > 0 && (
              <p
                className="mf-muted"
                style={{ margin: '0.25rem 0 0', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Globe2 size={16} aria-hidden /> {provider.languages.join(', ')}
              </p>
            )}
          </div>
        </div>
        {provider.bio && (
          <div className="mf-prose" style={{ fontSize: '1.05rem', maxWidth: '46rem' }}>
            {provider.bio.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}
        {services.length > 0 && (
          <div style={{ marginTop: '3rem' }}>
            <h2 className="mf-section-title" style={{ fontSize: '1.5rem' }}>
              Book with {provider.name.split(' ')[0]}
            </h2>
            <div className="mf-grid mf-grid-3">
              {services.map((s) => (
                <ServiceCard key={s.id} service={s} showPrices showDuration />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export function StoreView() {
  const { data } = useSite()
  return (
    <section className="mf-section">
      <div className="mf-container">
        <h1 className="mf-section-title">Shop</h1>
        <p className="mf-section-intro">Products recommended by our clinicians.</p>
        <div className="mf-grid mf-grid-4">
          {data.products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  )
}

export function ProductView({ product }: { product: PublicProduct }) {
  const { actions, settings, mode } = useSite()
  return (
    <section className="mf-section">
      <div className="mf-container mf-split">
        <div
          aria-hidden
          style={{
            aspectRatio: '1 / 1',
            borderRadius: 'var(--site-radius)',
            background: 'var(--site-surface)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--site-primary)',
          }}
        >
          <ShoppingBag size={72} />
        </div>
        <div>
          <Crumb label="Shop" routeKey="store" />
          <h1 className="mf-hero-title" style={{ fontSize: 'clamp(2rem, 1.5rem + 2cqw, 2.75rem)' }}>
            {product.name}
          </h1>
          <div
            className="mf-heading"
            style={{
              fontSize: '1.75rem',
              fontWeight: 800,
              color: 'var(--site-primary)',
              marginBottom: '1rem',
            }}
          >
            {formatPrice(product.price)}
          </div>
          {product.description && <p className="mf-muted">{product.description}</p>}
          <p style={{ fontWeight: 600 }}>{product.inStock ? 'In stock' : 'Out of stock'}</p>
          <button
            type="button"
            className={buttonClass(settings.theme)}
            disabled={!product.inStock || mode === 'editor'}
            onClick={() =>
              actions.addToCart(
                { id: product.id, name: product.name, price: Number(product.price) },
                'PRODUCT'
              )
            }
          >
            Add to cart
          </button>
        </div>
      </div>
    </section>
  )
}

export function BookView() {
  const { data } = useSite()
  return (
    <section className="mf-section">
      <div className="mf-container">
        <h1 className="mf-section-title">Book an appointment</h1>
        <p className="mf-section-intro">Choose a service to see available times.</p>
        <div className="mf-grid mf-grid-3">
          {data.services.map((s) => (
            <ServiceCard key={s.id} service={s} showPrices showDuration />
          ))}
        </div>
      </div>
    </section>
  )
}

export function NotFoundView() {
  const { base, settings } = useSite()
  return (
    <section className="mf-section">
      <div className="mf-container mf-center" style={{ maxWidth: '36rem' }}>
        <p className="mf-eyebrow">404</p>
        <h1 className="mf-section-title">We couldn’t find that page</h1>
        <p className="mf-section-intro">It may have moved. Try the home page instead.</p>
        <a className={buttonClass(settings.theme)} href={withSiteBase(base, '/')}>
          Go to the home page
        </a>
      </div>
    </section>
  )
}
