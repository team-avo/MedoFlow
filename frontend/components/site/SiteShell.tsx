'use client'

/** Announcement bar, header (3 variants), footer (2 variants) of a clinic site. */
import React from 'react'
import { ChevronDown, Menu, ShoppingBag, UserRound, X } from 'lucide-react'
import type { NavItem } from '@/lib/site/types'
import { withSiteBase } from '@/lib/site/routes'
import { useSite } from './SiteContext'
import { CtaButton, SiteImage, SiteLinkAnchor } from './primitives'

function Brand() {
  const { settings, clinicName, base, legacyLogoUrl } = useSite()
  const logo = settings.brand.logo ?? (legacyLogoUrl ? { src: legacyLogoUrl, alt: '' } : null)
  const name = settings.brand.displayName || clinicName
  return (
    <a
      href={withSiteBase(base, '/')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.6rem',
        textDecoration: 'none',
      }}
      aria-label={`${name} home`}
    >
      {logo?.url || logo?.src ? (
        <span style={{ height: '2.5rem', maxWidth: '10rem', display: 'inline-flex' }}>
          <SiteImage image={logo} className="" fallbackAlt={name} eager />
        </span>
      ) : null}
      <span className="mf-heading" style={{ fontWeight: 800, fontSize: '1.2rem' }}>
        {name}
      </span>
    </a>
  )
}

/**
 * Menu items that lead somewhere right now. A link resolves to no address
 * when its target is gone (e.g. Products while the clinic sells nothing):
 * the live site leaves it out; the builder canvas keeps it so it can be edited.
 */
export function visibleNavItems(items: NavItem[], mode: string): NavItem[] {
  if (mode === 'editor') return items
  const live = (i: NavItem) => i.link?.href !== null
  return items
    .map((i) => (i.children ? { ...i, children: i.children.filter(live) } : i))
    .filter((i) => live(i) || (i.children?.length ?? 0) > 0)
}

/** A header item with sub-items: hover / click opens it, Esc and outside clicks close it. */
function NavDropdown({
  item,
  vertical,
  onNavigate,
}: {
  item: NavItem
  vertical: boolean
  onNavigate?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLLIElement>(null)
  const id = React.useId()
  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <li
      ref={ref}
      style={{ position: 'relative' }}
      onMouseEnter={vertical ? undefined : () => setOpen(true)}
      onMouseLeave={vertical ? undefined : () => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        className="mf-nav-link"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'none',
          border: 0,
          padding: 0,
          font: 'inherit',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
        }}
      >
        {item.label}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <ul
          id={id}
          className={vertical ? undefined : 'mf-card'}
          style={{
            listStyle: 'none',
            margin: 0,
            padding: vertical ? '0.25rem 0 0 1rem' : '0.5rem',
            display: 'grid',
            gap: '0.25rem',
            ...(vertical
              ? {}
              : {
                  position: 'absolute',
                  top: '100%',
                  left: '-0.75rem',
                  minWidth: '12rem',
                  zIndex: 40,
                  background: 'var(--site-background)',
                  boxShadow: '0 12px 30px -12px rgba(15, 23, 42, 0.25)',
                }),
          }}
        >
          {item.link?.href !== null && item.link && (
            <li>
              <SiteLinkAnchor link={item.link} className="mf-nav-link" onClick={onNavigate}>
                {item.label}
              </SiteLinkAnchor>
            </li>
          )}
          {item.children!.map((c, j) => (
            <li key={j}>
              <SiteLinkAnchor link={c.link} className="mf-nav-link" onClick={onNavigate}>
                {c.label}
              </SiteLinkAnchor>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function NavLinks({
  links,
  vertical = false,
  onNavigate,
}: {
  links: NavItem[]
  vertical?: boolean
  onNavigate?: () => void
}) {
  const { mode } = useSite()
  const items = visibleNavItems(links, mode)
  return (
    <nav aria-label="Main">
      <ul
        style={{
          display: 'flex',
          flexDirection: vertical ? 'column' : 'row',
          gap: vertical ? '0.25rem' : '1.5rem',
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {items.map((l, i) =>
          l.children?.length ? (
            <NavDropdown key={i} item={l} vertical={vertical} onNavigate={onNavigate} />
          ) : (
            <li key={i}>
              <SiteLinkAnchor link={l.link} className="mf-nav-link" onClick={onNavigate}>
                {l.label}
              </SiteLinkAnchor>
            </li>
          )
        )}
      </ul>
    </nav>
  )
}

function HeaderActions() {
  const { hasStore, actions, settings } = useSite()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
      {hasStore && (
        <button
          type="button"
          className="mf-icon-btn"
          onClick={actions.openCart}
          aria-label={`Open cart${actions.cartCount ? ` — ${actions.cartCount} item${actions.cartCount === 1 ? '' : 's'}` : ''}`}
        >
          <ShoppingBag size={20} aria-hidden />
          {actions.cartCount > 0 && <span className="mf-badge">{actions.cartCount}</span>}
        </button>
      )}
      {actions.signedIn ? (
        <a className="mf-icon-btn" href="/account" aria-label="My account">
          <UserRound size={20} aria-hidden />
        </a>
      ) : (
        <button
          type="button"
          className="mf-icon-btn"
          onClick={actions.openLogin}
          aria-label="Sign in"
        >
          <UserRound size={20} aria-hidden />
        </button>
      )}
      <span className="mf-header-cta" style={{ marginLeft: '0.5rem' }}>
        <CtaButton cta={settings.header.cta} className="mf-btn-sm" />
      </span>
    </div>
  )
}

export function SiteHeader() {
  const { settings } = useSite()
  const h = settings.header
  const [open, setOpen] = React.useState(false)
  const menuButton = (
    <button
      type="button"
      className="mf-icon-btn mf-menu-btn"
      aria-expanded={open}
      aria-controls="mf-mobile-nav"
      onClick={() => setOpen((o) => !o)}
      aria-label={open ? 'Close menu' : 'Open menu'}
    >
      {open ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
    </button>
  )
  return (
    <>
      {settings.announcement.enabled && settings.announcement.text && (
        <div className="mf-announcement">
          {settings.announcement.link ? (
            <SiteLinkAnchor link={settings.announcement.link}>
              {settings.announcement.text}
            </SiteLinkAnchor>
          ) : (
            settings.announcement.text
          )}
        </div>
      )}
      <header className={`mf-header ${h.sticky ? 'mf-header-sticky' : ''}`}>
        <div
          className="mf-container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            minHeight: '4.5rem',
            flexWrap: h.variant === 'centered' ? 'wrap' : 'nowrap',
          }}
        >
          {h.variant === 'centered' ? (
            <>
              <div style={{ flex: 1 }} className="mf-desktop-only" />
              <Brand />
              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                <HeaderActions />
              </div>
              <div
                className="mf-desktop-only"
                style={{
                  flexBasis: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                  paddingBottom: '0.75rem',
                }}
              >
                <NavLinks links={h.links} />
              </div>
              {menuButton}
            </>
          ) : (
            <>
              <Brand />
              {h.variant === 'classic' && (
                <div className="mf-desktop-only">
                  <NavLinks links={h.links} />
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <HeaderActions />
                {menuButton}
              </div>
            </>
          )}
        </div>
        {open && (
          <div id="mf-mobile-nav" className="mf-container" style={{ paddingBottom: '1rem' }}>
            <NavLinks links={h.links} vertical onNavigate={() => setOpen(false)} />
          </div>
        )}
      </header>
      <style>{`
        .mf-menu-btn { display: inline-grid; }
        @container site (min-width: 900px) {
          ${h.variant === 'minimal' ? '' : '.mf-menu-btn { display: none; }'}
        }
        .mf-desktop-only { display: none; }
        @container site (min-width: 900px) { .mf-desktop-only { display: block; } }
        @container site (max-width: 640px) { .mf-header-cta { display: none; } }
      `}</style>
    </>
  )
}

const SOCIAL_LABEL: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
}

export function SiteFooter({ showBadge }: { showBadge: boolean }) {
  const { settings, clinicName, mode } = useSite()
  const f = settings.footer
  const name = settings.brand.displayName || clinicName
  const social = Object.entries(settings.social).filter(([, v]) => typeof v === 'string' && v)
  return (
    <footer className="mf-footer">
      <div className="mf-container">
        <div
          style={{
            display: 'grid',
            gap: '2rem',
            gridTemplateColumns:
              f.variant === 'columns' ? 'repeat(auto-fit, minmax(12rem, 1fr))' : '1fr',
          }}
        >
          <div>
            <div
              className="mf-heading"
              style={{ fontWeight: 800, fontSize: '1.2rem', marginBottom: '0.5rem' }}
            >
              {name}
            </div>
            {f.text && <p style={{ opacity: 0.85, maxWidth: '26rem', margin: 0 }}>{f.text}</p>}
            {social.length > 0 && (
              <ul
                style={{
                  display: 'flex',
                  gap: '1rem',
                  listStyle: 'none',
                  padding: 0,
                  margin: '1rem 0 0',
                  flexWrap: 'wrap',
                }}
              >
                {social.map(([k, v]) => (
                  <li key={k}>
                    <a href={v} target="_blank" rel="noopener noreferrer">
                      {SOCIAL_LABEL[k] ?? k}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {f.variant === 'columns' &&
            f.columns.map((col, i) => (
              <div key={i}>
                {col.title && (
                  <div className="mf-heading" style={{ fontWeight: 700, marginBottom: '0.75rem' }}>
                    {col.title}
                  </div>
                )}
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'grid',
                    gap: '0.45rem',
                  }}
                >
                  {visibleNavItems(col.links, mode).map((l, j) => (
                    <li key={j}>
                      <SiteLinkAnchor link={l.link}>{l.label}</SiteLinkAnchor>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
        <div
          style={{
            marginTop: '2.5rem',
            paddingTop: '1.25rem',
            borderTop: '1px solid rgba(255,255,255,0.18)',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: '0.75rem',
            fontSize: '0.825rem',
            opacity: 0.8,
          }}
        >
          <span>
            © {new Date().getFullYear()} {name}
          </span>
          {showBadge && (
            <a href="https://medoflow.com" target="_blank" rel="noopener noreferrer">
              Powered by MedoFlow
            </a>
          )}
        </div>
      </div>
    </footer>
  )
}
