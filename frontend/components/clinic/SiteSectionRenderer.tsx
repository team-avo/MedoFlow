'use client'

/**
 * Renders a single typed section. Kept dumb on purpose — every section
 * reads the clinic's themeColor and its own `settings`, no internal data
 * fetching. Service-grid and provider-bios receive their items from the
 * parent so the same component works in both the editor preview and the
 * live public page.
 */

import * as React from 'react'
import { ArrowRight } from 'lucide-react'
import type { Section } from '@/lib/siteSections'

export interface RenderContext {
  themeColor: string
  services?: Array<{
    id: string
    name: string
    description?: string | null
    duration?: number
    price?: number | string
  }>
  providers?: Array<{
    id: string
    firstName: string
    lastName: string
    bio?: string | null
    headshotUrl?: string | null
    discipline?: { name: string } | null
  }>
}

export function SiteSectionRenderer({ section, ctx }: { section: Section; ctx: RenderContext }) {
  switch (section.type) {
    case 'hero':
      return <HeroSection settings={section.settings} ctx={ctx} />
    case 'service-grid':
      return <ServiceGridSection settings={section.settings} ctx={ctx} />
    case 'provider-bios':
      return <ProviderBiosSection settings={section.settings} ctx={ctx} />
    case 'testimonials':
      return <TestimonialsSection settings={section.settings} ctx={ctx} />
    case 'faq':
      return <FaqSection settings={section.settings} ctx={ctx} />
    case 'booking-cta':
      return <BookingCtaSection settings={section.settings} ctx={ctx} />
    case 'rich-text':
      return <RichTextSection settings={section.settings} ctx={ctx} />
    default:
      return (
        <div className="border-y border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-800">
          Unknown section type: <code>{section.type}</code>
        </div>
      )
  }
}

export function SiteSectionList({ sections, ctx }: { sections: Section[]; ctx: RenderContext }) {
  return (
    <>
      {sections.map((s, i) => (
        <SiteSectionRenderer key={s.id ?? i} section={s} ctx={ctx} />
      ))}
    </>
  )
}

function s(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return fallback
}

function num(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function strList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '')).filter(Boolean)
  return []
}

function HeroSection({ settings, ctx }: { settings: Record<string, unknown>; ctx: RenderContext }) {
  const bg = s(settings['backgroundImage'])
  return (
    <section
      className="relative overflow-hidden"
      style={{
        background: bg
          ? `linear-gradient(rgba(15,23,42,0.55), rgba(15,23,42,0.55)), url(${bg}) center/cover`
          : `linear-gradient(135deg, ${ctx.themeColor}22 0%, ${ctx.themeColor}05 70%)`,
      }}
    >
      <div className="mx-auto max-w-6xl px-4 py-20 lg:px-8 lg:py-28">
        <p
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: bg ? '#fff' : ctx.themeColor }}
        >
          {s(settings['eyebrow'], 'Welcome')}
        </p>
        <h1
          className={`mt-3 text-3xl font-bold tracking-tight md:text-5xl ${
            bg ? 'text-white' : 'text-slate-900'
          }`}
        >
          {s(settings['headline'], 'Care that fits your life.')}
        </h1>
        <p
          className={`mt-4 max-w-2xl text-base leading-relaxed md:text-lg ${
            bg ? 'text-white/90' : 'text-slate-600'
          }`}
        >
          {s(settings['subheadline'])}
        </p>
        <div className="mt-7">
          <a
            href={s(settings['ctaHref'], '#')}
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-white shadow-md transition-opacity hover:opacity-90"
            style={{ backgroundColor: ctx.themeColor }}
          >
            {s(settings['ctaLabel'], 'Book a visit')}
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  )
}

function ServiceGridSection({
  settings,
  ctx,
}: {
  settings: Record<string, unknown>
  ctx: RenderContext
}) {
  const items = (ctx.services ?? []).slice(0, num(settings['maxItems'], 6))
  return (
    <section id="services" className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 lg:px-8 lg:py-20">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
          {s(settings['title'], 'What we offer')}
        </h2>
        {s(settings['intro']) && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 md:text-base">
            {s(settings['intro'])}
          </p>
        )}
        {items.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-dashed border-slate-200 px-6 py-10 text-center text-sm text-slate-400">
            Add services in the dashboard to populate this grid.
          </p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((svc) => (
              <div
                key={svc.id}
                className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
              >
                <p className="text-sm font-bold text-slate-900">{svc.name}</p>
                {svc.description && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{svc.description}</p>
                )}
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  {svc.duration ? <span>{svc.duration} min</span> : <span />}
                  {svc.price !== undefined && (
                    <span className="font-bold" style={{ color: ctx.themeColor }}>
                      ${typeof svc.price === 'number' ? svc.price.toFixed(2) : svc.price}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ProviderBiosSection({
  settings,
  ctx,
}: {
  settings: Record<string, unknown>
  ctx: RenderContext
}) {
  const items = (ctx.providers ?? []).slice(0, num(settings['maxItems'], 6))
  return (
    <section className="bg-slate-50/60">
      <div className="mx-auto max-w-6xl px-4 py-16 lg:px-8 lg:py-20">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
          {s(settings['title'], 'Meet the team')}
        </h2>
        {s(settings['intro']) && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 md:text-base">
            {s(settings['intro'])}
          </p>
        )}
        {items.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400">
            Add providers in the dashboard to populate this section.
          </p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <div
                key={p.id}
                className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm"
              >
                {p.headshotUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- clinic-uploaded URL on an arbitrary host; next/image optimisation is not configured for the Workers build
                  <img
                    src={p.headshotUrl}
                    alt={`${p.firstName} ${p.lastName}`}
                    className="h-44 w-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-44 items-center justify-center text-2xl font-black text-white"
                    style={{ backgroundColor: ctx.themeColor }}
                  >
                    {p.firstName[0]}
                    {p.lastName[0]}
                  </div>
                )}
                <div className="p-5">
                  <p className="text-sm font-bold text-slate-900">
                    Dr. {p.firstName} {p.lastName}
                  </p>
                  {p.discipline?.name && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {p.discipline.name}
                    </p>
                  )}
                  {p.bio && <p className="mt-2 text-xs leading-relaxed text-slate-600">{p.bio}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function TestimonialsSection({
  settings,
  ctx,
}: {
  settings: Record<string, unknown>
  ctx: RenderContext
}) {
  const quotes = strList(settings['quotes'])
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 lg:px-8 lg:py-20">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
          {s(settings['title'], 'What patients say')}
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quotes.map((q, i) => (
            <blockquote
              key={i}
              className="rounded-2xl border border-slate-100 bg-slate-50/60 p-6 text-sm leading-relaxed text-slate-700"
              style={{ borderLeft: `3px solid ${ctx.themeColor}` }}
            >
              {q}
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  )
}

function FaqSection({ settings, ctx }: { settings: Record<string, unknown>; ctx: RenderContext }) {
  const items = strList(settings['items']).map((line) => {
    const [q, ...rest] = line.split('|')
    return { q: q?.trim() ?? '', a: rest.join('|').trim() }
  })
  return (
    <section className="bg-slate-50/60">
      <div className="mx-auto max-w-3xl px-4 py-16 lg:px-8 lg:py-20">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
          {s(settings['title'], 'Frequently asked')}
        </h2>
        <dl className="mt-8 space-y-3">
          {items.map((it, i) => (
            <details
              key={i}
              className="group rounded-2xl border border-slate-100 bg-white p-5 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between text-sm font-bold text-slate-900">
                {it.q}
                <span
                  className="ml-2 text-xl group-open:rotate-45"
                  style={{ color: ctx.themeColor }}
                >
                  +
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{it.a}</p>
            </details>
          ))}
        </dl>
      </div>
    </section>
  )
}

function BookingCtaSection({
  settings,
  ctx,
}: {
  settings: Record<string, unknown>
  ctx: RenderContext
}) {
  return (
    <section style={{ backgroundColor: ctx.themeColor }}>
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-14 text-white lg:flex-row lg:items-center lg:px-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
            {s(settings['headline'], 'Ready when you are.')}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/85 md:text-base">
            {s(settings['subheadline'])}
          </p>
        </div>
        <a
          href={s(settings['ctaHref'], '#services')}
          className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold shadow-md transition-opacity hover:opacity-90"
          style={{ color: ctx.themeColor }}
        >
          {s(settings['ctaLabel'], 'Find an appointment')}
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </section>
  )
}

function RichTextSection({ settings }: { settings: Record<string, unknown>; ctx: RenderContext }) {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-3xl px-4 py-12 lg:px-8 lg:py-16">
        {s(settings['title']) && (
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
            {s(settings['title'])}
          </h2>
        )}
        <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-slate-700">
          {s(settings['body'])}
        </p>
      </div>
    </section>
  )
}
