'use client'

/**
 * AuthModal — unified login / sign-up dialog used across the marketing shell.
 *
 * Shape:
 *   • Left panel  — navy "edge" with the brand story + proof chips.
 *   • Right panel — white "workspace" holding the actual form.
 *   • Tabs switch between "Sign in" and "Create account" without re-mounting
 *     the dialog (smoother UX than navigating to a separate page).
 *
 * The full-page /login and /register routes are intentionally kept alive as
 * fallbacks (deep-linked from emails, returnUrl flows, future OAuth
 * callbacks). This modal simply provides a friendlier first path.
 *
 * Wire-up:
 *   1. Wrap the public tree with <AuthModalProvider>.
 *   2. Trigger from anywhere with useAuthModal().openLogin() / openSignup().
 */

import React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { isOnClinicSiteHost } from '@/lib/site/host'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, Lock, Mail, ShieldCheck, User as UserIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'
import api from '@/lib/api'
import { useAuth, landingForRole } from '@/contexts/AuthContext'
import { BrandLogo } from '@/components/common/BrandLogo'
import { MedoflowLoader } from '@/components/common/MedoflowLoader'
import { useQuery } from '@tanstack/react-query'
import { getClinic } from '@/lib/clinicApi'
import type { User } from '@/lib/types'
import { MfaChallengeForm } from './MfaChallengeForm'

const CLINIC_DEFAULT_THEME = '#0D9488'

// When the auth modal opens from /clinic/[idOrSlug] we want the brand panel
// to show the clinic, not Medoflow. This hook returns clinic context (and
// the theme color for accents) when on a clinic site, otherwise null.
function useClinicContext() {
  const pathname = usePathname()
  const match = pathname?.match(/^\/clinic\/([^/?#]+)/)
  const idOrSlug = match?.[1] ?? null
  const { data } = useQuery({
    queryKey: ['clinic', idOrSlug],
    queryFn: () => getClinic(idOrSlug as string),
    enabled: !!idOrSlug,
  })
  if (!idOrSlug) return null
  return {
    clinic: data ?? null,
    themeColor: data?.themeColor?.trim() || CLINIC_DEFAULT_THEME,
  }
}

// ─────────────────────────── Context ─────────────────────────────────

type AuthMode = 'login' | 'signup'

type AuthModalContextValue = {
  open: boolean
  mode: AuthMode
  openLogin: () => void
  openSignup: () => void
  close: () => void
  switchMode: (m: AuthMode) => void
}

const AuthModalContext = React.createContext<AuthModalContextValue | null>(null)

export function useAuthModal(): AuthModalContextValue {
  const ctx = React.useContext(AuthModalContext)
  if (!ctx) throw new Error('useAuthModal must be used inside <AuthModalProvider>')
  return ctx
}

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<AuthMode>('login')

  const value = React.useMemo<AuthModalContextValue>(
    () => ({
      open,
      mode,
      openLogin: () => {
        setMode('login')
        setOpen(true)
      },
      openSignup: () => {
        setMode('signup')
        setOpen(true)
      },
      close: () => setOpen(false),
      switchMode: setMode,
    }),
    [open, mode]
  )

  return (
    <AuthModalContext.Provider value={value}>
      {children}
      <AuthModal />
      <AuthQueryParamListener />
    </AuthModalContext.Provider>
  )
}

/**
 * Listens for `?auth=login` or `?auth=signup` in the URL and opens the
 * matching modal. This is how legacy routes (/login, /signup) hand off to
 * the modal flow after redirecting to the landing page.
 */
function AuthQueryParamListener() {
  const search = useSearchParams()
  const router = useRouter()
  const { openLogin, openSignup } = useAuthModal()
  const pathname = usePathname()
  const handled = React.useRef<string | null>(null)

  React.useEffect(() => {
    const mode = search.get('auth')
    if (!mode) {
      handled.current = null
      return
    }
    const key = `${pathname}?${search.toString()}`
    if (handled.current === key) return
    handled.current = key
    if (mode === 'signup') openSignup()
    else openLogin()
    // Strip the auth param so a refresh doesn't reopen the modal, but keep
    // returnUrl so the LoginForm can route back after success.
    const remaining = new URLSearchParams(search.toString())
    remaining.delete('auth')
    const suffix = remaining.toString()
    router.replace(pathname + (suffix ? `?${suffix}` : ''))
  }, [search, pathname, router, openLogin, openSignup])

  return null
}

// ─────────────────────────── Modal shell ─────────────────────────────

function AuthModal() {
  const { open, mode, close, switchMode } = useAuthModal()
  const clinicCtx = useClinicContext()

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => (v ? undefined : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[60] bg-navy/60 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0'
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[61] grid w-[94vw] max-w-[920px]',
            // Mobile: card sits in the center, scrolls internally if needed.
            'max-h-[92vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[20px]',
            'bg-white md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95'
          )}
          style={{ boxShadow: '0 40px 80px -20px rgba(15, 23, 42, 0.35)' }}
        >
          {/* Desktop split panel */}
          <BrandPanel mode={mode} clinicCtx={clinicCtx} />

          {/* Mobile-only brand strip — keeps the modal feeling branded at 375px */}
          <MobileBrandStrip mode={mode} clinicCtx={clinicCtx} />

          <div className="relative flex max-h-[92vh] flex-col overflow-y-auto bg-white p-6 sm:p-8 md:p-10">
            <DialogPrimitive.Close
              aria-label="Close"
              className={cn(
                'absolute right-5 top-5 inline-flex h-8 w-8 items-center justify-center',
                'rounded-full border border-hairline text-ink-muted transition-colors',
                'hover:bg-canvas hover:text-ink'
              )}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M1 1l12 12M13 1L1 13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </DialogPrimitive.Close>

            <DialogPrimitive.Title className="mf-display text-[26px] text-ink">
              {mode === 'login'
                ? clinicCtx?.clinic
                  ? `Welcome back to ${clinicCtx.clinic.name}`
                  : 'Welcome back'
                : clinicCtx?.clinic
                  ? `Create your ${clinicCtx.clinic.name} account`
                  : 'Create your account'}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1.5 text-[13.5px] text-ink-muted">
              {mode === 'login'
                ? clinicCtx?.clinic
                  ? 'Sign in to book a visit and review your care.'
                  : 'Sign in to pick up right where you left off.'
                : clinicCtx?.clinic
                  ? 'Create a patient account to book and manage your visits.'
                  : 'Start your 14-day trial. No credit card required.'}
            </DialogPrimitive.Description>

            <ModeSwitch mode={mode} onChange={switchMode} />

            <div className="mt-6">
              {mode === 'login' ? (
                <LoginForm onSuccess={close} themeColor={clinicCtx?.themeColor} />
              ) : (
                <SignupForm onSuccess={close} themeColor={clinicCtx?.themeColor} />
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// ─────────────────────────── Brand panel (left) ──────────────────────

type ClinicCtx = ReturnType<typeof useClinicContext>

function BrandPanel({ mode, clinicCtx }: { mode: AuthMode; clinicCtx: ClinicCtx }) {
  // Clinic-branded variant when the modal is opened on a /clinic/[id] page.
  if (clinicCtx?.clinic) {
    const { clinic, themeColor } = clinicCtx
    return (
      <aside
        className="relative hidden overflow-hidden p-10 text-white md:flex md:flex-col md:justify-between"
        style={{ backgroundColor: themeColor }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(circle at 30% 0%, rgba(255,255,255,0.35) 0%, transparent 55%), radial-gradient(circle at 80% 80%, rgba(0,0,0,0.25) 0%, transparent 55%)',
          }}
        />
        <div className="relative flex items-center gap-3">
          {clinic.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={clinic.logoUrl}
              alt={`${clinic.name} logo`}
              className="h-10 w-10 rounded-full border-2 border-white/40 object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
          )}
          <span className="text-base font-bold text-white">{clinic.name}</span>
        </div>

        <div className="relative">
          <h3 className="mf-display text-[28px] leading-tight text-white">
            {mode === 'login' ? (
              <>
                Welcome back. <br />
                <span className="text-white/80">Care, on your terms.</span>
              </>
            ) : (
              <>
                Join {clinic.name}. <br />
                <span className="text-white/80">Book in minutes.</span>
              </>
            )}
          </h3>
          <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-white/80">
            {mode === 'login'
              ? 'Sign in to pick up where you left off — appointments, visit notes, and billing in one place.'
              : 'Create your patient account to book visits, view records, and message the clinic team.'}
          </p>
        </div>

        <ul className="relative mt-10 space-y-3 text-[13px] text-white/80">
          <Proof>Verified facility</Proof>
          <Proof>Secure self-pay booking</Proof>
          <Proof>Same-day appointments</Proof>
        </ul>
      </aside>
    )
  }

  // Default Medoflow staff/admin variant.
  return (
    <aside className="relative hidden overflow-hidden bg-navy p-10 text-white md:flex md:flex-col md:justify-between">
      {/* atmospheric bg */}
      <div className="absolute inset-0 mf-grid-pattern opacity-40" aria-hidden />
      <div
        className="pointer-events-none absolute -top-24 -left-16 h-72 w-72 rounded-full blur-[120px]"
        style={{ backgroundColor: 'rgba(13, 148, 136, 0.35)' }}
        aria-hidden
      />

      <div className="relative">
        <BrandLogo size="lg" tone="light" />
        <h3 className="mf-display mt-8 text-[26px] leading-tight text-white">
          {mode === 'login' ? (
            <>
              One timeline. <br />
              <span className="text-teal-bright">Every patient.</span>
            </>
          ) : (
            <>
              Start running on <br />
              <span className="text-teal-bright">one surface.</span>
            </>
          )}
        </h3>
        <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-white/65">
          {mode === 'login'
            ? 'Pick up the day where you left off — schedule, charts, and billing are already waiting.'
            : 'Replace the 7+ tools stitched across your day with a single, calmer surface.'}
        </p>
      </div>

      <ul className="relative mt-10 space-y-3 text-[13px] text-white/75">
        <Proof>HIPAA &amp; SOC2 aligned</Proof>
        <Proof>Free 14-day trial &middot; no credit card</Proof>
        <Proof>2,400+ clinics across 14 specialties</Proof>
      </ul>
    </aside>
  )
}

function Proof({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="mf-dot mf-dot--ok" />
      {children}
    </li>
  )
}

// ─────────────────────────── Mobile brand strip ──────────────────────

/**
 * Compressed brand presence for <md viewports where the full BrandPanel is
 * hidden. Single navy strip, one-liner, one proof chip. Keeps the dialog
 * feeling on-brand without pushing the form out of the fold on a phone.
 */
function MobileBrandStrip({ mode, clinicCtx }: { mode: AuthMode; clinicCtx: ClinicCtx }) {
  if (clinicCtx?.clinic) {
    const { clinic, themeColor } = clinicCtx
    return (
      <div
        className="flex items-center gap-3 px-5 py-4 text-white md:hidden"
        style={{ backgroundColor: themeColor }}
      >
        {clinic.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clinic.logoUrl}
            alt={`${clinic.name} logo`}
            className="h-7 w-7 rounded-full border border-white/40 object-cover"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
            <ShieldCheck className="h-4 w-4" />
          </div>
        )}
        <p className="mf-display min-w-0 truncate text-[13px] leading-tight text-white">
          {mode === 'login' ? `Welcome back to ${clinic.name}` : `Join ${clinic.name}`}
        </p>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 bg-navy px-5 py-4 text-white md:hidden">
      <BrandLogo size="sm" tone="light" />
      <p className="mf-display min-w-0 truncate text-[13px] leading-tight text-white/80">
        {mode === 'login' ? 'One timeline. Every patient.' : 'Start on one surface.'}
      </p>
    </div>
  )
}

// ─────────────────────────── Tab switch ──────────────────────────────

function ModeSwitch({ mode, onChange }: { mode: AuthMode; onChange: (m: AuthMode) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Authentication mode"
      className="mt-6 inline-grid w-fit grid-cols-2 rounded-full border border-hairline bg-canvas p-1 text-[12.5px]"
    >
      {(['login', 'signup'] as const).map((m) => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          onClick={() => onChange(m)}
          className={cn(
            'h-8 rounded-full px-4 font-medium transition-colors',
            mode === m ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
          )}
        >
          {m === 'login' ? 'Sign in' : 'Create account'}
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────── Login form ──────────────────────────────

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})
type LoginData = z.infer<typeof loginSchema>

function LoginForm({ onSuccess, themeColor }: { onSuccess: () => void; themeColor?: string }) {
  const isClinic = !!themeColor
  const router = useRouter()
  const search = useSearchParams()
  const pathname = usePathname()
  const returnUrl = search.get('returnUrl')
  const { login } = useAuth()

  const reason = search.get('reason')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [mfaToken, setMfaToken] = React.useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LoginData>({ resolver: zodResolver(loginSchema) })

  // Patients on a clinic site stay on the clinic site after login. Only
  // staff/admin (non-PATIENT) get routed to their dashboard.
  const finish = (user: User) => {
    onSuccess()
    const isPatientOnClinicSite =
      user.role === 'PATIENT' &&
      (pathname?.startsWith('/clinic/') || pathname?.startsWith('/s/') || isOnClinicSiteHost())
    const target = returnUrl ? returnUrl : isPatientOnClinicSite ? pathname! : landingForRole(user)
    router.replace(target)
    router.refresh()
  }

  const onSubmit = async (data: LoginData) => {
    setError(null)
    setSubmitting(true)
    try {
      // Forward the clinic from the path (slug or cuid) so the backend can
      // reject cross-clinic logins from a clinic-branded surface. The same
      // generic 401 is returned to avoid clinic enumeration.
      const clinicHint = clinicIdFromPath(pathname)
      const result = await login(data.email, data.password, clinicHint)
      if (result.mfaRequired) {
        // Password accepted; tokens are only issued after the second factor.
        setMfaToken(result.mfaToken)
        reset({ email: data.email, password: '' })
        return
      }
      finish(result.user)
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Sign in failed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (mfaToken) {
    return (
      <MfaChallengeForm
        mfaToken={mfaToken}
        onVerified={finish}
        onRestart={() => {
          setMfaToken(null)
          setError(null)
        }}
      />
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {!error && (reason === 'idle' || reason === 'expired') && (
        <div
          role="status"
          className="rounded-[10px] border border-amber-300/60 bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-snug text-amber-900"
        >
          {reason === 'idle'
            ? 'You were signed out after a period of inactivity to protect patient data. Please sign in again.'
            : 'Your session ended. Please sign in again.'}
        </div>
      )}
      {error && <FormError message={error} />}

      <Field
        id="login-email"
        label={isClinic ? 'Email' : 'Work email'}
        icon={Mail}
        type="email"
        autoComplete="email"
        placeholder={isClinic ? 'you@email.com' : 'name@clinic.com'}
        themeColor={themeColor}
        error={errors.email?.message}
        {...register('email')}
      />

      <Field
        id="login-password"
        label="Password"
        icon={Lock}
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        themeColor={themeColor}
        error={errors.password?.message}
        trailing={
          <Link
            href="/forgot-password"
            className="text-[11.5px] font-medium hover:underline"
            style={{ color: themeColor ?? undefined }}
          >
            Forgot?
          </Link>
        }
        {...register('password')}
      />

      <SubmitButton submitting={submitting} label="Sign in" themeColor={themeColor} />
    </form>
  )
}

// ─────────────────────────── Signup form ─────────────────────────────

const signupSchema = z.object({
  name: z.string().min(1, 'Please enter your name'),
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Use at least 6 characters'),
})
type SignupData = z.infer<typeof signupSchema>

// Pull the `:id` param out of /clinic/<id-or-slug>/... so a patient signing
// up on the clinic site is auto-linked to that clinic on the server.
function clinicIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null
  const m = pathname.match(/^\/clinic\/([^/?#]+)/)
  return m?.[1] ?? null
}

function SignupForm({ onSuccess, themeColor }: { onSuccess: () => void; themeColor?: string }) {
  const pathname = usePathname()
  const isClinic = !!themeColor
  const { login } = useAuth()
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupData>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: '', email: '', password: '' },
  })

  // Register and immediately log the patient in. Skips the old "Account
  // created — sign in to continue" intermediate state, which was the
  // biggest friction point in the patient flow.
  const onSubmit = async (data: SignupData) => {
    setError(null)
    setSubmitting(true)
    try {
      const clinicId = clinicIdFromPath(pathname)
      await api.post('/auth/register', { ...data, clinicId: clinicId ?? undefined })
      try {
        await login(data.email, data.password, clinicId)
        onSuccess()
      } catch {
        // Auto-login failed (rare) — fall back to the sign-in tab so the
        // user can complete it manually instead of getting stuck.
        onSuccess()
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Registration failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {error && <FormError message={error} />}

      <Field
        id="signup-name"
        label="Full name"
        icon={UserIcon}
        type="text"
        autoComplete="name"
        placeholder="Jane Doe"
        themeColor={themeColor}
        error={errors.name?.message}
        {...register('name')}
      />

      <Field
        id="signup-email"
        label="Email"
        icon={Mail}
        type="email"
        autoComplete="email"
        placeholder={isClinic ? 'you@email.com' : 'jane@clinic.com'}
        themeColor={themeColor}
        error={errors.email?.message}
        {...register('email')}
      />

      <Field
        id="signup-password"
        label="Password"
        icon={Lock}
        type="password"
        autoComplete="new-password"
        placeholder="Min. 6 characters"
        themeColor={themeColor}
        error={errors.password?.message}
        {...register('password')}
      />

      <p className="text-[11.5px] leading-relaxed text-ink-muted">
        By creating an account you agree to our{' '}
        <Link
          href="#"
          className="font-medium hover:underline"
          style={{ color: themeColor ?? undefined }}
        >
          Terms
        </Link>{' '}
        and{' '}
        <Link
          href="#"
          className="font-medium hover:underline"
          style={{ color: themeColor ?? undefined }}
        >
          Privacy Policy
        </Link>
        .
      </p>

      <SubmitButton submitting={submitting} label="Create account" themeColor={themeColor} />
    </form>
  )
}

// ─────────────────────────── Pieces ──────────────────────────────────

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  id: string
  label: string
  icon: LucideIcon
  error?: string
  trailing?: React.ReactNode
  themeColor?: string
}

const Field = React.forwardRef<HTMLInputElement, FieldProps>(function Field(
  { id, label, icon: Icon, error, trailing, className, themeColor, ...input },
  ref
) {
  // When themed, swap the focus ring/border from Medoflow teal to the
  // clinic's color via inline CSS variables. Tailwind can't do this
  // because the value is dynamic per clinic.
  const themedStyle = themeColor
    ? ({
        '--tw-ring-color': `${themeColor}40`,
        '--auth-field-focus-border': themeColor,
      } as React.CSSProperties)
    : undefined
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="mf-eyebrow text-ink-muted">
          {label}
        </label>
        {trailing}
      </div>
      <div className="relative mt-2">
        <Icon
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
          strokeWidth={1.75}
        />
        <input
          id={id}
          ref={ref}
          {...input}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          style={themedStyle}
          onFocus={(e) => {
            if (themeColor) e.currentTarget.style.borderColor = themeColor
            input.onFocus?.(e)
          }}
          onBlur={(e) => {
            if (themeColor && !error) e.currentTarget.style.borderColor = ''
            input.onBlur?.(e)
          }}
          className={cn(
            'block h-11 w-full rounded-[10px] border bg-white pl-10 pr-3 text-[14px] text-ink',
            'placeholder:text-ink-faint',
            'focus:outline-none focus:ring-2',
            // Default (Medoflow) focus tint when no theme provided.
            !themeColor && 'focus:ring-teal/30 focus:border-teal',
            error ? 'border-destructive' : 'border-hairline hover:border-ink-faint',
            className
          )}
        />
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[11.5px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
})

function FormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-[10px] border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[12.5px] leading-snug text-destructive"
    >
      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      <span className="break-words">{message}</span>
    </div>
  )
}

function SubmitButton({
  submitting,
  label,
  themeColor,
}: {
  submitting: boolean
  label: string
  themeColor?: string
}) {
  // Themed: solid clinic background, white text. Without a theme we keep
  // the Medoflow primary teal styling via the existing `mf-btn` class.
  const themedClass = themeColor
    ? cn(
        'mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] text-[14px] font-bold text-white shadow-sm transition-opacity',
        submitting ? 'cursor-not-allowed opacity-80' : 'hover:opacity-90'
      )
    : cn('mf-btn mf-btn-primary mt-2 w-full', submitting && 'cursor-not-allowed opacity-80')
  const themedStyle = themeColor ? { backgroundColor: themeColor } : undefined
  return (
    <button type="submit" disabled={submitting} className={themedClass} style={themedStyle}>
      {submitting ? (
        <Spinner />
      ) : (
        <>
          {label}
          <ArrowRight className="h-4 w-4" />
        </>
      )}
    </button>
  )
}

function Spinner() {
  // Inline MedoflowLoader so the button pulse matches the rest of the app's
  // loading vocabulary. `light` tone on the teal primary button.
  return <MedoflowLoader size="sm" tone="light" className="-my-0.5" />
}

// ─────────────────────────── Helpers ─────────────────────────────────

/**
 * Pull a safe, human-readable error message out of an axios-style error.
 *
 * Backends occasionally return raw stack traces or internal paths; we never
 * want those leaking into the UI. If anything looks like a stack trace or
 * is absurdly long, we fall back to a friendly generic.
 */
function extractErrorMessage(err: unknown, fallback: string): string {
  const status = getStatus(err)
  const raw = readMessage(err)

  // Status-first friendly messages
  if (status === 401) return 'Incorrect email or password.'
  if (status === 403) return 'You don\u2019t have access to this account.'
  if (status === 404) return 'Account not found.'
  if (status === 409) return 'An account with that email already exists.'
  if (status === 429) return 'Too many attempts. Try again in a minute.'
  if (status === 0 || status === undefined) {
    // Likely network / CORS / server down
    if (!raw) return 'We couldn\u2019t reach the server. Please try again.'
  }
  if (status && status >= 500) return 'Our servers hit a snag. Please try again.'

  if (!raw) return fallback

  // Never show stack traces / internal paths.
  if (isLikelyStackTrace(raw)) return fallback

  // Strip surrounding whitespace and hard-cap length.
  const cleaned = raw.trim().replace(/\s+/g, ' ')
  return cleaned.length > 160 ? cleaned.slice(0, 160).trimEnd() + '\u2026' : cleaned
}

function readMessage(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const data = (err as { response?: { data?: unknown } }).response?.data
  if (typeof data === 'string') return data
  if (data && typeof data === 'object' && 'message' in data) {
    const m = (data as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  const top = (err as { message?: unknown }).message
  return typeof top === 'string' ? top : undefined
}

function getStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const s = (err as { response?: { status?: number } }).response?.status
  return typeof s === 'number' ? s : undefined
}

function isLikelyStackTrace(s: string): boolean {
  // Heuristics: multi-line, contains "at ", "Require stack", or filesystem paths.
  return (
    s.length > 220 ||
    /\bRequire stack\b/i.test(s) ||
    /\n\s+at /.test(s) ||
    /node_modules/.test(s) ||
    /\/Users\//.test(s) ||
    /\.ts:\d+|\.js:\d+/.test(s)
  )
}
