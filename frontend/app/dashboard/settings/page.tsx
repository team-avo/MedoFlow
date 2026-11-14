'use client'

import { MfaSettings } from '@/components/auth/MfaSettings'
import { useAuth } from '@/contexts/AuthContext'
import { AppPageHeader } from '@/components/ui-system'
import { PageContainer } from '@/components/layout'

/** Account security for staff (F0.2.2): two-step verification and the session policy. */
export default function SecuritySettingsPage() {
  const { idleTimeoutMinutes } = useAuth()
  return (
    <PageContainer className="max-w-3xl space-y-6">
      <AppPageHeader
        title="Security"
        description="Protect your account and the patient data it can open."
      />
      <MfaSettings />
      <section
        aria-labelledby="session-policy-title"
        className="rounded-xl border border-slate-200 bg-white p-6"
      >
        <h2 id="session-policy-title" className="text-base font-semibold text-slate-900">
          Automatic sign-out
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          You are signed out after {idleTimeoutMinutes} minutes without activity, and the screen is
          cleared. You get a one-minute warning first.
        </p>
      </section>
    </PageContainer>
  )
}
