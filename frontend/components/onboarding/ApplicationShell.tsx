'use client'

import * as React from 'react'
import Link from 'next/link'
import { Building2, Check, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export const APPLICATION_STEPS = [
  { key: 'practice', path: '/practice', title: 'Practice details' },
  { key: 'practitioners', path: '/practitioners', title: 'Practitioners' },
  { key: 'agreement', path: '/agreement', title: 'Agreement' },
] as const

export type ApplicationStepKey = (typeof APPLICATION_STEPS)[number]['key']

/**
 * Frame for the three clinic-application steps. Unlike the setup wizard these
 * can't be skipped: the application is what MedoFlow reviews before the
 * clinic goes live.
 */
export function ApplicationShell({
  stepKey,
  title,
  subtitle,
  children,
}: {
  stepKey: ApplicationStepKey
  title: string
  subtitle?: React.ReactNode
  children: React.ReactNode
}) {
  const current = APPLICATION_STEPS.findIndex((s) => s.key === stepKey)
  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-6 md:px-8 md:py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href={APPLICATION_STEPS[current]!.path} className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 shadow-md">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-slate-900">MedoFlow</span>
        </Link>
        <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          <ShieldCheck className="h-3.5 w-3.5" />
          Clinic application
        </span>
      </div>

      <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Application progress">
        {APPLICATION_STEPS.map((step, i) => {
          const done = i < current
          const active = i === current
          return (
            <li key={step.key} aria-current={active ? 'step' : undefined}>
              <div
                className={cn(
                  'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium md:text-sm',
                  active && 'border-indigo-200 bg-white text-indigo-700 shadow-sm',
                  done && 'border-emerald-100 bg-emerald-50/60 text-emerald-700',
                  !active && !done && 'border-slate-100 bg-white/60 text-slate-400'
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                    active && 'bg-indigo-600 text-white',
                    done && 'bg-emerald-500 text-white',
                    !active && !done && 'bg-slate-100 text-slate-500'
                  )}
                >
                  {done ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="truncate">{step.title}</span>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="rounded-3xl border border-slate-100 bg-white shadow-xl">
        <div className="px-5 py-7 md:px-10 md:py-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
            Step {current + 1} of {APPLICATION_STEPS.length}
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 md:text-base">
              {subtitle}
            </p>
          )}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** A titled group of fields inside an application form. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4 border-t border-slate-100 pt-6 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  )
}

export const selectClass =
  'flex h-10 w-full rounded-[12px] border border-slate-200/80 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60'

/** IANA zones offered for the clinic's main location (US first). */
export const TIMEZONES = [
  ['America/New_York', 'Eastern (New York)'],
  ['America/Chicago', 'Central (Chicago)'],
  ['America/Denver', 'Mountain (Denver)'],
  ['America/Phoenix', 'Mountain, no DST (Phoenix)'],
  ['America/Los_Angeles', 'Pacific (Los Angeles)'],
  ['America/Anchorage', 'Alaska (Anchorage)'],
  ['Pacific/Honolulu', 'Hawaii (Honolulu)'],
  ['America/Puerto_Rico', 'Atlantic (Puerto Rico)'],
  ['Europe/London', 'London'],
  ['Asia/Kolkata', 'India (Kolkata)'],
  ['Australia/Sydney', 'Sydney'],
] as const

/** Inline ✓ / ✗ feedback for an NPI, EIN or DEA field. */
export function IdCheck({ value, valid, label }: { value: string; valid: boolean; label: string }) {
  if (!value.trim()) return null
  return (
    <p
      className={cn('text-xs font-medium', valid ? 'text-emerald-600' : 'text-rose-600')}
      data-testid={`idcheck-${label}`}
    >
      {valid ? `✓ ${label} format and check digit look right` : `✗ Not a valid ${label}`}
    </p>
  )
}
