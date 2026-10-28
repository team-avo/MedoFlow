'use client'

import * as React from 'react'
import { Loader2, Save, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react'
import api from '@/lib/api'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

interface ScribeTemplate {
  id: string
  name: string
  specialty: string
  description: string | null
  isDefault: boolean
  clinicId: string | null
}

interface Profile {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  bio: string | null
  headshotUrl: string | null
  signatureUrl: string | null
  licenseNumber: string | null
  languages: string[]
  scribeTemplateId: string | null
  scribeTone: 'CONCISE' | 'DETAILED'
  scribeIncludeCoding: boolean
  scribeTemplate: {
    id: string
    name: string
    specialty: string
    description: string | null
  } | null
}

export default function ProviderProfilePage() {
  const [profile, setProfile] = React.useState<Profile | null>(null)
  const [templates, setTemplates] = React.useState<ScribeTemplate[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [languagesText, setLanguagesText] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [pRes, tRes] = await Promise.all([
          api.get<{ success: boolean; data: Profile }>('/providers/me/profile'),
          api.get<{ success: boolean; data: { items: ScribeTemplate[] } }>(
            '/providers/me/scribe-templates'
          ),
        ])
        if (cancelled) return
        setProfile(pRes.data.data)
        setLanguagesText(pRes.data.data.languages.join(', '))
        setTemplates(tRes.data.data.items)
      } catch (e: unknown) {
        if (cancelled) return
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          'Could not load your profile'
        setError(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const setField = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setProfile((p) => (p ? { ...p, [key]: value } : p))
    setSaved(false)
  }

  const onSave = async () => {
    if (!profile || saving) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const langs = languagesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20)
      const { data } = await api.put<{ success: boolean; data: Profile }>('/providers/me/profile', {
        bio: profile.bio,
        headshotUrl: profile.headshotUrl,
        signatureUrl: profile.signatureUrl,
        licenseNumber: profile.licenseNumber,
        languages: langs,
        phone: profile.phone,
        scribeTemplateId: profile.scribeTemplateId,
        scribeTone: profile.scribeTone,
        scribeIncludeCoding: profile.scribeIncludeCoding,
      })
      setProfile((prev) => (prev ? { ...prev, ...data.data } : prev))
      setSaved(true)
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not save'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-8">
        <LoadingSkeleton variant="page" />
      </div>
    )
  }
  if (error && !profile) {
    return (
      <div className="m-8 rounded-lg bg-rose-50 p-4 text-sm text-rose-700">
        <AlertCircle className="mr-1 inline h-4 w-4" />
        {error}
      </div>
    )
  }
  if (!profile) return null

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">My profile</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          {profile.firstName} {profile.lastName}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          What appears on the clinic site, the visit summary, and how AI Scribe writes your notes.
        </p>
      </header>

      {/* Public profile */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Public profile</h2>
        <p className="mt-1 text-xs text-slate-500">
          Shown on the clinic's patient-facing website and booking pages.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Bio" className="md:col-span-2">
            <textarea
              rows={4}
              value={profile.bio ?? ''}
              onChange={(e) => setField('bio', e.target.value)}
              className="input"
              placeholder="Tell patients about your training, focus areas, and approach."
            />
          </Field>
          <Field label="Headshot URL">
            <input
              type="text"
              value={profile.headshotUrl ?? ''}
              onChange={(e) => setField('headshotUrl', e.target.value || null)}
              className="input"
              placeholder="https://…"
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              value={profile.phone ?? ''}
              onChange={(e) => setField('phone', e.target.value || null)}
              className="input"
            />
          </Field>
          <Field label="License number">
            <input
              type="text"
              value={profile.licenseNumber ?? ''}
              onChange={(e) => setField('licenseNumber', e.target.value || null)}
              className="input"
            />
          </Field>
          <Field label="Languages (comma separated)">
            <input
              type="text"
              value={languagesText}
              onChange={(e) => {
                setLanguagesText(e.target.value)
                setSaved(false)
              }}
              className="input"
              placeholder="English, Hindi, Spanish"
            />
          </Field>
          <Field label="Signature image URL" className="md:col-span-2">
            <input
              type="text"
              value={profile.signatureUrl ?? ''}
              onChange={(e) => setField('signatureUrl', e.target.value || null)}
              className="input"
              placeholder="Used on prescriptions, invoices, and signed-off notes."
            />
          </Field>
        </div>
      </section>

      {/* AI Scribe preferences */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold text-slate-900">AI Scribe preferences</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Pick the specialty template that best matches your visits. The note structure stays the
          same; the clinical guidance changes.
        </p>

        <div className="mt-4 grid gap-4">
          <Field label="Specialty template">
            <select
              value={profile.scribeTemplateId ?? ''}
              onChange={(e) => setField('scribeTemplateId', e.target.value || null)}
              className="input"
            >
              <option value="">Use clinic default</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.clinicId === null ? ' (platform default)' : ''}
                </option>
              ))}
            </select>
            {profile.scribeTemplate?.description && (
              <p className="mt-1 text-xs text-slate-500">{profile.scribeTemplate.description}</p>
            )}
          </Field>
          <Field label="Tone">
            <div className="flex gap-2">
              {(['CONCISE', 'DETAILED'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setField('scribeTone', t)}
                  className={
                    profile.scribeTone === t
                      ? 'rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white'
                      : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200'
                  }
                >
                  {t === 'CONCISE' ? 'Concise' : 'Detailed'}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Concise = short bullets per section. Detailed = full prose, more context.
            </p>
          </Field>
          <label className="flex items-start gap-3 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={profile.scribeIncludeCoding}
              onChange={(e) => setField('scribeIncludeCoding', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>
              <span className="font-medium">Suggest ICD-10 / CPT codes</span>
              <span className="block text-xs text-slate-500">
                After the SOAP note is generated, propose billing codes you can accept with one
                click.
              </span>
            </span>
          </label>
        </div>
      </section>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {saved && (
        <p className="inline-flex items-center gap-1 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> Saved
        </p>
      )}

      <div className="sticky bottom-4 flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-lg hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
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
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={`block text-sm ${className ?? ''}`}>
      <span className="mb-1 block font-medium text-slate-800">{label}</span>
      {children}
    </label>
  )
}
