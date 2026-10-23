'use client'

/** Sections fed by the clinic's live data: services, team, pricing, products, locations. */
import { Clock, MapPin, Phone, ShoppingBag } from 'lucide-react'
import type { PublicProduct, PublicProvider, PublicService, Section } from '@/lib/site/types'
import { trySitePath, withSiteBase } from '@/lib/site/routes'
import { buttonClass } from '@/lib/site/theme'
import { useSite } from '../SiteContext'
import { SectionHeading, arr, bookingHref, bool, formatPrice, initials, num } from '../primitives'

function pick<T extends { id: string }>(all: T[], ids: string[], max: number): T[] {
  const chosen = ids.length
    ? ids.map((id) => all.find((x) => x.id === id)).filter((x): x is T => !!x)
    : all
  return chosen.slice(0, max)
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  const { mode } = useSite()
  if (mode !== 'editor') return null
  return (
    <p
      className="mf-muted mf-center"
      style={{ border: '1px dashed currentColor', borderRadius: 8, padding: '1.5rem' }}
    >
      {children}
    </p>
  )
}

export function ServiceCard({
  service,
  showPrices,
  showDuration,
}: {
  service: PublicService
  showPrices: boolean
  showDuration: boolean
}) {
  const { base, clinicId, settings } = useSite()
  const detail = service.slug ? trySitePath('service', { slug: service.slug }) : null
  return (
    <article
      className="mf-card mf-card-hover"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
    >
      {service.discipline && (
        <span className="mf-chip" style={{ alignSelf: 'flex-start' }}>
          {service.discipline}
        </span>
      )}
      <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
        {detail ? (
          <a href={withSiteBase(base, detail)} style={{ textDecoration: 'none' }}>
            {service.name}
          </a>
        ) : (
          service.name
        )}
      </h3>
      <div className="mf-muted" style={{ display: 'flex', gap: '1rem', fontSize: '0.9rem' }}>
        {showDuration && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Clock size={15} aria-hidden /> {service.durationMinutes} min
          </span>
        )}
        {showPrices && Number(service.price) > 0 && <span>{formatPrice(service.price)}</span>}
      </div>
      <div style={{ marginTop: 'auto', paddingTop: '0.5rem' }}>
        <a
          href={bookingHref(clinicId, service.id)}
          className={`${buttonClass(settings.theme)} mf-btn-sm`}
        >
          Book
        </a>
      </div>
    </article>
  )
}

export function ServiceGridSection({ section }: { section: Section }) {
  const { data, base, clinicId, settings } = useSite()
  const s = section.settings
  const services = pick(data.services, arr<string>(s.serviceIds), num(s.maxItems, 6))
  const showPrices = bool(s.showPrices, true)
  const showDuration = bool(s.showDuration, true)
  return (
    <section className="mf-section" id={section.id}>
      <div className="mf-container">
        <SectionHeading heading={s.heading} intro={s.intro} />
        {services.length === 0 && (
          <EmptyHint>Add services in Catalog → Services and they appear here.</EmptyHint>
        )}
        {section.variant === 'list' ? (
          <div className="mf-card" style={{ padding: 0 }}>
            {services.map((svc, i) => (
              <div
                key={svc.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  padding: '1.1rem 1.5rem',
                  borderTop: i
                    ? '1px solid color-mix(in srgb, var(--site-text) 8%, transparent)'
                    : undefined,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {svc.slug ? (
                      <a
                        href={withSiteBase(
                          base,
                          trySitePath('service', { slug: svc.slug }) ?? '/services'
                        )}
                        style={{ textDecoration: 'none' }}
                      >
                        {svc.name}
                      </a>
                    ) : (
                      svc.name
                    )}
                  </div>
                  <div className="mf-muted" style={{ fontSize: '0.875rem' }}>
                    {[svc.discipline, showDuration ? `${svc.durationMinutes} min` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {showPrices && Number(svc.price) > 0 && <strong>{formatPrice(svc.price)}</strong>}
                  <a
                    href={bookingHref(clinicId, svc.id)}
                    className={`${buttonClass(settings.theme)} mf-btn-sm`}
                  >
                    Book
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`mf-grid ${section.variant === 'featured' ? 'mf-grid-2' : 'mf-grid-3'}`}>
            {services.map((svc) => (
              <ServiceCard
                key={svc.id}
                service={svc}
                showPrices={showPrices}
                showDuration={showDuration}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export function ProviderCard({
  provider,
  showBio,
}: {
  provider: PublicProvider
  showBio: boolean
}) {
  const { base } = useSite()
  const href = provider.slug
    ? withSiteBase(base, trySitePath('provider', { slug: provider.slug }) ?? '/team')
    : null
  return (
    <article
      className="mf-card mf-card-hover"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div className="mf-avatar">
          {provider.headshotUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- provider headshot from the clinic's own storage
            <img
              src={provider.headshotUrl}
              alt=""
              className="mf-img"
              style={{ borderRadius: 999 }}
              loading="lazy"
            />
          ) : (
            <span aria-hidden>{initials(provider.name)}</span>
          )}
        </div>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
            {href ? (
              <a href={href} style={{ textDecoration: 'none' }}>
                {provider.name}
              </a>
            ) : (
              provider.name
            )}
          </h3>
          {provider.disciplines.length > 0 && (
            <div className="mf-muted" style={{ fontSize: '0.875rem' }}>
              {provider.disciplines.join(', ')}
            </div>
          )}
        </div>
      </div>
      {showBio && provider.bio && (
        <p className="mf-muted" style={{ margin: 0, fontSize: '0.95rem' }}>
          {provider.bio.length > 220 ? `${provider.bio.slice(0, 217)}…` : provider.bio}
        </p>
      )}
      {href && (
        <a href={href} className="mf-link" style={{ marginTop: 'auto', fontSize: '0.9rem' }}>
          View profile →
        </a>
      )}
    </article>
  )
}

export function ProviderBiosSection({ section }: { section: Section }) {
  const { data } = useSite()
  const s = section.settings
  const people = pick(data.providers, arr<string>(s.providerIds), num(s.maxItems, 6))
  const showBio = bool(s.showBio, true)
  return (
    <section className="mf-section mf-section-alt" id={section.id}>
      <div className="mf-container">
        <SectionHeading heading={s.heading} intro={s.intro} />
        {people.length === 0 && (
          <EmptyHint>Your clinicians appear here once they are added in Staff.</EmptyHint>
        )}
        {section.variant === 'carousel' ? (
          <div
            style={{
              display: 'grid',
              gridAutoFlow: 'column',
              gridAutoColumns: 'minmax(16rem, 1fr)',
              gap: '1.5rem',
              overflowX: 'auto',
              scrollSnapType: 'x mandatory',
              paddingBottom: '0.5rem',
            }}
          >
            {people.map((p) => (
              <div key={p.id} style={{ scrollSnapAlign: 'start' }}>
                <ProviderCard provider={p} showBio={showBio} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mf-grid mf-grid-3">
            {people.map((p) => (
              <ProviderCard key={p.id} provider={p} showBio={showBio} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export function PricingSection({ section }: { section: Section }) {
  const { data, actions, settings, mode } = useSite()
  const s = section.settings
  const max = num(s.maxItems, 6)
  const showPackages = section.variant !== 'memberships'
  const showMemberships = section.variant !== 'packages'
  const cards = [
    ...(showMemberships
      ? data.memberships.map((m) => ({
          id: m.id,
          type: 'MEMBERSHIP' as const,
          name: m.name,
          description: m.description,
          price: Number(m.monthlyPrice),
          priceLabel: `${formatPrice(m.monthlyPrice)}/${m.billingPeriod === 'YEARLY' ? 'yr' : 'mo'}`,
          detail:
            Number(m.serviceDiscountPercent) > 0
              ? `${m.serviceDiscountPercent}% off every visit`
              : null,
        }))
      : []),
    ...(showPackages
      ? data.packages.map((p) => ({
          id: p.id,
          type: 'PACKAGE' as const,
          name: p.name,
          description: p.description,
          price: Number(p.price),
          priceLabel: formatPrice(p.price),
          detail: p.totalSessions
            ? `${p.totalSessions} sessions${p.expiresInDays ? ` · valid ${p.expiresInDays} days` : ''}`
            : null,
        }))
      : []),
  ].slice(0, max)
  return (
    <section className="mf-section" id={section.id}>
      <div className="mf-container">
        <SectionHeading heading={s.heading} intro={s.intro} center />
        {cards.length === 0 && (
          <EmptyHint>Create packages or memberships under Commerce and they appear here.</EmptyHint>
        )}
        <div className="mf-grid mf-grid-3">
          {cards.map((c) => (
            <article
              key={c.id}
              className="mf-card"
              style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
            >
              <span className="mf-chip" style={{ alignSelf: 'flex-start' }}>
                {c.type === 'MEMBERSHIP' ? 'Membership' : 'Package'}
              </span>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>{c.name}</h3>
              <div
                className="mf-heading"
                style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--site-primary)' }}
              >
                {c.priceLabel}
              </div>
              {c.detail && <div style={{ fontWeight: 600 }}>{c.detail}</div>}
              {c.description && (
                <p className="mf-muted" style={{ margin: 0 }}>
                  {c.description}
                </p>
              )}
              <button
                type="button"
                className={buttonClass(settings.theme)}
                style={{ marginTop: 'auto' }}
                disabled={mode === 'editor'}
                onClick={() =>
                  actions.addToCart({ id: c.id, name: c.name, price: c.price }, c.type)
                }
              >
                Add to cart
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export function ProductCard({ product }: { product: PublicProduct }) {
  const { base, actions, settings, mode } = useSite()
  const href = product.slug
    ? withSiteBase(base, trySitePath('product', { slug: product.slug }) ?? '/store')
    : null
  return (
    <article
      className="mf-card mf-card-hover"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}
    >
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
        <ShoppingBag size={36} />
      </div>
      <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
        {href ? (
          <a href={href} style={{ textDecoration: 'none' }}>
            {product.name}
          </a>
        ) : (
          product.name
        )}
      </h3>
      {product.description && (
        <p className="mf-muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          {product.description.length > 120
            ? `${product.description.slice(0, 117)}…`
            : product.description}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 'auto',
          gap: '0.5rem',
        }}
      >
        <strong>{formatPrice(product.price)}</strong>
        <button
          type="button"
          className={`${buttonClass(settings.theme)} mf-btn-sm`}
          disabled={!product.inStock || mode === 'editor'}
          onClick={() =>
            actions.addToCart(
              { id: product.id, name: product.name, price: Number(product.price) },
              'PRODUCT'
            )
          }
        >
          {product.inStock ? 'Add to cart' : 'Out of stock'}
        </button>
      </div>
    </article>
  )
}

export function FeaturedProductsSection({ section }: { section: Section }) {
  const { data, base } = useSite()
  const s = section.settings
  const products = pick(data.products, arr<string>(s.productIds), num(s.maxItems, 4))
  return (
    <section className="mf-section mf-section-alt" id={section.id}>
      <div className="mf-container">
        <SectionHeading heading={s.heading} intro={s.intro} />
        {products.length === 0 && (
          <EmptyHint>Add products under Commerce → Storefront and they appear here.</EmptyHint>
        )}
        <div className={`mf-grid ${section.variant === 'row' ? 'mf-grid-4' : 'mf-grid-3'}`}>
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
        {products.length > 0 && (
          <p style={{ marginTop: '2rem' }}>
            <a className="mf-link" href={withSiteBase(base, '/store')}>
              Visit the store →
            </a>
          </p>
        )}
      </div>
    </section>
  )
}

export function LocationsHoursSection({ section }: { section: Section }) {
  const { data } = useSite()
  const s = section.settings
  const ids = arr<string>(s.locationIds)
  const locations = (
    ids.length ? data.locations.filter((l) => ids.includes(l.id)) : data.locations
  ).filter((l) => !l.isVirtual || ids.includes(l.id))
  const hours = arr<{ label: string; value: string }>(s.hours).filter((h) => h.label || h.value)
  const showMap = bool(s.showMapLink, true)
  const hoursBlock = hours.length > 0 && (
    <div className="mf-card">
      <h3
        style={{ marginTop: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <Clock size={18} aria-hidden /> Opening hours
      </h3>
      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '0.4rem 1.5rem',
        }}
      >
        {hours.map((h, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <dt className="mf-muted">{h.label}</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{h.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
  return (
    <section className="mf-section" id={section.id}>
      <div className="mf-container">
        <SectionHeading heading={s.heading} />
        <div className={section.variant === 'split' ? 'mf-split' : 'mf-grid mf-grid-3'}>
          {locations.map((l) => (
            <div key={l.id} className="mf-card">
              <h3 style={{ marginTop: 0, fontSize: '1.1rem' }}>{l.name}</h3>
              {l.addressLines.length > 0 && (
                <p style={{ margin: '0 0 0.5rem', display: 'flex', gap: 6 }}>
                  <MapPin size={18} aria-hidden style={{ flexShrink: 0, marginTop: 3 }} />
                  <span>
                    {l.addressLines.map((line, i) => (
                      <span key={i} style={{ display: 'block' }}>
                        {line}
                      </span>
                    ))}
                  </span>
                </p>
              )}
              {l.phone && (
                <p style={{ margin: '0 0 0.5rem', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Phone size={16} aria-hidden />{' '}
                  <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`}>{l.phone}</a>
                </p>
              )}
              {showMap && l.addressLines.length > 0 && (
                <a
                  className="mf-link"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.addressLines.join(', '))}`}
                >
                  Get directions →
                </a>
              )}
            </div>
          ))}
          {hoursBlock}
        </div>
        {locations.length === 0 && !hoursBlock && (
          <EmptyHint>Add your locations in Settings → Locations.</EmptyHint>
        )}
      </div>
    </section>
  )
}
