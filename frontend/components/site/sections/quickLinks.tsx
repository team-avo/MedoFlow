'use client'

/**
 * The homepage menu (WS3): the clinic's quick links from settings.homeMenu
 * (edited under Menus → Homepage), as pills or tiles. Links that lead
 * nowhere right now: e.g. Products while the clinic sells nothing, are
 * left out on the live site.
 */
import { ArrowRight } from 'lucide-react'
import type { Section } from '@/lib/site/types'
import { useSite } from '../SiteContext'
import { SectionHeading, SiteLinkAnchor } from '../primitives'
import { EmptyHint } from './clinic'

export function QuickLinksSection({ section }: { section: Section }) {
  const { settings, mode } = useSite()
  const s = section.settings
  const all = settings.homeMenu?.items ?? []
  const items = mode === 'editor' ? all : all.filter((i) => i.link && i.link.href !== null)
  if (items.length === 0 && mode !== 'editor') return null
  const tiles = section.variant === 'tiles'
  return (
    <section className="mf-section" id={section.id} data-section="quick-links">
      <div className="mf-container">
        <SectionHeading heading={s.heading} intro={s.intro} />
        {items.length === 0 && (
          <EmptyHint>Add links under Menus → Homepage and they appear here.</EmptyHint>
        )}
        <nav aria-label={typeof s.heading === 'string' && s.heading ? s.heading : 'Quick links'}>
          <ul
            className={tiles ? 'mf-grid mf-grid-4' : undefined}
            style={
              tiles
                ? { listStyle: 'none', margin: 0, padding: 0 }
                : {
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    gap: '0.75rem',
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                  }
            }
          >
            {items.map((item, i) => (
              <li key={i}>
                <SiteLinkAnchor
                  link={item.link}
                  className={tiles ? 'mf-card mf-quick-tile' : 'mf-btn mf-btn-outline mf-btn-sm'}
                  style={
                    tiles
                      ? {
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.75rem',
                          padding: '1.25rem 1.5rem',
                          fontWeight: 600,
                          textDecoration: 'none',
                          color: 'var(--site-text)',
                        }
                      : undefined
                  }
                >
                  <span>{item.label}</span>
                  {tiles && <ArrowRight size={18} aria-hidden />}
                </SiteLinkAnchor>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </section>
  )
}
