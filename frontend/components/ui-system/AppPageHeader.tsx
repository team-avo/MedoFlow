'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface AppPageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}

export function AppPageHeader({ title, description, actions, className }: AppPageHeaderProps) {
  return (
    <div
      className={cn(
        // Row layout only from lg: below that the 264px sidebar leaves too
        // little width for a title and an action group side by side.
        'flex flex-col gap-4 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-center lg:justify-between lg:gap-6',
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <h1 className="break-words text-2xl font-semibold tracking-tight text-[#111827]">
          {title}
        </h1>
        {description && <p className="mt-2 text-sm text-[#64748B]">{description}</p>}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">{actions}</div>
      )}
    </div>
  )
}
