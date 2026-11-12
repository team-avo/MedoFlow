'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Loader2, PenLine } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { AppErrorState, AppFormField, AppInput, LoadingSkeleton } from '@/components/ui-system'
import { ApplicationShell } from '@/components/onboarding/ApplicationShell'
import { useApplication } from '@/components/onboarding/useApplication'
import { apiErrorOf } from '@/lib/apiError'
import {
  ACKNOWLEDGEMENTS,
  ACKNOWLEDGEMENT_KEYS,
  COMMUNICATIONS_AUTHORIZATION,
  onboardingApi,
  type AcknowledgementKey,
  type Application,
} from '@/lib/onboardingApi'
import { PRACTICE_TYPES } from '@/lib/practiceIds'
import { signatureMatches } from '@/lib/schemas/onboarding'

const practiceTypeLabel = (key: string) => PRACTICE_TYPES.find(([k]) => k === key)?.[1] ?? key

/** Clinic application, step 3 — review, acknowledge, sign and submit. */
export default function AgreementPage() {
  const router = useRouter()
  const { user, refetchUser } = useAuth()
  const { data, isLoading, isError, refetch } = useApplication()
  const clinicName = user?.clinic?.tenant?.name ?? user?.clinic?.name ?? 'your clinic'

  const [acks, setAcks] = React.useState<Record<AcknowledgementKey, boolean>>({
    baa: false,
    hipaa: false,
    dataResidency: false,
    refundPolicy: false,
    authorizedSignatory: false,
  })
  const [communications, setCommunications] = React.useState(false)
  const [signerName, setSignerName] = React.useState(user?.name ?? '')
  const [signerTitle, setSignerTitle] = React.useState('')
  const [signature, setSignature] = React.useState('')
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [confirmText, setConfirmText] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const allAcked = ACKNOWLEDGEMENT_KEYS.every((k) => acks[k])
  const signed = signatureMatches(signature, signerName)
  const formValid =
    allAcked &&
    communications &&
    signerName.trim().length >= 2 &&
    signerTitle.trim().length >= 2 &&
    signed
  const confirmMatches = confirmText.trim().toLowerCase() === clinicName.trim().toLowerCase()
  const today = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const onConfirm = async () => {
    if (!confirmMatches || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onboardingApi.signAgreement({
        acknowledgements: acks,
        communications,
        signerName: signerName.trim(),
        signerTitle: signerTitle.trim(),
        signature: signature.trim(),
        confirmClinicName: confirmText.trim(),
      })
      await refetchUser()
      router.replace('/dashboard')
    } catch (err) {
      setError(apiErrorOf(err).message)
      setSubmitting(false)
    }
  }

  return (
    <ApplicationShell
      stepKey="agreement"
      title={`Service agreement for ${clinicName}`}
      subtitle="Check your application, acknowledge the compliance terms and sign. Submitting sends the application to our team for review."
    >
      <Link
        href="/practitioners"
        className="mb-6 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Practitioners
      </Link>

      {isLoading ? (
        <LoadingSkeleton variant="card" count={2} />
      ) : isError || !data ? (
        <AppErrorState title="Couldn't load your application" onRetry={() => void refetch()} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!formValid) return
            setConfirmText('')
            setError(null)
            setShowConfirm(true)
          }}
          className="space-y-8"
          aria-label="Service agreement"
        >
          <ApplicationSummary app={data} />

          <section className="rounded-2xl border border-slate-100 bg-slate-50/60 p-5">
            <h2 className="text-sm font-semibold text-slate-900">Acknowledgements</h2>
            <p className="mt-1 text-xs text-slate-500">
              Each item is checked on its own — they are material terms, not a single &quot;I
              agree&quot;.
            </p>
            <ul className="mt-4 space-y-3">
              {ACKNOWLEDGEMENT_KEYS.map((key) => (
                <li key={key}>
                  <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      checked={acks[key]}
                      onChange={(e) => setAcks({ ...acks, [key]: e.target.checked })}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                    <span>{ACKNOWLEDGEMENTS[key]}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-4 rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center gap-2">
              <PenLine className="h-4 w-4 text-indigo-600" />
              <h2 className="text-sm font-semibold text-slate-900">Authorization</h2>
            </div>
            <p className="text-sm leading-relaxed text-slate-600">{COMMUNICATIONS_AUTHORIZATION}</p>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={communications}
                onChange={(e) => setCommunications(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              <span>I have read and agree to the authorization above.</span>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <AppFormField label="Print name" required htmlFor="signerName">
                <AppInput
                  id="signerName"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                />
              </AppFormField>
              <AppFormField label="Title" required htmlFor="signerTitle">
                <AppInput
                  id="signerTitle"
                  value={signerTitle}
                  onChange={(e) => setSignerTitle(e.target.value)}
                  placeholder="Owner, Medical Director…"
                />
              </AppFormField>
              <AppFormField
                label="Signature (type your name)"
                required
                htmlFor="signature"
                error={signature && !signed ? 'Type your name exactly as printed' : undefined}
              >
                <AppInput
                  id="signature"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  className="font-serif text-lg italic"
                  autoComplete="off"
                />
              </AppFormField>
              <AppFormField label="Date signed" htmlFor="signedDate">
                <AppInput id="signedDate" value={today} readOnly disabled />
              </AppFormField>
            </div>
          </section>

          <div className="flex flex-col-reverse items-stretch gap-3 border-t border-slate-100 pt-6 md:flex-row md:items-center md:justify-between">
            <p className="text-xs text-slate-500">
              You&apos;ll retype the clinic name to confirm. A copy is emailed to you.
            </p>
            <button
              type="submit"
              disabled={!formValid}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Sign &amp; submit application
            </button>
          </div>
        </form>
      )}

      {showConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-agreement-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-8"
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
              <CheckCircle2 className="h-5 w-5 text-indigo-600" />
              <h3 id="confirm-agreement-title" className="text-base font-semibold text-slate-900">
                Confirm and submit
              </h3>
            </div>
            <div className="space-y-4 px-6 py-5">
              <p className="text-sm leading-relaxed text-slate-700">
                This signs the agreement for <strong>{clinicName}</strong> and sends the application
                for review. To confirm, retype the clinic name exactly as it appears:
              </p>
              <AppInput
                aria-label="Clinic name"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoFocus
                disabled={submitting}
                placeholder={clinicName}
              />
              <p className="text-xs text-slate-500">
                Expected: <span className="font-mono">{clinicName}</span>
              </p>
              {error && (
                <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
              <button
                type="button"
                onClick={() => !submitting && setShowConfirm(false)}
                disabled={submitting}
                className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!confirmMatches || submitting}
                className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? 'Submitting…' : 'Confirm & submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ApplicationShell>
  )
}

function ApplicationSummary({ app }: { app: Application }) {
  const p = app.profile
  const l = app.location
  if (!p) return null
  const owner = p.practitioners.find((x) => x.isOwner)
  const rows: [string, React.ReactNode][] = [
    ['Legal name', p.legalName],
    ['Practice name / DBA', p.dbaName ?? 'Same as legal name'],
    ['Practice type', practiceTypeLabel(p.practiceType)],
    [
      'Primary location',
      l
        ? [l.addressLine1, l.addressLine2, l.city, l.state, l.postalCode].filter(Boolean).join(', ')
        : '—',
    ],
    ['Group NPI', p.noNpi ? 'No NPI' : (p.groupNpi ?? '—')],
    ['Federal Tax ID', p.federalTaxIdMasked ?? '—'],
    ['State license', p.licenseNumber ? `${p.licenseNumber} (${p.licenseState ?? '—'})` : '—'],
    ['DEA', p.deaNumberMasked ?? 'None'],
    [
      'Practitioners',
      `${p.practitioners.length}${owner ? ` · owner on record: ${owner.name}` : ''}`,
    ],
  ]
  return (
    <section className="rounded-2xl border border-slate-100 p-5" aria-label="Application summary">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Your application</h2>
        <div className="flex gap-3 text-xs font-medium text-indigo-600">
          <Link href="/practice" className="hover:underline">
            Edit practice
          </Link>
          <Link href="/practitioners" className="hover:underline">
            Edit practitioners
          </Link>
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-slate-50 py-1">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right font-medium text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
