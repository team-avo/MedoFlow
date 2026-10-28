'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Stethoscope, UserPlus } from 'lucide-react'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'

export default function ProvidersStepPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [linkingSelf, setLinkingSelf] = React.useState(false)
  const [linkedSelf, setLinkedSelf] = React.useState(false)
  const [linkError, setLinkError] = React.useState<string | null>(null)

  // Is this owner already a provider? (resume support)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/providers')
        const providers: any[] = data?.data?.providers ?? data?.data ?? []
        if (!cancelled && providers.some((p) => p.userId === user?.id)) {
          setLinkedSelf(true)
        }
      } catch {
        /* noop */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const linkSelf = async () => {
    if (!user?.id || linkingSelf || linkedSelf) return
    setLinkingSelf(true)
    setLinkError(null)
    try {
      await api.post(`/staff/${user.id}/link-provider`)
      setLinkedSelf(true)
    } catch (err: any) {
      setLinkError(err?.response?.data?.error || 'Could not link provider profile')
    } finally {
      setLinkingSelf(false)
    }
  }

  return (
    <OnboardingShell
      stepKey="providers"
      title="Who provides care at your clinic?"
      subtitle="Add yourself now if you see patients. You can invite your full team from the Staff page after setup."
      nextLabel="Continue"
      onNext={async () => {
        await api.patch('/onboarding/step', { step: 6 })
        router.push('/done')
      }}
    >
      {loading ? (
        <LoadingSkeleton variant="card" />
      ) : (
        <>
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-100 bg-slate-50/30 p-5">
              <div className="flex items-start gap-4">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                  <Stethoscope className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-slate-900">Are you a provider?</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Make yourself bookable for appointments. You can edit your disciplines,
                    services, and availability later.
                  </p>
                  {linkError && <p className="mt-2 text-xs text-rose-600">{linkError}</p>}
                </div>
                <button
                  type="button"
                  onClick={linkSelf}
                  disabled={linkingSelf || linkedSelf}
                  className={
                    linkedSelf
                      ? 'inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-700'
                      : 'inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60'
                  }
                >
                  {linkedSelf ? (
                    <>
                      <Check className="h-4 w-4" />
                      Added
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      Add me
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-dashed border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-900">Invite teammates</h3>
              <p className="mt-1 text-sm text-slate-600">
                After you finish setup, head to <strong>Team</strong> in the sidebar to invite
                providers and front-desk staff. They'll set their own passwords via email.
              </p>
            </div>
          </div>
        </>
      )}
    </OnboardingShell>
  )
}
