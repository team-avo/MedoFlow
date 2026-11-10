'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { AppErrorState, LoadingSkeleton } from '@/components/ui-system'
import { ApplicationShell } from '@/components/onboarding/ApplicationShell'
import { PracticeDetailsForm } from '@/components/onboarding/PracticeDetailsForm'
import { useApplication } from '@/components/onboarding/useApplication'

/** Clinic application, step 1 — practice details, licensing and tax. */
export default function PracticeStepPage() {
  const router = useRouter()
  const { user, refetchUser } = useAuth()
  const { data, isLoading, isError, refetch, setApplication } = useApplication()

  return (
    <ApplicationShell
      stepKey="practice"
      title="Tell us about your practice"
      subtitle="We verify your NPI and licensing before your website and online booking go live — most applications are reviewed within one business day. You can set everything else up in the meantime."
    >
      {isLoading ? (
        <LoadingSkeleton variant="card" count={2} />
      ) : isError ? (
        <AppErrorState title="Couldn't load your application" onRetry={() => void refetch()} />
      ) : (
        <PracticeDetailsForm
          application={data ?? null}
          owner={{ name: user?.name, email: user?.email }}
          onSaved={async (app) => {
            setApplication(app)
            await refetchUser()
            router.push('/practitioners')
          }}
        />
      )}
    </ApplicationShell>
  )
}
