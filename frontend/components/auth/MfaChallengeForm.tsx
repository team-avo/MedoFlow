'use client'

import React from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import type { User } from '@/lib/types'
import { useAuth, type MfaFactor } from '@/contexts/AuthContext'
import { extractApiError } from '@/lib/apiErrors'

interface Props {
  mfaToken: string
  onVerified: (user: User) => void
  /** The challenge expired or the user wants to start over. */
  onRestart: () => void
}

/**
 * Second sign-in step for MFA-enrolled staff (F0.2.2). A plain <form> with
 * labelled inputs: fully keyboard operable (Tab / Enter), errors announced
 * via role="alert" and tied to the input with aria-describedby.
 */
export function MfaChallengeForm({ mfaToken, onVerified, onRestart }: Props) {
  const { verifyMfa } = useAuth()
  const [useRecovery, setUseRecovery] = React.useState(false)
  const [value, setValue] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [expired, setExpired] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [useRecovery])

  const inputId = useRecovery ? 'mfa-recovery-code' : 'mfa-code'
  const errorId = `${inputId}-error`

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.replace(/\s+/g, '')
    if (!useRecovery && !/^\d{6}$/.test(trimmed)) {
      setError('Enter the 6-digit code from your authenticator app')
      inputRef.current?.focus()
      return
    }
    if (useRecovery && trimmed.length < 8) {
      setError('Enter one of your recovery codes')
      inputRef.current?.focus()
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const factor: MfaFactor = useRecovery ? { recoveryCode: trimmed } : { code: trimmed }
      onVerified(await verifyMfa(mfaToken, factor))
    } catch (err) {
      const { code, message } = extractApiError(err, 'Verification failed')
      if (code === 'mfa_challenge_invalid') setExpired(true)
      setError(code === 'mfa_invalid_code' ? 'That code is not valid. Try again.' : message)
      setValue('')
      inputRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate aria-labelledby="mfa-heading">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700">
          <ShieldCheck className="h-4.5 w-4.5" aria-hidden="true" />
        </span>
        <div>
          <h3 id="mfa-heading" className="text-[15px] font-semibold text-ink">
            Two-step verification
          </h3>
          <p className="text-[12.5px] leading-snug text-ink-muted">
            {useRecovery
              ? 'Enter one of the recovery codes you saved when you turned on two-step verification. Each code works once.'
              : 'Enter the 6-digit code shown in your authenticator app.'}
          </p>
        </div>
      </div>

      {error && (
        <div
          id={errorId}
          role="alert"
          className="rounded-[10px] border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[12.5px] text-destructive"
        >
          {error}
        </div>
      )}

      {expired ? (
        <button
          type="button"
          onClick={onRestart}
          className="mf-btn w-full bg-[#0f766e] text-white hover:bg-[#115e59]"
        >
          Sign in again
        </button>
      ) : (
        <>
          <div>
            <label htmlFor={inputId} className="mf-eyebrow text-ink-muted">
              {useRecovery ? 'Recovery code' : 'Verification code'}
            </label>
            <div className="relative mt-2">
              <KeyRound
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                id={inputId}
                name={inputId}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                maxLength={useRecovery ? 32 : 6}
                pattern={useRecovery ? undefined : '[0-9]*'}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className="h-11 w-full rounded-[10px] border border-hairline bg-white pl-10 pr-3 text-[15px] tracking-[0.2em] text-ink outline-none focus:border-teal focus:ring-2 focus:ring-teal/25"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mf-btn w-full bg-[#0f766e] text-white hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-80"
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>

          <div className="flex items-center justify-between text-[12px]">
            <button
              type="button"
              onClick={() => {
                setUseRecovery((v) => !v)
                setValue('')
                setError(null)
              }}
              className="font-medium text-teal-700 underline-offset-2 hover:underline focus-visible:underline"
            >
              {useRecovery ? 'Use an authenticator code' : 'Use a recovery code'}
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="text-ink-muted underline-offset-2 hover:underline focus-visible:underline"
            >
              Start over
            </button>
          </div>
        </>
      )}
    </form>
  )
}
