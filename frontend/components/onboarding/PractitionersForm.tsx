'use client'

import * as React from 'react'
import { Loader2, Plus, Stethoscope, Trash2 } from 'lucide-react'
import { AppFormField, AppInput } from '@/components/ui-system'
import { apiErrorOf } from '@/lib/apiError'
import { onboardingApi, type Application } from '@/lib/onboardingApi'
import { isValidNpi, US_STATES } from '@/lib/practiceIds'
import {
  emptyPractitioner,
  practitionersValid,
  toPractitionerDraft,
  toPractitionerPayload,
  validatePractitioners,
  type PractitionerDraft,
  type PractitionerErrors,
} from '@/lib/schemas/onboarding'
import { IdCheck, selectClass } from './ApplicationShell'

/**
 * The practice's licensed practitioners — step 2 of the clinic application and
 * the "Practitioners" tab of /dashboard/clinic. One is the owner on record;
 * "This is me" links a row to the signed-in owner (their NPI and license are
 * copied to their provider profile when they add themselves as a provider).
 */
export function PractitionersForm({
  application,
  owner,
  submitLabel = 'Save & continue',
  onSaved,
}: {
  application: Application | null
  owner?: { name?: string; email?: string }
  submitLabel?: string
  onSaved: (app: Application) => void | Promise<void>
}) {
  const npiRequired = !application?.profile?.noNpi
  const [rows, setRows] = React.useState<PractitionerDraft[]>(() => {
    const saved = application?.profile?.practitioners ?? []
    if (saved.length) return saved.map(toPractitionerDraft)
    return [
      {
        ...emptyPractitioner(),
        name: owner?.name ?? '',
        email: owner?.email ?? '',
        isOwner: true,
        isSelf: true,
      },
    ]
  })
  const [touched, setTouched] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [serverError, setServerError] = React.useState<string | null>(null)

  const validation = validatePractitioners(rows, npiRequired)
  const show: ReturnType<typeof validatePractitioners> = touched
    ? validation
    : { rows: rows.map(() => ({})), list: null }

  const update = (i: number, patch: Partial<PractitionerDraft>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const setOwner = (i: number) =>
    setRows((prev) => prev.map((r, j) => ({ ...r, isOwner: j === i })))
  const setSelf = (i: number, on: boolean) =>
    setRows((prev) =>
      prev.map((r, j) => {
        if (j !== i) return on ? { ...r, isSelf: false } : r
        if (!on) return { ...r, isSelf: false }
        return {
          ...r,
          isSelf: true,
          name: r.name || owner?.name || '',
          email: r.email || owner?.email || '',
        }
      })
    )

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    setServerError(null)
    if (!practitionersValid(validation)) return
    setSaving(true)
    try {
      const app = await onboardingApi.savePractitioners(rows.map(toPractitionerPayload))
      await onSaved(app)
    } catch (err) {
      setServerError(apiErrorOf(err).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label="Practitioners">
      {rows.map((r, i) => {
        const e: PractitionerErrors = show.rows[i] ?? {}
        return (
          <fieldset
            key={i}
            className="rounded-2xl border border-slate-100 bg-slate-50/40 p-5"
            data-testid={`practitioner-${i}`}
          >
            <legend className="sr-only">Practitioner {i + 1}</legend>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                  <Stethoscope className="h-4 w-4" />
                </div>
                <p className="text-sm font-semibold text-slate-900">Practitioner {i + 1}</p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="ownerOnRecord"
                    checked={r.isOwner}
                    onChange={() => setOwner(i)}
                  />
                  Owner on record
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={r.isSelf}
                    onChange={(ev) => setSelf(i, ev.target.checked)}
                  />
                  This is me
                </label>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <AppFormField label="Full name" required error={e.name} htmlFor={`p${i}-name`}>
                <AppInput
                  id={`p${i}-name`}
                  value={r.name}
                  onChange={(ev) => update(i, { name: ev.target.value })}
                  placeholder="Dr Jane Smith"
                />
              </AppFormField>
              <AppFormField label="Credentials" error={e.credentials} htmlFor={`p${i}-cred`}>
                <AppInput
                  id={`p${i}-cred`}
                  value={r.credentials}
                  onChange={(ev) => update(i, { credentials: ev.target.value })}
                  placeholder="MD, ND, DC, NP…"
                />
              </AppFormField>
              <AppFormField label="Email" required error={e.email} htmlFor={`p${i}-email`}>
                <AppInput
                  id={`p${i}-email`}
                  type="email"
                  value={r.email}
                  onChange={(ev) => update(i, { email: ev.target.value })}
                />
              </AppFormField>
              <AppFormField label="Direct phone" error={e.phone} htmlFor={`p${i}-phone`}>
                <AppInput
                  id={`p${i}-phone`}
                  type="tel"
                  value={r.phone}
                  onChange={(ev) => update(i, { phone: ev.target.value })}
                />
              </AppFormField>
              <AppFormField
                label="Individual NPI #"
                required={npiRequired}
                error={e.npi}
                htmlFor={`p${i}-npi`}
              >
                <AppInput
                  id={`p${i}-npi`}
                  inputMode="numeric"
                  value={r.npi}
                  onChange={(ev) => update(i, { npi: ev.target.value })}
                  placeholder="10 digits"
                />
                <IdCheck value={r.npi} valid={isValidNpi(r.npi)} label="NPI" />
              </AppFormField>
              <div className="grid grid-cols-2 gap-3">
                <AppFormField label="License #" error={e.licenseNumber} htmlFor={`p${i}-lic`}>
                  <AppInput
                    id={`p${i}-lic`}
                    value={r.licenseNumber}
                    onChange={(ev) => update(i, { licenseNumber: ev.target.value })}
                  />
                </AppFormField>
                <AppFormField label="State" error={e.licenseState} htmlFor={`p${i}-state`}>
                  <select
                    id={`p${i}-state`}
                    className={selectClass}
                    value={r.licenseState}
                    onChange={(ev) => update(i, { licenseState: ev.target.value })}
                  >
                    <option value="">—</option>
                    {US_STATES.map(([code]) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </AppFormField>
              </div>
            </div>
          </fieldset>
        )
      })}

      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, emptyPractitioner()])}
        disabled={rows.length >= 20}
        className="inline-flex items-center gap-2 rounded-full border border-dashed border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> Add practitioner
      </button>

      {show.list && (
        <p role="alert" className="text-sm text-rose-600">
          {show.list}
        </p>
      )}
      {serverError && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {serverError}
        </p>
      )}

      <div className="flex justify-end border-t border-slate-100 pt-6">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
