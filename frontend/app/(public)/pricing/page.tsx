'use client'

/** Clinic plans (WS4): pick one → /get-started → onboarding → dashboard. */
import { PlanCards } from '@/components/marketing/PlanCards'
import { salesMailto } from '@/lib/tenantApi'

export default function PricingPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-teal-700">Pricing</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
          One platform. One simple plan.
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          Scheduling, records, payments, an AI scribe, video visits and your clinic website — pick
          the plan that fits and set up your clinic in minutes.
        </p>
      </div>
      <PlanCards className="mt-12" />
      <p className="mt-10 text-center text-sm text-slate-500">
        Questions?{' '}
        <a href={salesMailto('MedoFlow pricing')} className="font-semibold text-teal-700 underline">
          Talk to our team
        </a>
      </p>
    </section>
  )
}
