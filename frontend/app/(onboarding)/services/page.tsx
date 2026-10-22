'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Plus, Sparkles } from 'lucide-react'
import api from '@/lib/api'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { AppFormField, AppInput } from '@/components/ui-system'
import { clientLog } from '@/lib/clientLog'

interface Discipline {
  id: string
  name: string
}

interface ServiceDraft {
  tempId: string
  disciplineId: string
  disciplineName: string
  name: string
  duration: number
  defaultPrice: number
  // set to the real id after successful create so we don't double-post on resume
  createdId?: string
}

// Seed templates keyed by discipline (lowercased, stripped)
const STARTERS: Record<string, Array<{ name: string; duration: number; price: number }>> = {
  longevity: [
    { name: 'Initial Consult', duration: 60, price: 300 },
    { name: 'Follow-up Visit', duration: 30, price: 150 },
    { name: 'NAD+ IV Therapy', duration: 45, price: 450 },
  ],
  'functional medicine': [
    { name: 'Comprehensive Intake', duration: 90, price: 395 },
    { name: '30-min Follow-up', duration: 30, price: 150 },
    { name: 'Lab Review', duration: 45, price: 195 },
  ],
  dermatology: [
    { name: 'Skin Assessment', duration: 30, price: 175 },
    { name: 'Acne Treatment', duration: 45, price: 225 },
    { name: 'Full Body Screening', duration: 60, price: 350 },
  ],
  aesthetics: [
    { name: 'Botox Treatment', duration: 30, price: 450 },
    { name: 'Dermal Filler', duration: 45, price: 650 },
    { name: 'Chemical Peel', duration: 60, price: 250 },
  ],
  'weight loss': [
    { name: 'Initial Weight Consult', duration: 60, price: 200 },
    { name: 'Monthly Check-in', duration: 20, price: 95 },
    { name: 'Semaglutide Follow-up', duration: 15, price: 75 },
  ],
  'hormone therapy': [
    { name: 'BHRT Consult', duration: 60, price: 350 },
    { name: 'Pellet Insertion', duration: 30, price: 550 },
    { name: 'Lab Review', duration: 30, price: 150 },
  ],
  'iv therapy': [
    { name: 'Hydration IV', duration: 30, price: 125 },
    { name: 'Myers Cocktail', duration: 45, price: 195 },
    { name: 'Glutathione Push', duration: 20, price: 85 },
  ],
  'primary care': [
    { name: 'Annual Physical', duration: 45, price: 275 },
    { name: 'Sick Visit', duration: 20, price: 125 },
    { name: 'Lab Draw', duration: 15, price: 50 },
  ],
}

function starterFor(name: string): Array<{ name: string; duration: number; price: number }> {
  const key = name.toLowerCase().trim()
  return (
    STARTERS[key] ?? [
      { name: `${name} Consult`, duration: 30, price: 150 },
      { name: `${name} Follow-up`, duration: 20, price: 95 },
    ]
  )
}

export default function ServicesStepPage() {
  const router = useRouter()
  const [disciplines, setDisciplines] = React.useState<Discipline[]>([])
  const [drafts, setDrafts] = React.useState<ServiceDraft[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [dResp, sResp] = await Promise.all([api.get('/disciplines'), api.get('/services')])
        const disc: Discipline[] = dResp.data?.data?.disciplines ?? dResp.data?.data ?? []
        const svcs: any[] = sResp.data?.data?.services ?? sResp.data?.data ?? []
        if (cancelled) return

        setDisciplines(disc)

        const existingNamesPerDiscipline = new Map<string, Set<string>>()
        for (const s of svcs) {
          if (!existingNamesPerDiscipline.has(s.disciplineId)) {
            existingNamesPerDiscipline.set(s.disciplineId, new Set())
          }
          existingNamesPerDiscipline.get(s.disciplineId)!.add(s.name)
        }

        const seededDrafts: ServiceDraft[] = []
        for (const d of disc) {
          const existingSet = existingNamesPerDiscipline.get(d.id) ?? new Set<string>()
          // If there are already services for this discipline, surface them (as
          // already-created rows the user sees but can't edit here).
          for (const s of svcs.filter((x) => x.disciplineId === d.id)) {
            seededDrafts.push({
              tempId: `exist-${s.id}`,
              disciplineId: d.id,
              disciplineName: d.name,
              name: s.name,
              duration: s.duration ?? 30,
              defaultPrice: Number(s.defaultPrice ?? 0),
              createdId: s.id,
            })
          }
          // Seed starters only if nothing exists yet for this discipline
          if (existingSet.size === 0) {
            const starters = starterFor(d.name)
            for (const st of starters) {
              seededDrafts.push({
                tempId: `new-${d.id}-${st.name}`,
                disciplineId: d.id,
                disciplineName: d.name,
                name: st.name,
                duration: st.duration,
                defaultPrice: st.price,
              })
            }
          }
        }
        setDrafts(seededDrafts)
      } catch {
        /* noop */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const update = (tempId: string, patch: Partial<ServiceDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, ...patch } : d)))

  const remove = (tempId: string) => setDrafts((prev) => prev.filter((d) => d.tempId !== tempId))

  const addCustom = (disciplineId: string, disciplineName: string) => {
    const tempId = `new-${disciplineId}-${Date.now()}`
    setDrafts((prev) => [
      ...prev,
      {
        tempId,
        disciplineId,
        disciplineName,
        name: '',
        duration: 30,
        defaultPrice: 100,
      },
    ])
  }

  const grouped = React.useMemo(() => {
    const map = new Map<string, ServiceDraft[]>()
    for (const d of drafts) {
      if (!map.has(d.disciplineId)) map.set(d.disciplineId, [])
      map.get(d.disciplineId)!.push(d)
    }
    return map
  }, [drafts])

  const canContinue = drafts.length > 0 && drafts.every((d) => d.name.trim().length > 0)

  return (
    <OnboardingShell
      stepKey="services"
      title="Add services to your menu"
      subtitle="We pre-filled a few based on your disciplines. Edit prices and durations — or start over."
      nextLabel={loading ? 'Loading…' : 'Save & continue'}
      nextDisabled={!canContinue || loading}
      onNext={async () => {
        const toCreate = drafts.filter((d) => !d.createdId)
        for (const d of toCreate) {
          try {
            await api.post('/services', {
              disciplineId: d.disciplineId,
              name: d.name.trim(),
              duration: d.duration,
              defaultPrice: d.defaultPrice,
            })
          } catch (err) {
            clientLog.warn('[services] create failed', err)
          }
        }
        await api.patch('/onboarding/step', { step: 5 })
        router.push('/providers')
      }}
    >
      {loading ? (
        <p className="text-sm text-slate-500">Loading your disciplines…</p>
      ) : (
        <div className="space-y-6">
          {disciplines.length === 0 && (
            <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              No disciplines yet. Go back one step to add at least one.
            </div>
          )}

          {disciplines.map((d) => {
            const items = grouped.get(d.id) ?? []
            return (
              <div key={d.id} className="rounded-2xl border border-slate-100 bg-slate-50/30 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">{d.name}</h3>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
                    {items.length} service{items.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="space-y-3">
                  {items.map((s) => (
                    <div
                      key={s.tempId}
                      className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end"
                    >
                      <AppFormField label="Name">
                        <AppInput
                          value={s.name}
                          onChange={(e) => update(s.tempId, { name: e.target.value })}
                          disabled={!!s.createdId}
                        />
                      </AppFormField>
                      <AppFormField label="Duration (min)">
                        <AppInput
                          type="number"
                          min={1}
                          value={s.duration}
                          onChange={(e) =>
                            update(s.tempId, {
                              duration: Math.max(1, parseInt(e.target.value, 10) || 30),
                            })
                          }
                          disabled={!!s.createdId}
                        />
                      </AppFormField>
                      <AppFormField label="Price ($)">
                        <AppInput
                          type="number"
                          min={0}
                          step="1"
                          value={s.defaultPrice}
                          onChange={(e) =>
                            update(s.tempId, { defaultPrice: Number(e.target.value) || 0 })
                          }
                          disabled={!!s.createdId}
                        />
                      </AppFormField>
                      {!s.createdId && (
                        <button
                          type="button"
                          onClick={() => remove(s.tempId)}
                          className="inline-flex items-center justify-center rounded-lg p-2 text-rose-500 hover:bg-rose-50"
                          aria-label="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => addCustom(d.id, d.name)}
                  className="mt-3 inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-indigo-400 hover:text-indigo-700"
                >
                  <Plus className="h-3.5 w-3.5" /> Add service
                </button>
              </div>
            )
          })}
        </div>
      )}
    </OnboardingShell>
  )
}
