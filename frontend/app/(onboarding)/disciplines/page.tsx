'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Plus, X } from 'lucide-react'
import api from '@/lib/api'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { AppInput } from '@/components/ui-system'
import { clientLog } from '@/lib/clientLog'

const SUGGESTED = [
  'Longevity',
  'Functional Medicine',
  'Dermatology',
  'Aesthetics',
  'Weight Loss',
  'Hormone Therapy',
  'IV Therapy',
  'Primary Care',
] as const

export default function DisciplinesStepPage() {
  const router = useRouter()
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [customInput, setCustomInput] = React.useState('')
  const [customList, setCustomList] = React.useState<string[]>([])

  // Pre-populate if user has disciplines already
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/disciplines')
        const existing = data?.data?.disciplines ?? data?.data ?? []
        if (!cancelled && Array.isArray(existing) && existing.length > 0) {
          const names = existing.map((d: any) => d.name as string)
          const preset = new Set(
            names.filter((n: string) => (SUGGESTED as readonly string[]).includes(n))
          )
          const custom = names.filter((n: string) => !(SUGGESTED as readonly string[]).includes(n))
          setSelected(preset)
          setCustomList(custom)
        }
      } catch {
        /* noop */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const addCustom = () => {
    const val = customInput.trim()
    if (!val) return
    if (customList.includes(val) || selected.has(val)) {
      setCustomInput('')
      return
    }
    setCustomList((prev) => [...prev, val])
    setCustomInput('')
  }

  const removeCustom = (name: string) => setCustomList((prev) => prev.filter((n) => n !== name))

  const total = selected.size + customList.length

  return (
    <OnboardingShell
      stepKey="disciplines"
      title="What kinds of care do you provide?"
      subtitle="Pick what applies. This shapes the services you'll offer next."
      nextLabel="Save & continue"
      nextDisabled={total === 0}
      onNext={async () => {
        const payload = [...Array.from(selected), ...customList]
        for (const name of payload) {
          try {
            await api.post('/disciplines', { name })
          } catch (err) {
            // Skip duplicates silently — 409 is fine for resume flows
            // eslint-disable-next-line no-console
            clientLog.warn('[disciplines] create failed', err)
          }
        }
        await api.patch('/onboarding/step', { step: 4 })
        router.push('/services')
      }}
    >
      <div className="flex flex-wrap gap-2">
        {SUGGESTED.map((d) => {
          const active = selected.has(d)
          return (
            <button
              key={d}
              type="button"
              onClick={() => toggle(d)}
              className={
                active
                  ? 'inline-flex items-center gap-1.5 rounded-full border border-indigo-600 bg-indigo-600 px-4 py-2 text-sm font-medium text-white'
                  : 'inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-indigo-400'
              }
            >
              {active && <Check className="h-3.5 w-3.5" />}
              {d}
            </button>
          )
        })}
      </div>

      <div className="mt-8">
        <p className="mb-2 text-sm font-medium text-slate-700">Add a custom discipline</p>
        <div className="flex gap-2">
          <AppInput
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCustom()
              }
            }}
            placeholder="e.g. Chiropractic"
            className="flex-1"
          />
          <button
            type="button"
            onClick={addCustom}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-indigo-400"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>

        {customList.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {customList.map((n) => (
              <span
                key={n}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
              >
                {n}
                <button
                  type="button"
                  onClick={() => removeCustom(n)}
                  className="text-slate-500 hover:text-rose-600"
                  aria-label={`Remove ${n}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </OnboardingShell>
  )
}
