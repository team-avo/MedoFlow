'use client'

import React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { CheckCircle2, Copy, ShieldCheck, ShieldOff } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { beginMfaSetup, disableMfa, enableMfa } from '@/lib/mfaApi'
import { extractApiError } from '@/lib/apiErrors'

type Step =
  | { kind: 'idle' }
  | { kind: 'scan'; secret: string; otpauthUrl: string }
  | { kind: 'codes'; recoveryCodes: string[] }
  | { kind: 'disable' }

const inputClass =
  'h-11 w-full rounded-md border border-slate-300 px-3 text-base tracking-[0.2em] text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-300'
const primaryBtn =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2'
const secondaryBtn =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2'

/**
 * MFA enrolment + disable (F0.2.2). Every step is a labelled <form>, so the
 * whole flow works from the keyboard: Tab between controls, Enter submits.
 */
export function MfaSettings() {
  const { user, refetchUser } = useAuth()
  const [step, setStep] = React.useState<Step>({ kind: 'idle' })
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const codeRef = React.useRef<HTMLInputElement>(null)
  const enabled = !!user?.mfaEnabled

  React.useEffect(() => {
    if (step.kind === 'scan' || step.kind === 'disable') codeRef.current?.focus()
  }, [step.kind])

  const reset = () => {
    setStep({ kind: 'idle' })
    setCode('')
    setError(null)
  }

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const { secret, otpauthUrl } = await beginMfaSetup()
      setStep({ kind: 'scan', secret, otpauthUrl })
    } catch (err) {
      setError(extractApiError(err, 'Could not start setup').message)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from your authenticator app')
      codeRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { recoveryCodes } = await enableMfa(code.trim())
      setCode('')
      setStep({ kind: 'codes', recoveryCodes })
      await refetchUser()
    } catch (err) {
      const { code: apiCode, message } = extractApiError(err, 'Could not verify the code')
      setError(
        apiCode === 'mfa_invalid_code' || /invalid/i.test(message)
          ? 'That code is not valid. Try again.'
          : message
      )
      setCode('')
      codeRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = code.replace(/\s+/g, '')
    if (!value) {
      setError('Enter a current code or a recovery code')
      codeRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await disableMfa(/^\d{6}$/.test(value) ? { code: value } : { recoveryCode: value })
      await refetchUser()
      reset()
    } catch (err) {
      setError(extractApiError(err, 'Could not turn off two-step verification').message)
      setCode('')
      codeRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const errorBox = error ? (
    <p
      id="mfa-settings-error"
      role="alert"
      className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
    >
      {error}
    </p>
  ) : null

  return (
    <section
      aria-labelledby="mfa-settings-title"
      className="rounded-xl border border-slate-200 bg-white p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="mfa-settings-title" className="text-base font-semibold text-slate-900">
            Two-step verification
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Require a code from an authenticator app (Google Authenticator, 1Password, Authy…) in
            addition to your password.
          </p>
        </div>
        <span
          data-testid="mfa-status"
          className={
            enabled
              ? 'inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700'
              : 'inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600'
          }
        >
          {enabled ? (
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {enabled ? 'On' : 'Off'}
        </span>
      </div>

      <div className="mt-5 space-y-4">
        {step.kind === 'idle' && (
          <>
            {errorBox}
            {enabled ? (
              <button
                type="button"
                className={secondaryBtn}
                onClick={() => setStep({ kind: 'disable' })}
              >
                Turn off two-step verification
              </button>
            ) : (
              <button type="button" className={primaryBtn} onClick={start} disabled={busy}>
                {busy ? 'Starting…' : 'Set up two-step verification'}
              </button>
            )}
          </>
        )}

        {step.kind === 'scan' && (
          <form
            onSubmit={confirm}
            className="space-y-4"
            noValidate
            aria-label="Confirm authenticator"
          >
            <ol className="list-decimal space-y-3 pl-5 text-sm text-slate-700">
              <li>
                Scan this QR code with your authenticator app.
                <div className="mt-3 inline-block rounded-lg border border-slate-200 bg-white p-3">
                  <QRCodeSVG
                    value={step.otpauthUrl}
                    size={168}
                    title="Authenticator setup QR code"
                  />
                </div>
              </li>
              <li>
                Or enter this key manually:{' '}
                <code
                  data-testid="mfa-secret"
                  className="break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-900"
                >
                  {step.secret}
                </code>
              </li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            {errorBox}
            <div>
              <label htmlFor="mfa-setup-code" className="text-sm font-medium text-slate-800">
                Verification code
              </label>
              <input
                ref={codeRef}
                id="mfa-setup-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'mfa-settings-error' : undefined}
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className={primaryBtn} disabled={busy}>
                {busy ? 'Verifying…' : 'Turn on'}
              </button>
              <button type="button" className={secondaryBtn} onClick={reset}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {step.kind === 'codes' && (
          <div className="space-y-4">
            <p
              className="flex items-center gap-2 text-sm font-medium text-emerald-700"
              role="status"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Two-step verification is on. Other signed-in devices have been signed out.
            </p>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Recovery codes</h3>
              <p className="mt-1 text-sm text-slate-600">
                Each code signs you in once if you lose your phone. Store them somewhere safe — they
                are shown only now.
              </p>
              <ul
                data-testid="recovery-codes"
                className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-4 font-mono text-sm text-slate-900"
              >
                {step.recoveryCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className={secondaryBtn}
                onClick={() => {
                  void navigator.clipboard?.writeText(step.recoveryCodes.join('\n'))
                  setCopied(true)
                }}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                {copied ? 'Copied' : 'Copy codes'}
              </button>
              <button type="button" className={primaryBtn} onClick={reset}>
                I have saved them
              </button>
            </div>
          </div>
        )}

        {step.kind === 'disable' && (
          <form
            onSubmit={turnOff}
            className="space-y-4"
            noValidate
            aria-label="Turn off two-step verification"
          >
            {errorBox}
            <div>
              <label htmlFor="mfa-disable-code" className="text-sm font-medium text-slate-800">
                Current code or a recovery code
              </label>
              <input
                ref={codeRef}
                id="mfa-disable-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'mfa-settings-error' : undefined}
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className={primaryBtn} disabled={busy}>
                {busy ? 'Turning off…' : 'Turn off'}
              </button>
              <button type="button" className={secondaryBtn} onClick={reset}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
