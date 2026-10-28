'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, ShieldCheck, Loader2, CheckCircle2 } from 'lucide-react'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

const ACK_LABELS = {
  baa: 'I will execute a Business Associate Agreement (BAA) before processing PHI',
  hipaa: 'I will follow HIPAA requirements for clinical data handling',
  dataResidency: 'I understand patient data is stored in US data centers',
  refundPolicy: 'I have reviewed the refund and cancellation policy',
  authorizedSignatory: 'I am authorized to bind this clinic to this agreement',
} as const

type AckKey = keyof typeof ACK_LABELS

interface FormState {
  legalName: string
  taxId: string
  primaryContactName: string
  primaryContactEmail: string
  mailingAddress: string
  estimatedSeats: number
  acknowledgements: Record<AckKey, boolean>
}

const ACK_KEYS: AckKey[] = ['baa', 'hipaa', 'dataResidency', 'refundPolicy', 'authorizedSignatory']

export default function AgreementPage() {
  const router = useRouter()
  const { user, refetchUser } = useAuth()
  const clinicName = user?.clinic?.tenant?.name ?? user?.clinic?.name ?? 'your clinic'

  const [form, setForm] = React.useState<FormState>(() => ({
    legalName: '',
    taxId: '',
    primaryContactName: user?.name ?? '',
    primaryContactEmail: user?.email ?? '',
    mailingAddress: '',
    estimatedSeats: 5,
    acknowledgements: {
      baa: false,
      hipaa: false,
      dataResidency: false,
      refundPolicy: false,
      authorizedSignatory: false,
    },
  }))
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [confirmText, setConfirmText] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const allAcked = ACK_KEYS.every((k) => form.acknowledgements[k])
  const formValid =
    form.legalName.trim().length >= 2 &&
    form.taxId.trim().length >= 2 &&
    form.primaryContactName.trim().length >= 2 &&
    /^\S+@\S+\.\S+$/.test(form.primaryContactEmail) &&
    form.mailingAddress.trim().length >= 5 &&
    form.estimatedSeats >= 1 &&
    allAcked

  const confirmMatches = confirmText.trim().toLowerCase() === clinicName.trim().toLowerCase()

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formValid) return
    setShowConfirm(true)
    setConfirmText('')
    setError(null)
  }

  const onConfirm = async () => {
    if (!confirmMatches || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/onboarding/agreement', {
        legalName: form.legalName.trim(),
        taxId: form.taxId.trim(),
        primaryContactName: form.primaryContactName.trim(),
        primaryContactEmail: form.primaryContactEmail.trim(),
        mailingAddress: form.mailingAddress.trim(),
        estimatedSeats: form.estimatedSeats,
        confirmClinicName: confirmText.trim(),
        acknowledgements: form.acknowledgements,
      })
      await refetchUser()
      router.replace('/welcome')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not save the agreement. Please try again.'
      setError(msg)
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-6 md:px-8 md:py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/agreement" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 shadow-md">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-slate-900">MedoFlow</span>
        </Link>
        <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          <ShieldCheck className="h-3.5 w-3.5" />
          Service agreement
        </span>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white shadow-xl">
        <div className="px-6 py-7 md:px-10 md:py-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
            Before we set up your clinic
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
            Service agreement for {clinicName}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 md:text-base">
            Confirm the legal entity behind your clinic and acknowledge the compliance terms. Once
            submitted you'll continue to the setup wizard.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-6">
            <section className="grid gap-4 md:grid-cols-2">
              <Field label="Legal entity name" required>
                <input
                  type="text"
                  value={form.legalName}
                  onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                  className="input"
                  placeholder="Acme Wellness LLC"
                  required
                />
              </Field>
              <Field label="EIN / Tax ID" required>
                <input
                  type="text"
                  value={form.taxId}
                  onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                  className="input"
                  placeholder="12-3456789"
                  required
                />
              </Field>
              <Field label="Primary contact name" required>
                <input
                  type="text"
                  value={form.primaryContactName}
                  onChange={(e) => setForm({ ...form, primaryContactName: e.target.value })}
                  className="input"
                  required
                />
              </Field>
              <Field label="Primary contact email" required>
                <input
                  type="email"
                  value={form.primaryContactEmail}
                  onChange={(e) => setForm({ ...form, primaryContactEmail: e.target.value })}
                  className="input"
                  required
                />
              </Field>
              <Field label="Mailing address" required className="md:col-span-2">
                <input
                  type="text"
                  value={form.mailingAddress}
                  onChange={(e) => setForm({ ...form, mailingAddress: e.target.value })}
                  className="input"
                  placeholder="Street, city, state, ZIP"
                  required
                />
              </Field>
              <Field label="Estimated seat count" required>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={form.estimatedSeats}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      estimatedSeats: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  className="input"
                  required
                />
                <p className="mt-1 text-xs text-slate-500">
                  Doctors, front desk, and admins combined. You can change this later.
                </p>
              </Field>
            </section>

            <section className="rounded-2xl border border-slate-100 bg-slate-50/60 p-5">
              <h2 className="text-sm font-semibold text-slate-900">Acknowledgements</h2>
              <p className="mt-1 text-xs text-slate-500">
                Each item must be checked individually. We do not bundle these into a single "I
                agree" because they're material to the agreement.
              </p>
              <ul className="mt-4 space-y-3">
                {ACK_KEYS.map((key) => (
                  <li key={key}>
                    <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={form.acknowledgements[key]}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            acknowledgements: {
                              ...form.acknowledgements,
                              [key]: e.target.checked,
                            },
                          })
                        }
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{ACK_LABELS[key]}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            <div className="flex flex-col-reverse items-stretch gap-3 border-t border-slate-100 pt-6 md:flex-row md:items-center md:justify-between">
              <p className="text-xs text-slate-500">
                You'll be asked to retype the clinic name to confirm before we save this.
              </p>
              <button
                type="submit"
                disabled={!formValid}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Approve &amp; continue
              </button>
            </div>
          </form>
        </div>
      </div>

      {showConfirm && (
        <ConfirmAgreementModal
          clinicName={clinicName}
          confirmText={confirmText}
          setConfirmText={setConfirmText}
          confirmMatches={confirmMatches}
          submitting={submitting}
          error={error}
          onCancel={() => {
            if (submitting) return
            setShowConfirm(false)
            setConfirmText('')
            setError(null)
          }}
          onConfirm={onConfirm}
        />
      )}

      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.625rem;
          border: 1px solid rgb(226 232 240);
          background: white;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: rgb(15 23 42);
        }
        .input:focus {
          outline: none;
          border-color: rgb(99 102 241);
          box-shadow: 0 0 0 3px rgb(199 210 254 / 0.5);
        }
      `}</style>
    </div>
  )
}

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={`block text-sm ${className ?? ''}`}>
      <span className="mb-1 block font-medium text-slate-800">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
    </label>
  )
}

function ConfirmAgreementModal({
  clinicName,
  confirmText,
  setConfirmText,
  confirmMatches,
  submitting,
  error,
  onCancel,
  onConfirm,
}: {
  clinicName: string
  confirmText: string
  setConfirmText: (v: string) => void
  confirmMatches: boolean
  submitting: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-lg">
        <div className="border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-indigo-600" />
            <h3 className="text-base font-semibold text-slate-900">Confirm agreement</h3>
          </div>
        </div>
        <div className="space-y-4 px-6 py-5">
          <p className="text-sm leading-relaxed text-slate-700">
            By confirming, you place this agreement on file for <strong>{clinicName}</strong>. We'll
            email a copy to your inbox for your records.
          </p>
          <p className="text-sm text-slate-700">
            To confirm, retype the clinic name exactly as it appears:
          </p>
          <div>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              disabled={submitting}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-60"
              placeholder={clinicName}
            />
            <p className="mt-1 text-xs text-slate-500">
              Expected: <span className="font-mono">{clinicName}</span>
            </p>
          </div>
          {error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
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
            {submitting ? 'Saving…' : 'Confirm & save'}
          </button>
        </div>
      </div>
    </div>
  )
}
