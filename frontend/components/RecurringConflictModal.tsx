'use client'

import React from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import type { RecurringConflict } from '@/lib/recurringApi'

interface RecurringConflictModalProps {
  isOpen: boolean
  onClose: () => void
  conflicts: RecurringConflict[]
  createdCount: number
  onProceedPartial: () => void
  onCancel: () => void
}

function formatConflictDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function RecurringConflictModal({
  isOpen,
  onClose,
  conflicts,
  createdCount,
  onProceedPartial,
  onCancel,
}: RecurringConflictModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="recurring-conflicts-title"
        className="w-full max-w-md max-h-[90vh] flex flex-col"
      >
        <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200 shrink-0">
          <h2 id="recurring-conflicts-title" className="text-lg font-semibold text-gray-900">
            Some dates could not be booked
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </CardHeader>
        <CardContent className="pt-4 overflow-y-auto flex-1 min-h-0">
          <p className="text-sm text-gray-600 mb-4">
            {createdCount} appointment{createdCount !== 1 ? 's were' : ' was'} created. The
            following date{conflicts.length !== 1 ? 's' : ''} had conflicts and were skipped:
          </p>
          <ul className="space-y-2 mb-6">
            {conflicts.map((c) => (
              <li
                key={c.date}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
              >
                <span className="font-medium text-gray-900">{formatConflictDate(c.date)}</span>
                {c.reason && <span className="block mt-0.5 text-gray-600 text-xs">{c.reason}</span>}
              </li>
            ))}
          </ul>
          <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 w-full sm:w-auto"
            >
              Cancel the whole series
            </button>
            <button
              type="button"
              onClick={onProceedPartial}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 w-full sm:w-auto"
            >
              Proceed with {createdCount} booking{createdCount !== 1 ? 's' : ''}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
