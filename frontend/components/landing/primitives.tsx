'use client'

/**
 * Shared primitives for the marketing landing page.
 *
 * One-trick-ponies live here so each section file can focus on layout and
 * storytelling. Keep this file short — if a primitive grows past ~50 lines,
 * split it into its own file.
 */

import React from 'react'

// ─────────────────────────── Typography ───────────────────────────────

type EyebrowProps = {
  children: React.ReactNode
  muted?: boolean
  className?: string
  as?: 'p' | 'span' | 'div'
}

/** Small uppercase tracked label. Teal by default; use `muted` in-card. */
export function Eyebrow({ children, muted, className = '', as: Tag = 'p' }: EyebrowProps) {
  return (
    <Tag className={`mf-eyebrow ${muted ? 'text-ink-muted' : ''} ${className}`.trim()}>
      {children}
    </Tag>
  )
}

type SectionHeaderProps = {
  eyebrow?: string
  title: React.ReactNode
  description?: React.ReactNode
  align?: 'left' | 'center'
  onNavy?: boolean
  className?: string
}

/** Consistent chapter opener: eyebrow → headline → short description. */
export function SectionHeader({
  eyebrow,
  title,
  description,
  align = 'center',
  onNavy = false,
  className = '',
}: SectionHeaderProps) {
  const alignCls = align === 'center' ? 'text-center mx-auto' : 'text-left'
  const titleColor = onNavy ? 'text-white' : 'text-navy'
  const descColor = onNavy ? 'text-white/70' : 'text-ink-muted'

  return (
    <div className={`max-w-3xl ${alignCls} ${className}`.trim()}>
      {eyebrow && (
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
        </div>
      )}
      <h2 className={`mf-display mt-4 text-[32px] sm:text-[38px] md:text-[48px] ${titleColor}`}>
        {title}
      </h2>
      {description && (
        <p
          className={`mt-5 text-[16px] leading-relaxed md:text-[17px] ${descColor} ${
            align === 'center' ? 'mx-auto max-w-2xl' : 'max-w-xl'
          }`}
        >
          {description}
        </p>
      )}
    </div>
  )
}

// ─────────────────────────── Status chip ──────────────────────────────

type StatusChipProps = {
  tone?: 'ok' | 'warn' | 'err'
  children: React.ReactNode
  onNavy?: boolean
}

/** Dot + label row. 6px dot, no wash background — matches design system. */
export function StatusChip({ tone = 'ok', children, onNavy }: StatusChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] ${
        onNavy ? 'text-white/70' : 'text-ink-muted'
      }`}
    >
      <span className={`mf-dot mf-dot--${tone}`} />
      {children}
    </span>
  )
}

// ─────────────────────────── Stat block ───────────────────────────────

type StatProps = {
  value: string
  label: string
  size?: 'sm' | 'md' | 'lg'
  onNavy?: boolean
}

/** Big number + small label. Reuses DM Sans display type. */
export function Stat({ value, label, size = 'md', onNavy }: StatProps) {
  const sizeCls =
    size === 'lg' ? 'text-[40px] md:text-[48px]' : size === 'sm' ? 'text-[18px]' : 'text-[28px]'
  return (
    <div>
      <p className={`mf-display ${sizeCls} ${onNavy ? 'text-white' : 'text-navy'}`}>{value}</p>
      <p className={`mt-1 text-[12.5px] ${onNavy ? 'text-white/60' : 'text-ink-muted'}`}>{label}</p>
    </div>
  )
}
