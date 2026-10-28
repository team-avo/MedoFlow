'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useTour } from '@/contexts/TourContext'
import type { TourStep } from './tours'
import { cn } from '@/lib/utils'

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const PADDING = 8
const CARD_MAX_WIDTH = 360
const CARD_GAP = 14

function getAnchorRect(anchor: string | null): Rect | null {
  if (!anchor) return null
  if (typeof document === 'undefined') return null
  const el = document.querySelector(`[data-tour-id="${anchor}"]`) as HTMLElement | null
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function cardPosition(
  rect: Rect | null,
  placement: NonNullable<TourStep['placement']>,
  viewport: { w: number; h: number }
): { top: number; left: number; transform?: string } {
  if (!rect || placement === 'center') {
    return {
      top: viewport.h / 2,
      left: viewport.w / 2,
      transform: 'translate(-50%, -50%)',
    }
  }

  switch (placement) {
    case 'right': {
      const top = Math.max(16, rect.top + rect.height / 2)
      return { top, left: rect.left + rect.width + CARD_GAP, transform: 'translateY(-50%)' }
    }
    case 'left': {
      const top = Math.max(16, rect.top + rect.height / 2)
      return {
        top,
        left: Math.max(16, rect.left - CARD_GAP),
        transform: 'translate(-100%, -50%)',
      }
    }
    case 'bottom': {
      const left = Math.max(16, rect.left + rect.width / 2)
      return { top: rect.top + rect.height + CARD_GAP, left, transform: 'translateX(-50%)' }
    }
    case 'top': {
      const left = Math.max(16, rect.left + rect.width / 2)
      return { top: Math.max(16, rect.top - CARD_GAP), left, transform: 'translate(-50%, -100%)' }
    }
  }
}

export function TourOverlay() {
  const router = useRouter()
  const { isActive, currentStep, stepIndex, script, next, prev, skip, finish } = useTour()
  const [rect, setRect] = React.useState<Rect | null>(null)
  const [viewport, setViewport] = React.useState({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  })

  // Recompute anchor rect on step change + window resize
  React.useEffect(() => {
    if (!isActive || !currentStep) return

    const update = () => {
      setRect(getAnchorRect(currentStep.anchor))
      setViewport({ w: window.innerWidth, h: window.innerHeight })
    }

    update()
    // Brief delay in case the anchor is about to be rendered (route change)
    const t = setTimeout(update, 150)
    const onResize = () => update()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [isActive, currentStep])

  // Keyboard controls
  React.useEffect(() => {
    if (!isActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        void skip()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isActive, next, prev, skip])

  if (!isActive || !currentStep || !script) return null

  const placement = currentStep.placement ?? 'right'
  const pos = cardPosition(rect, placement, viewport)
  const isCentered = placement === 'center' || !rect
  const isLast = stepIndex === script.steps.length - 1
  const isFirst = stepIndex === 0

  const handleNext = () => {
    if (isLast) {
      void finish()
    } else {
      if (currentStep.routeTo) {
        router.push(currentStep.routeTo)
      }
      next()
    }
  }

  // Spotlight clip-path — rect with padding
  const spotlightStyle: React.CSSProperties = rect
    ? {
        clipPath: `polygon(
          0 0, 100% 0, 100% 100%, 0 100%,
          0 ${rect.top - PADDING}px,
          ${rect.left - PADDING}px ${rect.top - PADDING}px,
          ${rect.left - PADDING}px ${rect.top + rect.height + PADDING}px,
          ${rect.left + rect.width + PADDING}px ${rect.top + rect.height + PADDING}px,
          ${rect.left + rect.width + PADDING}px ${rect.top - PADDING}px,
          0 ${rect.top - PADDING}px
        )`,
      }
    : {}

  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-slate-900/60 animate-in fade-in-0 duration-150"
        style={spotlightStyle}
        aria-hidden
      />

      {rect && (
        <div
          className="pointer-events-none fixed z-[101] rounded-2xl ring-2 ring-white ring-offset-2 ring-offset-indigo-500"
          style={{
            top: rect.top - PADDING,
            left: rect.left - PADDING,
            width: rect.width + PADDING * 2,
            height: rect.height + PADDING * 2,
          }}
          aria-hidden
        />
      )}

      <div
        role="dialog"
        aria-modal="false"
        aria-label={currentStep.title}
        className={cn(
          'fixed z-[102] w-[calc(100vw-2rem)] rounded-2xl border border-slate-100 bg-white p-5 shadow-lg',
          isCentered ? 'max-w-lg' : ''
        )}
        style={{
          top: pos.top,
          left: pos.left,
          transform: pos.transform,
          maxWidth: isCentered ? undefined : CARD_MAX_WIDTH,
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
              Step {stepIndex + 1} of {script.steps.length}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">{currentStep.title}</h3>
          </div>
          <button
            type="button"
            onClick={() => void skip()}
            className="-mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Skip tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{currentStep.body}</p>

        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => void skip()}
            className="text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={isFirst}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              {isLast ? 'Finish' : 'Next'}
              {!isLast && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
