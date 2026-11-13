'use client'

/**
 * The clinic plans (WS4), from GET /tenants/plans. Used on /pricing, in the
 * landing page's #pricing section, and as the plan picker on /get-started.
 *
 * On the hosted demo (billingMode=demo) a banner says plans are illustrative:
 * every clinic gets everything and nothing expires.
 */
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Check, Sparkles } from 'lucide-react'
import {
  getPlans,
  priceLabel,
  salesMailto,
  type PlanCatalog,
  type PlanInfo,
  type TenantPlanKey,
} from '@/lib/tenantApi'
import { cn } from '@/lib/utils'

export function usePlans() {
  return useQuery({ queryKey: ['tenant-plans'], queryFn: getPlans, staleTime: 5 * 60_000 })
}

export function DemoPlansBanner({ catalog }: { catalog: PlanCatalog | undefined }) {
  if (catalog?.billingMode !== 'demo') return null
  return (
    <p
      role="status"
      data-testid="demo-plans-banner"
      className="mx-auto mb-8 flex max-w-2xl items-center justify-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-4 py-2 text-center text-sm text-teal-900"
    >
      <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
      Demo environment: plans are illustrative. Every clinic gets every feature, and nothing
      expires.
    </p>
  )
}

function PlanCardBody({ plan }: { plan: PlanInfo }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
        {plan.recommended && (
          <span className="rounded-full bg-teal-600 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
            Most popular
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">{plan.tagline}</p>
      <p className="mt-5 text-3xl font-black text-slate-900">{priceLabel(plan)}</p>
      <ul className="mt-5 space-y-2 text-sm text-slate-700">
        {plan.highlights.map((h) => (
          <li key={h} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
            <span>{h}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Plans with a call to action each: start a trial (self-serve) or contact sales. */
export function PlanCards({ className }: { className?: string }) {
  const { data, isLoading, isError } = usePlans()
  if (isLoading) {
    return (
      <div role="status" aria-label="Loading plans" className="grid gap-5 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-80 animate-pulse rounded-3xl bg-slate-100" />
        ))}
      </div>
    )
  }
  if (isError || !data) {
    return (
      <p className="text-center text-sm text-slate-500">
        Plans could not be loaded.{' '}
        <Link href="/get-started" className="font-semibold text-teal-700 underline">
          Start your clinic anyway
        </Link>
      </p>
    )
  }
  const trialLabel = data.billingMode === 'demo' ? 'Create your clinic' : 'Start free trial'
  return (
    <div className={className}>
      <DemoPlansBanner catalog={data} />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4" data-testid="plan-cards">
        {data.plans.map((plan) => (
          <article
            key={plan.key}
            className={cn(
              'flex flex-col rounded-3xl border bg-white p-6 text-left shadow-sm',
              plan.recommended ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-slate-200'
            )}
          >
            <PlanCardBody plan={plan} />
            <div className="mt-auto pt-6">
              {plan.selfServe ? (
                <Link
                  href={`/get-started?plan=${plan.key}`}
                  className={cn(
                    'inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition-colors',
                    plan.recommended
                      ? 'bg-teal-600 text-white hover:bg-teal-700'
                      : 'border border-slate-300 text-slate-800 hover:bg-slate-50'
                  )}
                  aria-label={`${trialLabel}: ${plan.name}`}
                >
                  {trialLabel}
                </Link>
              ) : (
                <a
                  href={salesMailto(`MedoFlow ${plan.name}`)}
                  className="inline-flex w-full items-center justify-center rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Contact sales
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
      {data.billingMode !== 'demo' && (
        <p className="mt-6 text-center text-sm text-slate-500">
          Every plan starts with a {data.trialDays}-day free trial. No credit card required.
        </p>
      )}
    </div>
  )
}

/** Radio-card plan picker for sign-up (self-serve plans only). */
export function PlanPicker({
  catalog,
  value,
  onChange,
}: {
  catalog: PlanCatalog
  value: TenantPlanKey
  onChange: (plan: TenantPlanKey) => void
}) {
  return (
    <div role="radiogroup" aria-label="Plan" className="grid gap-3 sm:grid-cols-3">
      {catalog.plans
        .filter((p) => p.selfServe)
        .map((plan) => (
          <button
            key={plan.key}
            type="button"
            role="radio"
            aria-checked={value === plan.key}
            onClick={() => onChange(plan.key)}
            className={cn(
              'rounded-2xl border p-4 text-left transition-colors',
              value === plan.key
                ? 'border-teal-600 bg-teal-50 ring-2 ring-teal-600/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            )}
          >
            <span className="block text-sm font-bold text-slate-900">{plan.name}</span>
            <span className="mt-0.5 block text-xs text-slate-500">{priceLabel(plan)}</span>
          </button>
        ))}
    </div>
  )
}
