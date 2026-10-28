'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

type SkeletonVariant = 'card' | 'stat' | 'row' | 'table' | 'avatar' | 'page' | 'text' | 'button'

export interface LoadingSkeletonProps {
  variant?: SkeletonVariant
  count?: number
  className?: string
}

/**
 * Unified skeleton loader — replaces scattered `animate-spin` divs.
 * Use `variant` to match the shape of what you're loading.
 */
export function LoadingSkeleton({ variant = 'card', count = 1, className }: LoadingSkeletonProps) {
  const items = Array.from({ length: count })

  if (variant === 'text') {
    return (
      <div className={cn('space-y-2', className)}>
        {items.map((_, i) => (
          <div
            key={i}
            className="h-3 rounded bg-slate-200/70 animate-pulse"
            style={{ width: `${85 - ((i * 13) % 40)}%` }}
          />
        ))}
      </div>
    )
  }

  if (variant === 'avatar') {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        {items.map((_, i) => (
          <div key={i} className="h-10 w-10 rounded-full bg-slate-200/70 animate-pulse" />
        ))}
      </div>
    )
  }

  if (variant === 'stat') {
    return (
      <div
        className={cn(
          'grid gap-4',
          count === 1
            ? 'grid-cols-1'
            : count === 2
              ? 'grid-cols-1 sm:grid-cols-2'
              : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
          className
        )}
      >
        {items.map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 rounded bg-slate-200/70 animate-pulse" />
              <div className="h-8 w-8 rounded-xl bg-slate-200/70 animate-pulse" />
            </div>
            <div className="h-7 w-20 rounded bg-slate-200/80 animate-pulse" />
            <div className="h-3 w-32 rounded bg-slate-200/60 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'row') {
    return (
      <div className={cn('space-y-2', className)}>
        {items.map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-xl border border-slate-100 bg-white p-4"
          >
            <div className="h-10 w-10 rounded-full bg-slate-200/70 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 rounded bg-slate-200/70 animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-slate-200/60 animate-pulse" />
            </div>
            <div className="h-6 w-20 rounded-full bg-slate-200/60 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'table') {
    return (
      <div
        className={cn('rounded-2xl border border-slate-100 bg-white overflow-hidden', className)}
      >
        <div className="border-b border-slate-100 px-6 py-3 bg-slate-50">
          <div className="grid grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-3 rounded bg-slate-200/70 animate-pulse" />
            ))}
          </div>
        </div>
        <div>
          {Array.from({ length: count > 1 ? count : 6 }).map((_, i) => (
            <div key={i} className="border-b border-slate-100 px-6 py-4 last:border-b-0">
              <div className="grid grid-cols-5 gap-4 items-center">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div
                    key={j}
                    className="h-4 rounded bg-slate-200/60 animate-pulse"
                    style={{ width: `${70 - ((j * 7) % 25)}%` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (variant === 'button') {
    return <div className={cn('h-10 w-28 rounded-full bg-slate-200/70 animate-pulse', className)} />
  }

  if (variant === 'page') {
    return (
      <div className={cn('space-y-6', className)}>
        <div className="space-y-2">
          <div className="h-7 w-2/3 max-w-64 rounded bg-slate-200/80 animate-pulse" />
          <div className="h-4 w-full max-w-96 rounded bg-slate-200/60 animate-pulse" />
        </div>
        <LoadingSkeleton variant="stat" count={4} />
        <LoadingSkeleton variant="table" />
      </div>
    )
  }

  // card (default)
  return (
    <div className={cn('grid gap-4', count > 1 ? 'grid-cols-1 sm:grid-cols-2' : '', className)}>
      {items.map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm space-y-3"
        >
          <div className="h-5 w-40 rounded bg-slate-200/80 animate-pulse" />
          <div className="h-3 w-full rounded bg-slate-200/60 animate-pulse" />
          <div className="h-3 w-5/6 rounded bg-slate-200/60 animate-pulse" />
          <div className="h-3 w-3/4 rounded bg-slate-200/60 animate-pulse" />
        </div>
      ))}
    </div>
  )
}
