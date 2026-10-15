'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react'
import { Building2 } from 'lucide-react'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { clientLog } from '@/lib/clientLog'

export const STEPS = [
  { key: 'welcome', path: '/welcome', title: 'Welcome' },
  { key: 'brand', path: '/brand', title: 'Brand' },
  { key: 'locations', path: '/locations', title: 'Locations' },
  { key: 'disciplines', path: '/disciplines', title: 'Disciplines' },
  { key: 'services', path: '/services', title: 'Services' },
  { key: 'providers', path: '/providers', title: 'Providers' },
  { key: 'done', path: '/done', title: 'Done' },
] as const

export type StepKey = (typeof STEPS)[number]['key']

interface OnboardingShellProps {
  stepKey: StepKey
  title: string
  subtitle?: string
  children: React.ReactNode
  onNext?: () => void | Promise<void>
  onBack?: () => void
  nextLabel?: string
  nextDisabled?: boolean
  hideNext?: boolean
  hideBack?: boolean
  hideSkip?: boolean
}

/**
 * Shared shell for every onboarding step.
 * Renders: side stepper, persistent "Skip for now", title/subtitle, body, nav.
 */
export function OnboardingShell({
  stepKey,
  title,
  subtitle,
  children,
  onNext,
  onBack,
  nextLabel = 'Continue',
  nextDisabled = false,
  hideNext = false,
  hideBack = false,
  hideSkip = false,
}: OnboardingShellProps) {
  const router = useRouter()
  const { refetchUser } = useAuth()
  const [isSkipping, setIsSkipping] = React.useState(false)
  const [isAdvancing, setIsAdvancing] = React.useState(false)

  const currentIndex = STEPS.findIndex((s) => s.key === stepKey)
  const totalSteps = STEPS.length - 1 // exclude "welcome" visual prefix? include all 7

  const handleSkip = async () => {
    if (isSkipping) return
    setIsSkipping(true)
    try {
      await api.post('/onboarding/complete')
      await refetchUser()
      router.replace('/dashboard')
    } catch (err) {
      clientLog.warn('[OnboardingShell] skip failed', err)
      setIsSkipping(false)
    }
  }

  const handleNext = async () => {
    if (isAdvancing || !onNext) {
      // If no onNext provided, just navigate to the next step
      const next = STEPS[currentIndex + 1]
      if (next) router.push(next.path)
      return
    }
    setIsAdvancing(true)
    try {
      await onNext()
    } finally {
      setIsAdvancing(false)
    }
  }

  const handleBack = () => {
    if (onBack) {
      onBack()
      return
    }
    const prev = STEPS[currentIndex - 1]
    if (prev) router.push(prev.path)
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 md:px-8 md:py-10">
      {/* Header */}
      <div className="mb-10 flex items-center justify-between">
        <Link href="/welcome" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 shadow-md">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-slate-900">MedoFlow</span>
        </Link>
        {!hideSkip && (
          <button
            type="button"
            onClick={handleSkip}
            disabled={isSkipping}
            className="text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
          >
            {isSkipping ? 'Saving…' : 'Skip setup for now →'}
          </button>
        )}
      </div>

      <div className="flex flex-1 gap-10">
        {/* Left: Stepper */}
        <aside className="hidden w-52 shrink-0 md:block">
          <ol className="space-y-1">
            {STEPS.map((step, i) => {
              const isCurrent = i === currentIndex
              const isDone = i < currentIndex
              return (
                <li key={step.key}>
                  <div
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors',
                      isCurrent && 'bg-white shadow-sm'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                        isDone
                          ? 'bg-indigo-600 text-white'
                          : isCurrent
                            ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-600'
                            : 'bg-slate-200 text-slate-500'
                      )}
                    >
                      {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </div>
                    <span
                      className={cn(isCurrent ? 'font-semibold text-slate-900' : 'text-slate-500')}
                    >
                      {step.title}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        </aside>

        {/* Right: Body card */}
        <div className="flex-1">
          <div className="rounded-3xl border border-slate-100 bg-white shadow-xl">
            <div className="px-6 py-7 md:px-10 md:py-10">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
                Step {currentIndex + 1} of {totalSteps + 1}
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-2 text-sm leading-relaxed text-slate-600 md:text-base">
                  {subtitle}
                </p>
              )}

              <div className="mt-8">{children}</div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-6 py-4 md:px-10">
              <div>
                {!hideBack && currentIndex > 0 && (
                  <button
                    type="button"
                    onClick={handleBack}
                    className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                )}
              </div>
              {!hideNext && (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={nextDisabled || isAdvancing}
                  className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAdvancing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {nextLabel}
                  {!isAdvancing && <ArrowRight className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            No credit card required · 14-day free trial · Cancel anytime
          </p>
        </div>
      </div>
    </div>
  )
}
