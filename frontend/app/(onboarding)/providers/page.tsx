'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Stethoscope, UserPlus } from 'lucide-react'
import api from '@/lib/api'
import { apiErrorOf } from '@/lib/apiError'
import { useAuth } from '@/contexts/AuthContext'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { useApplication } from '@/components/onboarding/useApplication'
import { LoadingSkeleton } from '@/components/ui-system/LoadingSkeleton'
import type { Practitioner } from '@/lib/onboardingApi'

type InviteState = 'idle' | 'sending' | 'sent' | 'exists'

/** "Dr Jane Q. Smith" -> { firstName: 'Jane Q.', lastName: 'Smith' } (honorifics dropped). */
function splitName(full: string) {
  const parts = full
    .trim()
    .split(/\s+/)
    .filter((p) => !/^(dr|mr|ms|mrs|prof)\.?$/i.test(p))
  if (parts.length === 0) return { firstName: full.trim(), lastName: full.trim() }
  if (parts.length === 1) return { firstName: parts[0]!, lastName: parts[0]! }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1]! }
}

export default function ProvidersStepPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [linkingSelf, setLinkingSelf] = React.useState(false)
  const [linkedSelf, setLinkedSelf] = React.useState(false)
  const [linkError, setLinkError] = React.useState<string | null>(null)

  // Is this owner already a provider? (resume support)
  const [loading, setLoading] = React.useState(true)
  const [existingEmails, setExistingEmails] = React.useState<Set<string>>(new Set())
  const [catalog, setCatalog] = React.useState<{ disciplineIds: string[]; serviceIds: string[] }>({
    disciplineIds: [],
    serviceIds: [],
  })
  const [invites, setInvites] = React.useState<Record<string, InviteState>>({})
  const [inviteErrors, setInviteErrors] = React.useState<Record<string, string>>({})
  const { data: application } = useApplication()
  const others: Practitioner[] = (application?.profile?.practitioners ?? []).filter(
    (p) => !p.isSelf
  )

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [pResp, dResp, sResp] = await Promise.all([
          api.get('/providers'),
          api.get('/disciplines'),
          api.get('/services'),
        ])
        const providers: any[] = pResp.data?.data?.providers ?? pResp.data?.data ?? []
        const disciplines: any[] = dResp.data?.data?.disciplines ?? dResp.data?.data ?? []
        const services: any[] = sResp.data?.data?.services ?? sResp.data?.data ?? []
        if (cancelled) return
        if (providers.some((p) => p.userId === user?.id)) setLinkedSelf(true)
        setExistingEmails(
          new Set(providers.map((p) => String(p.email ?? '').toLowerCase()).filter(Boolean))
        )
        setCatalog({
          disciplineIds: disciplines.map((d) => d.id),
          serviceIds: services.map((x) => x.id),
        })
      } catch {
        /* noop: the step still works without the lists */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const canInvite = catalog.disciplineIds.length > 0 && catalog.serviceIds.length > 0

  // Invites a practitioner from the application as a provider, offering every
  // discipline and service for now (refined later on the provider's page).
  const invite = async (p: Practitioner) => {
    const key = p.email.toLowerCase()
    setInvites((s) => ({ ...s, [key]: 'sending' }))
    setInviteErrors((s) => ({ ...s, [key]: '' }))
    try {
      await api.post('/providers', {
        ...splitName(p.name),
        email: p.email,
        phone: p.phone ?? undefined,
        npi: p.npi ?? undefined,
        licenseNumber: p.licenseNumber ?? undefined,
        licenseState: p.licenseState ?? undefined,
        credentials: p.credentials ?? undefined,
        disciplineIds: catalog.disciplineIds,
        services: catalog.serviceIds.map((serviceId) => ({ serviceId })),
      })
      setInvites((s) => ({ ...s, [key]: 'sent' }))
    } catch (err) {
      const e = apiErrorOf(err)
      setInvites((s) => ({ ...s, [key]: e.status === 409 ? 'exists' : 'idle' }))
      if (e.status !== 409) setInviteErrors((s) => ({ ...s, [key]: e.message }))
    }
  }

  const linkSelf = async () => {
    if (!user?.id || linkingSelf || linkedSelf) return
    setLinkingSelf(true)
    setLinkError(null)
    try {
      await api.post(`/staff/${user.id}/link-provider`)
      setLinkedSelf(true)
    } catch (err: any) {
      setLinkError(apiErrorOf(err).message || 'Could not link provider profile')
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

            {others.length > 0 && (
              <div
                className="rounded-2xl border border-slate-100 p-5"
                data-testid="application-practitioners"
              >
                <h3 className="text-sm font-semibold text-slate-900">
                  Practitioners from your application
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Invite them now: each gets an email to set a password. Their NPI and license come
                  across from your application.
                </p>
                {!canInvite && (
                  <p className="mt-2 text-xs text-amber-700">
                    Add at least one discipline and one service first (previous steps) to invite
                    practitioners here.
                  </p>
                )}
                <ul className="mt-4 divide-y divide-slate-100">
                  {others.map((p) => {
                    const key = p.email.toLowerCase()
                    const state: InviteState = existingEmails.has(key)
                      ? 'exists'
                      : (invites[key] ?? 'idle')
                    return (
                      <li
                        key={key}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {p.name}
                            {p.credentials ? `, ${p.credentials}` : ''}
                          </p>
                          <p className="text-xs text-slate-500">
                            {p.email}
                            {p.npi ? ` · NPI ${p.npi}` : ''}
                          </p>
                          {inviteErrors[key] && (
                            <p className="mt-1 text-xs text-rose-600">{inviteErrors[key]}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => invite(p)}
                          disabled={!canInvite || state !== 'idle'}
                          className={
                            state === 'sent' || state === 'exists'
                              ? 'inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700'
                              : 'inline-flex items-center gap-1.5 rounded-full border border-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50'
                          }
                        >
                          {state === 'sent' ? (
                            <>
                              <Check className="h-3.5 w-3.5" /> Invited
                            </>
                          ) : state === 'exists' ? (
                            <>
                              <Check className="h-3.5 w-3.5" /> On the team
                            </>
                          ) : state === 'sending' ? (
                            'Sending…'
                          ) : (
                            <>
                              <UserPlus className="h-3.5 w-3.5" /> Invite
                            </>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

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
