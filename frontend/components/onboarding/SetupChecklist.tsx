'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Circle, ListChecks } from 'lucide-react'
import { onboardingApi, type OnboardingStatus } from '@/lib/onboardingApi'
import { cn } from '@/lib/utils'

export interface ChecklistItem {
  key: string
  label: string
  done: boolean
  href: string
}

/** The setup checklist the onboarding wizard promises, from GET /onboarding/status. */
export function checklistItems(s: OnboardingStatus): ChecklistItem[] {
  const app = s.application
  return [
    {
      key: 'application',
      label: 'Submit your clinic application',
      done: app.practice && app.practitioners && app.agreement,
      href: '/dashboard/clinic',
    },
    {
      key: 'review',
      label: 'Clinic approved by MedoFlow',
      done: s.verification.status === 'APPROVED',
      href: '/dashboard/clinic',
    },
    {
      key: 'brand',
      label: 'Add your logo and colours',
      done: s.checklist.brand,
      href: '/dashboard/site/editor',
    },
    {
      key: 'locations',
      label: 'Set up your location',
      done: s.checklist.locations,
      href: '/dashboard/locations',
    },
    {
      key: 'services',
      label: 'Add bookable services',
      done: s.checklist.services,
      href: '/dashboard/services',
    },
    {
      key: 'providers',
      label: 'Add your practitioners',
      done: s.checklist.providers,
      href: '/dashboard/staff',
    },
    {
      key: 'availability',
      label: 'Set practitioner availability',
      done: s.checklist.availability,
      // Each provider's hours are set from the Team page.
      href: '/dashboard/staff',
    },
    {
      key: 'website',
      label: 'Publish your website',
      done: s.checklist.website,
      href: '/dashboard/site',
    },
  ]
}

/**
 * Command Center card: what's left before the clinic is fully live. Hidden
 * once every item is done.
 */
export function SetupChecklist() {
  const { data } = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: onboardingApi.getStatus,
    staleTime: 30_000,
  })
  // Never take the Command Center down over a checklist: render nothing if
  // the status is missing or partial.
  if (!data?.checklist || !data.application || !data.verification) return null
  const items = checklistItems(data)
  const done = items.filter((i) => i.done).length
  if (done === items.length) return null

  return (
    <section
      aria-label="Setup checklist"
      data-testid="setup-checklist"
      className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-indigo-600" />
          <h2 className="text-base font-semibold text-slate-900">Finish setting up your clinic</h2>
        </div>
        <span className="text-sm font-medium text-slate-500">
          {done} of {items.length} done
        </span>
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div
          className="h-full rounded-full bg-indigo-600"
          style={{ width: `${Math.round((done / items.length) * 100)}%` }}
        />
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors',
                item.done ? 'text-slate-400' : 'text-slate-800 hover:bg-slate-50'
              )}
            >
              {item.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-label="done" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-slate-300" aria-label="to do" />
              )}
              <span className={cn(item.done && 'line-through')}>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
