import React from 'react'

type Props = {
  variant?: 'navy' | 'light' | 'mixed'
  className?: string
}

const PALETTES = {
  navy: ['rgba(13, 148, 136, 0.35)', 'rgba(94, 234, 212, 0.18)', 'rgba(30, 58, 95, 0.6)'],
  light: ['rgba(13, 148, 136, 0.12)', 'rgba(94, 234, 212, 0.10)', 'rgba(30, 58, 95, 0.06)'],
  mixed: ['rgba(13, 148, 136, 0.22)', 'rgba(94, 234, 212, 0.14)', 'rgba(30, 58, 95, 0.18)'],
} as const

/**
 * Static brand gradient — soft colour pools as a section background.
 * Plain radial gradients: no blur filter and no animation loop, so it costs
 * one paint instead of a GPU layer that repaints every frame.
 */
export function BrandGradient({ variant = 'navy', className = '' }: Props) {
  const [a, b, c] = PALETTES[variant]
  return (
    <div
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        backgroundImage: [
          `radial-gradient(ellipse 60% 55% at 10% 5%, ${a}, transparent 70%)`,
          `radial-gradient(ellipse 55% 50% at 95% 45%, ${b}, transparent 70%)`,
          `radial-gradient(ellipse 50% 45% at 50% 100%, ${c}, transparent 70%)`,
        ].join(', '),
      }}
      aria-hidden
    />
  )
}
