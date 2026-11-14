'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, ChevronDown, Circle, ListChecks } from 'lucide-react'
import api from '@/lib/api'
import { onboardingApi, type OnboardingStatus } from '@/lib/onboardingApi'
import { useAuth } from '@/contexts/AuthContext'
import { clientLog } from '@/lib/clientLog'
import { cn } from '@/lib/utils'
import { AppEmptyState } from '@/components/ui-system'

export interface ChecklistItem {
  key: string
  label: string
  done: boolean
  href: string
  /** Optional items never hold the clinic back and don't count towards progress. */
  optional?: boolean
}

/**
 * Quick setup (CTO-25): the old setup wizard steps, as checklist items that
 * each open the page where the thing is set up. The website is optional
 * (CTO-23): a clinic without one still books, runs AI Scribe and sells.
 */
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
      href: '/dashboard/clinic#brand',
    },
    {
      key: 'locations',
      label: 'Check your location and hours',
      done: s.checklist.locations,
      href: '/dashboard/locations',
    },
    {
      key: 'disciplines',
      label: 'Add your disciplines',
      done: s.checklist.disciplines,
      href: '/dashboard/disciplines',
    },
    {
      key: 'services',
      label: 'Add bookable services',
      done: s.checklist.services,
      href: '/dashboard/services',
    },
    {
      key: 'providers',
      label: 'Invite your practitioners',
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
      optional: true,
    },
  ]
}

export const CHECKLIST_COLLAPSED_PREF = 'setupChecklistCollapsed'

/**
 * Command Center card (CTO-19): a compact, collapsible Quick setup panel that
 * never hides the tool. The collapsed choice is remembered per user (in
 * `User.preferences`); until the user makes a choice it follows
 * `defaultCollapsed`, so a host screen can keep it out of the way (UI-09).
 * Hidden once every required item is done.
 *
 * UI-12: the panel always surfaces the single next step, so a new clinic
 * knows exactly what to do next even while the full list is collapsed.
 */
export function SetupChecklist({
  className,
  defaultCollapsed = false,
}: {
  className?: string
  defaultCollapsed?: boolean
}) {
  const { user, patchUser } = useAuth()
  const { data } = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: onboardingApi.getStatus,
    staleTime: 30_000,
  })
  const prefs = (user?.preferences ?? {}) as Record<string, unknown>
  const stored = prefs[CHECKLIST_COLLAPSED_PREF]
  const collapsed = typeof stored === 'boolean' ? stored : defaultCollapsed

  const toggle = async () => {
    const preferences = { ...prefs, [CHECKLIST_COLLAPSED_PREF]: !collapsed }
    patchUser({ preferences })
    try {
      await api.patch('/auth/me', { preferences })
    } catch (err) {
      // Cosmetic: the panel still toggles for this session.
      clientLog.warn('[SetupChecklist] could not save the collapsed state', err)
    }
  }

  // Never take the Command Center down over a checklist: render nothing if
  // the status is missing or partial.
  if (!data?.checklist || !data.application || !data.verification) return null
  const items = checklistItems(data)
  const required = items.filter((i) => !i.optional)
  const done = required.filter((i) => i.done).length
  if (required.length > 0 && done === required.length) return null
  // The next thing to do: the first item still outstanding (required first).
  const next = items.find((i) => !i.done)

  return (
    <section
      aria-label="Quick setup"
      data-testid="setup-checklist"
      className={cn('rounded-2xl border border-slate-100 bg-white shadow-sm', className)}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls="setup-checklist-items"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <ListChecks className="h-4 w-4 shrink-0 text-brand" />
        <span className="text-sm font-semibold text-slate-900">Quick setup</span>
        <span className="text-xs font-medium text-slate-500">
          {done} of {required.length} done
        </span>
        <span className="ml-2 hidden h-1.5 max-w-[10rem] flex-1 overflow-hidden rounded-full bg-slate-100 sm:block">
          <span
            className="block h-full rounded-full bg-brand"
            style={{
              width: `${required.length ? Math.round((done / required.length) * 100) : 0}%`,
            }}
          />
        </span>
        <span className="ml-auto text-xs font-medium text-slate-500">
          {collapsed ? 'Show' : 'Hide'}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 text-slate-400 transition-transform', !collapsed && 'rotate-180')}
          aria-hidden
        />
      </button>

      {/* UI-12: a clear, always-visible "next step" affordance. */}
      {next && (
        <div className="border-t border-slate-100 px-3 py-2">
          <Link
            href={next.href}
            data-testid="setup-next-step"
            className="group flex items-center gap-3 rounded-xl bg-brand/5 px-3 py-2 transition-colors hover:bg-brand/10"
          >
            <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Next step
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
              {next.label}
            </span>
            {next.optional && (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Optional
              </span>
            )}
            <ArrowRight className="h-4 w-4 shrink-0 text-brand transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      )}

      {!collapsed &&
        (items.length === 0 ? (
          <div className="border-t border-slate-100 p-3">
            <AppEmptyState
              title="Nothing to set up"
              description="Your clinic setup steps will appear here as they become available."
            />
          </div>
        ) : (
          <ul
            id="setup-checklist-items"
            className="grid gap-1 border-t border-slate-100 px-2 py-2 sm:grid-cols-2 xl:grid-cols-3"
          >
            {items.map((item) => {
              const isNext = item.key === next?.key
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={isNext ? 'step' : undefined}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
                      item.done
                        ? 'text-slate-400'
                        : isNext
                          ? 'font-semibold text-slate-900 ring-1 ring-brand/30 hover:bg-brand/5'
                          : 'text-slate-800 hover:bg-slate-50'
                    )}
                  >
                    {item.done ? (
                      <CheckCircle2
                        className="h-4 w-4 shrink-0 text-emerald-500"
                        aria-label="done"
                      />
                    ) : isNext ? (
                      <ArrowRight className="h-4 w-4 shrink-0 text-brand" aria-label="next step" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-slate-300" aria-label="to do" />
                    )}
                    <span className={cn('min-w-0 truncate', item.done && 'line-through')}>
                      {item.label}
                    </span>
                    {item.optional && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Optional
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        ))}
    </section>
  )
}
