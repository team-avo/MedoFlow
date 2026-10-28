'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, PartyPopper, ArrowRight } from 'lucide-react'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

interface StatusData {
  checklist: {
    brand: boolean
    locations: boolean
    disciplines: boolean
    services: boolean
    providers: boolean
  }
}

export default function DoneStepPage() {
  const router = useRouter()
  const { refetchUser, user } = useAuth()
  const [status, setStatus] = React.useState<StatusData | null>(null)
  const [isFinishing, setIsFinishing] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/onboarding/status')
        if (!cancelled) setStatus(data?.data)
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

  const items = status
    ? [
        { key: 'brand', label: 'Brand (logo + color)', done: status.checklist.brand },
        { key: 'locations', label: 'Location(s)', done: status.checklist.locations },
        { key: 'disciplines', label: 'Discipline(s)', done: status.checklist.disciplines },
        { key: 'services', label: 'Services', done: status.checklist.services },
        { key: 'providers', label: 'Provider(s)', done: status.checklist.providers },
      ]
    : []

  const nameParts = (user?.name ?? '').trim().split(/\s+/)
  const firstName = nameParts.find((p) => !/^(dr|mr|ms|mrs|prof)\.?$/i.test(p)) ?? 'Doctor'

  return (
    <OnboardingShell
      stepKey="done"
      title={`You're set, ${firstName} 🎉`}
      subtitle="Your clinic is live. A product tour will greet you on the dashboard."
      nextLabel={isFinishing ? 'Launching…' : 'Launch dashboard'}
      nextDisabled={isFinishing}
      hideSkip
      onNext={async () => {
        setIsFinishing(true)
        try {
          await api.post('/onboarding/complete')
          await refetchUser()
          router.replace('/dashboard')
        } finally {
          setIsFinishing(false)
        }
      }}
    >
      <div className="relative flex flex-col items-center text-center">
        <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg">
          <PartyPopper className="h-9 w-9" />
        </div>

        <div className="w-full max-w-md rounded-2xl border border-slate-100 bg-slate-50/50 p-5 text-left">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Setup summary
          </p>
          {loading && <LoadingSkeleton variant="text" count={5} className="mt-3" />}
          <ul className="mt-3 space-y-2">
            {items.map((it) => (
              <li key={it.key} className="flex items-center gap-2 text-sm">
                <span
                  className={
                    it.done
                      ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700'
                      : 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-slate-500'
                  }
                >
                  {it.done && <Check className="h-3 w-3" />}
                </span>
                <span className={it.done ? 'text-slate-800' : 'text-slate-500'}>{it.label}</span>
              </li>
            ))}
          </ul>
          {items.some((it) => !it.done) && (
            <p className="mt-3 text-xs text-slate-500">
              Incomplete items will appear as a checklist on your Command Center. Finish them
              anytime.
            </p>
          )}
        </div>

        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <ArrowRight className="h-4 w-4" />
          Next: a quick 60-second product tour on the dashboard.
        </div>
      </div>
    </OnboardingShell>
  )
}
