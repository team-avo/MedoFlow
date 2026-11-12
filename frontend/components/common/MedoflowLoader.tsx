'use client'

/**
 * MedoflowLoader: the one loader primitive used across the app.
 *
 * Design: a single stroke-drawn SVG that reads simultaneously as the
 * Medoflow "M" mark and as an EKG heartbeat, the line draws in from
 * the left, holds, then sweeps off to the right, and repeats.
 * On brand + clinically appropriate + much classier than a CSS spinner.
 *
 * Three use-sites:
 *   • <MedoflowLoader size="sm" />, inline inside buttons and fields.
 *   • <MedoflowLoader size="lg" />, card / section-level spinners.
 *   • <MedoflowFullScreen … />, page-level blocking load.
 *
 * The underlying stroke-draw animation lives in globals.css as
 * `mf-ekg-draw` so we don't ship a JS animation loop.
 */

import React from 'react'
import { cn } from '@/lib/utils'

type Size = 'sm' | 'md' | 'lg' | 'xl'
type Tone = 'brand' | 'light' | 'ink'

const DIMS: Record<Size, number> = { sm: 16, md: 24, lg: 40, xl: 72 }

const COLORS: Record<Tone, { solid: string; gradientId: string }> = {
  brand: { solid: '#0D9488', gradientId: 'mf-ekg-brand' },
  light: { solid: '#FFFFFF', gradientId: 'mf-ekg-light' },
  ink: { solid: '#1E3A5F', gradientId: 'mf-ekg-ink' },
}

// M-shaped EKG: baseline → small peak → valley → tall center peak →
// valley → small peak → baseline. Reads as an M and as a heartbeat.
const EKG_PATH = 'M3 22 L9 22 L12 11 L15 22 L20 5 L25 22 L28 11 L31 22 L37 22'

type LoaderProps = {
  size?: Size
  tone?: Tone
  className?: string
  /** Screen-reader label. Defaults to "Loading". */
  label?: string
}

export function MedoflowLoader({
  size = 'md',
  tone = 'brand',
  className,
  label = 'Loading',
}: LoaderProps) {
  const px = DIMS[size]
  const { solid, gradientId } = COLORS[tone]
  // Stroke scales with the mark so the sm inline loader isn't a heavy slab.
  const strokeWidth = size === 'sm' ? 2.5 : size === 'md' ? 2.25 : 2

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: px, height: px }}
    >
      <svg viewBox="0 0 40 40" width={px} height={px} fill="none" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={solid} stopOpacity={tone === 'brand' ? 0.85 : 1} />
            <stop offset="55%" stopColor={solid} />
            <stop offset="100%" stopColor={solid} stopOpacity={tone === 'brand' ? 0.85 : 1} />
          </linearGradient>
        </defs>

        {/* Barely-visible frame ring: grounds the mark so it doesn't
            float naked on empty canvas. Skipped on sm for cleanliness. */}
        {size !== 'sm' && (
          <circle cx="20" cy="20" r="18" stroke={solid} strokeOpacity={0.14} strokeWidth="1.25" />
        )}

        {/* EKG line: the star of the show */}
        <path
          d={EKG_PATH}
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={100}
          strokeDasharray="100 100"
          className="mf-ekg-draw"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}

// ─────────────────────────── Full-screen wrapper ─────────────────────

type FullScreenProps = {
  /** Display title: defaults to the wordmark. */
  title?: string
  /** Optional one-liner below the wordmark. */
  subtitle?: string
  /** When mounted on a navy-background page (auth redirect, etc.). */
  onNavy?: boolean
  className?: string
}

/**
 * Page-level blocking loader. Centers the mark, shows the wordmark,
 * and optionally an explanatory subtitle. Replaces the old
 * JumpingClinicalLoader and GlobalApiLoader page-level shells.
 */
export function MedoflowFullScreen({
  title = 'Medoflow',
  subtitle,
  onNavy = false,
  className,
}: FullScreenProps) {
  return (
    <div
      className={cn(
        'flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center',
        onNavy ? 'bg-navy text-white' : 'bg-canvas text-ink',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <MedoflowLoader size="xl" tone={onNavy ? 'light' : 'brand'} label={title} />
      <div>
        <p className={cn('mf-display text-[18px]', onNavy ? 'text-white' : 'text-navy')}>{title}</p>
        {subtitle && (
          <p className={cn('mt-1 text-[13px]', onNavy ? 'text-white/60' : 'text-ink-muted')}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}
