'use client'

/**
 * New clinic sign-up (WS4): landing → pricing → here → onboarding → dashboard.
 *
 *  1. Plan (preselected from ?plan=, changeable).
 *  2. Clinic and owner details, with a live check that the clinic's web
 *     address (<subdomain>.<root>) is free.
 *  3. POST /tenants/signup, sign the owner in, then /agreement → the
 *     onboarding wizard (app/(onboarding)) → the dashboard.
 */
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { DemoPlansBanner, PlanPicker, usePlans } from '@/components/marketing/PlanCards'
import {
  checkSubdomain,
  isValidSubdomain,
  signupClinic,
  toSubdomain,
  type TenantPlanKey,
} from '@/lib/tenantApi'
import { bookingErrorMessage } from '@/lib/bookingErrors'
import { MedoflowFullScreen } from '@/components/common/MedoflowLoader'

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_SITE_ROOT_DOMAIN || 'localhost'
const SELF_SERVE: TenantPlanKey[] = ['FREE', 'STARTER', 'GROWTH']

const schema = z.object({
  clinicName: z.string().trim().min(2, 'Enter your clinic’s name').max(100),
  clinicEmail: z.string().trim().email('Enter the clinic’s email'),
  subdomain: z
    .string()
    .refine(isValidSubdomain, '3–63 characters: lowercase letters, numbers and hyphens'),
  ownerName: z.string().trim().min(2, 'Enter your name').max(100),
  ownerEmail: z.string().trim().email('Enter your email'),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
})
type FormData = z.infer<typeof schema>

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'error'

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-800">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : (
        hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>
      )}
    </div>
  )
}

const inputCls =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20'

function GetStartedInner() {
  const router = useRouter()
  const search = useSearchParams()
  const { login } = useAuth()
  const { data: catalog } = usePlans()
  const requested = (search.get('plan') ?? '').toUpperCase() as TenantPlanKey
  const [plan, setPlan] = useState<TenantPlanKey>(
    SELF_SERVE.includes(requested) ? requested : 'GROWTH'
  )
  const [availability, setAvailability] = useState<Availability>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [subdomainTouched, setSubdomainTouched] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      clinicName: '',
      clinicEmail: '',
      subdomain: '',
      ownerName: '',
      ownerEmail: '',
      password: '',
    },
  })
  const clinicName = watch('clinicName')
  const subdomain = watch('subdomain')

  // Suggest a web address from the clinic name until the owner edits it.
  useEffect(() => {
    if (!subdomainTouched) setValue('subdomain', toSubdomain(clinicName).replace(/-+$/, ''))
  }, [clinicName, subdomainTouched, setValue])

  // Debounced availability check.
  useEffect(() => {
    if (!isValidSubdomain(subdomain)) {
      setAvailability('idle')
      return
    }
    setAvailability('checking')
    let cancelled = false
    const t = setTimeout(() => {
      checkSubdomain(subdomain)
        .then((ok) => !cancelled && setAvailability(ok ? 'available' : 'taken'))
        .catch(() => !cancelled && setAvailability('error'))
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [subdomain])

  const onSubmit = async (data: FormData) => {
    setSubmitError(null)
    if (availability === 'taken') {
      setSubmitError('That web address is taken. Choose another.')
      return
    }
    try {
      await signupClinic({ ...data, plan })
    } catch (err) {
      setSubmitError(bookingErrorMessage(err, 'We could not create your clinic. Please try again.'))
      return
    }
    try {
      await login(data.ownerEmail, data.password)
      // The onboarding gate takes it from here (terms, then the wizard).
      router.push('/agreement')
    } catch {
      router.push('/?auth=login')
    }
  }

  return (
    <section className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-teal-700">Get started</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
          Set up your clinic
        </h1>
        <p className="mt-3 text-slate-600">
          {catalog?.billingMode === 'demo'
            ? 'Create a clinic on the demo — everything is unlocked.'
            : `Start your ${catalog?.trialDays ?? 14}-day free trial. No credit card required.`}
        </p>
      </div>

      <div className="mt-8">
        <DemoPlansBanner catalog={catalog} />
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="space-y-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <fieldset className="space-y-3">
          <legend className="text-base font-bold text-slate-900">1. Your plan</legend>
          {catalog ? (
            <PlanPicker catalog={catalog} value={plan} onChange={setPlan} />
          ) : (
            <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
          )}
          <p className="text-xs text-slate-500">
            You can change plans later. Need Enterprise?{' '}
            <Link href="/pricing" className="font-semibold text-teal-700 underline">
              Compare plans
            </Link>
          </p>
        </fieldset>

        <fieldset className="grid gap-5 sm:grid-cols-2">
          <legend className="mb-1 text-base font-bold text-slate-900 sm:col-span-2">
            2. Your clinic
          </legend>
          <Field id="clinicName" label="Clinic name" error={errors.clinicName?.message}>
            <input id="clinicName" className={inputCls} {...register('clinicName')} />
          </Field>
          <Field id="clinicEmail" label="Clinic email" error={errors.clinicEmail?.message}>
            <input
              id="clinicEmail"
              type="email"
              autoComplete="email"
              className={inputCls}
              {...register('clinicEmail')}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              id="subdomain"
              label="Your website address"
              error={errors.subdomain?.message}
              hint={
                <span data-testid="subdomain-status" className="inline-flex items-center gap-1">
                  {availability === 'checking' && (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Checking…
                    </>
                  )}
                  {availability === 'available' && (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Available
                    </span>
                  )}
                  {availability === 'taken' && (
                    <span className="inline-flex items-center gap-1 text-red-600">
                      <XCircle className="h-3.5 w-3.5" aria-hidden /> Already taken
                    </span>
                  )}
                  {availability === 'idle' && 'Your clinic’s site, booking and patient portal'}
                  {availability === 'error' && 'Could not check right now — you can still continue'}
                </span>
              }
            >
              <div className="flex items-center overflow-hidden rounded-xl border border-slate-200 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20">
                <input
                  id="subdomain"
                  className="h-11 min-w-0 flex-1 px-3 text-sm outline-none"
                  {...register('subdomain', {
                    onChange: (e) => {
                      setSubdomainTouched(true)
                      setValue('subdomain', toSubdomain(e.target.value))
                    },
                  })}
                />
                <span className="shrink-0 border-l border-slate-200 bg-slate-50 px-3 text-sm leading-[2.75rem] text-slate-500">
                  .{ROOT_DOMAIN}
                </span>
              </div>
            </Field>
          </div>
        </fieldset>

        <fieldset className="grid gap-5 sm:grid-cols-2">
          <legend className="mb-1 text-base font-bold text-slate-900 sm:col-span-2">
            3. Your account
          </legend>
          <Field id="ownerName" label="Your name" error={errors.ownerName?.message}>
            <input
              id="ownerName"
              autoComplete="name"
              className={inputCls}
              {...register('ownerName')}
            />
          </Field>
          <Field id="ownerEmail" label="Your email" error={errors.ownerEmail?.message}>
            <input
              id="ownerEmail"
              type="email"
              autoComplete="email"
              className={inputCls}
              {...register('ownerEmail')}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              id="password"
              label="Password"
              error={errors.password?.message}
              hint="At least 8 characters"
            >
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className={inputCls}
                {...register('password')}
              />
            </Field>
          </div>
        </fieldset>

        {submitError && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {submitError}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {isSubmitting ? 'Creating your clinic…' : 'Create my clinic'}
        </button>
        <p className="text-center text-xs text-slate-500">
          Already on MedoFlow?{' '}
          <Link href="/?auth=login" className="font-semibold text-teal-700 underline">
            Sign in
          </Link>
        </p>
      </form>
    </section>
  )
}

export default function GetStartedPage() {
  return (
    <React.Suspense fallback={<MedoflowFullScreen subtitle="Loading" />}>
      <GetStartedInner />
    </React.Suspense>
  )
}
