'use client'

import * as React from 'react'
import { Loader2, Plus, Stethoscope, Trash2 } from 'lucide-react'
import { AppFormField, AppInput } from '@/components/ui-system'
import { apiErrorOf } from '@/lib/apiError'
import { onboardingApi, type Application } from '@/lib/onboardingApi'
import { isValidNpi, PRACTITIONER_TITLES, US_STATES } from '@/lib/practiceIds'
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
 * Puts the signed-in owner first (CTO-14). Row 0 is always "you": an older
 * saved list without a self row gets one, pre-filled from the account.
 */
export function withOwnerFirst(
  rows: PractitionerDraft[],
  owner?: { name?: string; email?: string }
): PractitionerDraft[] {
  const selfIndex = rows.findIndex((r) => r.isSelf)
  if (selfIndex === 0) return rows
  if (selfIndex > 0) {
    const copy = [...rows]
    const [self] = copy.splice(selfIndex, 1)
    return [self!, ...copy]
  }
  const hasOwner = rows.some((r) => r.isOwner)
  return [
    {
      ...emptyPractitioner(),
      name: owner?.name ?? '',
      email: owner?.email ?? '',
      isOwner: !hasOwner,
      isSelf: true,
    },
    ...rows,
  ]
}

/**
 * The practice's practitioners: step 2 of the clinic application and the
 * "Practitioners" tab of /dashboard/clinic.
 *
 * The owner is usually the clinic's doctor and its admin (CTO-15), so the
 * first row is always them, pre-filled (CTO-14). If they see patients they get
 * a provider profile automatically on save; a non-clinical owner unticks
 * "I see patients". One row is the primary account holder.
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
    if (saved.length) return withOwnerFirst(saved.map(toPractitionerDraft), owner)
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
            <legend className="sr-only">
              {r.isSelf ? 'Your practitioner details' : `Practitioner ${i + 1}`}
            </legend>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                  <Stethoscope className="h-4 w-4" />
                </div>
                <p className="text-sm font-semibold text-slate-900">
                  {r.isSelf ? 'Your practitioner details' : `Practitioner ${i + 1}`}
                </p>
                {r.isSelf && (
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                    You
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
                {r.isSelf && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.seesPatients}
                      onChange={(ev) => update(i, { seesPatients: ev.target.checked })}
                    />
                    I see patients
                  </label>
                )}
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="primaryAccountHolder"
                    checked={r.isOwner}
                    onChange={() => setOwner(i)}
                  />
                  Primary account holder
                </label>
                {!r.isSelf && (
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
            {r.isSelf && (
              <p className="-mt-2 mb-4 text-xs text-slate-500">
                {r.seesPatients
                  ? 'You get a provider profile automatically, so you can take appointments and use AI Scribe.'
                  : 'No provider profile is created for you. Tick "I see patients" if you treat patients here.'}
              </p>
            )}
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
              <AppFormField label="Title" error={e.title} htmlFor={`p${i}-title`}>
                <select
                  id={`p${i}-title`}
                  className={selectClass}
                  value={r.title}
                  onChange={(ev) => update(i, { title: ev.target.value })}
                >
                  <option value="">Choose a title</option>
                  {PRACTITIONER_TITLES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </AppFormField>
              {r.title === 'Other' ? (
                <AppFormField
                  label="Your title"
                  required
                  error={e.titleOther}
                  htmlFor={`p${i}-title-other`}
                >
                  <AppInput
                    id={`p${i}-title-other`}
                    value={r.titleOther}
                    onChange={(ev) => update(i, { titleOther: ev.target.value })}
                    placeholder="e.g. Clinical Director"
                    maxLength={80}
                  />
                </AppFormField>
              ) : (
                <div className="hidden md:block" />
              )}
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
                required={npiRequired && (!r.isSelf || r.seesPatients)}
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
                    <option value="">State</option>
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
