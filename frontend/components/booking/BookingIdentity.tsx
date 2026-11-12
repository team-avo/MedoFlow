'use client'

/**
 * Who the booking is for, on the Review step (demo feedback WS1). Patients
 * book for themselves only, so the details always come from the signed-in
 * profile: never re-typed, and never a password field in the booking form.
 *
 *  - YourDetailsCard: read-only name / email / phone. If the profile has no
 *    phone yet, one inline field saves it to the profile (first entry, once).
 *  - BookingSignInGate: shown instead when nobody is signed in; opens the
 *    shared sign-in / create-account dialog.
 */
import React, { useState } from 'react'
import { Mail, Phone, User as UserIcon, LogIn, UserPlus } from 'lucide-react'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { bookingErrorMessage } from '@/lib/bookingErrors'
import type { User } from '@/lib/types'

/** Same rule as the API's phoneSchema: digits with separators, 7–15 digits. */
export function isValidPhone(value: string): boolean {
  const v = value.trim()
  if (!/^\+?[0-9 ().-]+$/.test(v) || v.length > 32) return false
  const digits = v.replace(/\D/g, '').length
  return digits >= 7 && digits <= 15
}

export function YourDetailsCard({ user, themeColor }: { user: User; themeColor?: string }) {
  const { refetchUser } = useAuth()
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasPhone = !!user.phone

  const savePhone = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValidPhone(phone)) {
      setError('Enter a valid phone number')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.patch('/auth/me', { phone: phone.trim() })
      await refetchUser()
    } catch (err) {
      setError(bookingErrorMessage(err, 'Could not save your phone number'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      aria-labelledby="your-details-heading"
      data-testid="your-details"
      className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-5 text-left"
    >
      <h3
        id="your-details-heading"
        className="text-[11px] font-black uppercase tracking-widest text-slate-400"
      >
        Your details
      </h3>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <UserIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <dt className="sr-only">Name</dt>
          <dd className="font-semibold text-slate-900">{user.name}</dd>
        </div>
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <dt className="sr-only">Email</dt>
          <dd className="text-slate-700">{user.email}</dd>
        </div>
        {hasPhone && (
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <dt className="sr-only">Phone</dt>
            <dd className="text-slate-700">{user.phone}</dd>
          </div>
        )}
      </dl>

      {!hasPhone && (
        <form onSubmit={savePhone} className="mt-4 space-y-2" noValidate>
          <label htmlFor="booking-phone" className="block text-xs font-semibold text-slate-700">
            Add a phone number so the clinic can reach you
          </label>
          <div className="flex gap-2">
            <input
              id="booking-phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="+1 (555) 000-0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? 'booking-phone-error' : undefined}
              className="h-11 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
            />
            <button
              type="submit"
              disabled={saving}
              className="h-11 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-60"
              style={{ backgroundColor: themeColor ?? '#0D9488' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {error && (
            <p id="booking-phone-error" role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <p className="text-[11px] text-slate-400">Saved to your profile for future bookings.</p>
        </form>
      )}
      <p className="mt-3 text-[11px] text-slate-400">
        Booking for yourself. Change these details in your account settings.
      </p>
    </section>
  )
}

export function BookingSignInGate({
  onSignIn,
  onCreateAccount,
  themeColor,
}: {
  onSignIn: () => void
  onCreateAccount: () => void
  themeColor?: string
}) {
  const accent = themeColor ?? '#0D9488'
  return (
    <section
      aria-labelledby="booking-signin-heading"
      data-testid="booking-signin-gate"
      className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center"
    >
      <h3 id="booking-signin-heading" className="text-lg font-bold text-slate-900">
        Sign in or create an account to continue
      </h3>
      <p className="mt-1 text-sm text-slate-500">
        Your appointment is held for you. Your name, email and phone are filled in from your
        account.
      </p>
      <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onSignIn}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold text-white"
          style={{ backgroundColor: accent }}
        >
          <LogIn className="h-4 w-4" aria-hidden /> Sign in
        </button>
        <button
          type="button"
          onClick={onCreateAccount}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-6 text-sm font-bold text-slate-700"
        >
          <UserPlus className="h-4 w-4" aria-hidden /> Create account
        </button>
      </div>
    </section>
  )
}
