'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { AppErrorState, LoadingSkeleton } from '@/components/ui-system'
import { ApplicationShell } from '@/components/onboarding/ApplicationShell'
import { PractitionersForm } from '@/components/onboarding/PractitionersForm'
import { useApplication } from '@/components/onboarding/useApplication'

/** Clinic application, step 2: the practice's practitioners, starting with you. */
export default function PractitionersStepPage() {
  const router = useRouter()
  const { user, refetchUser } = useAuth()
  const { data, isLoading, isError, refetch, setApplication } = useApplication()

  return (
    <ApplicationShell
      stepKey="practitioners"
      title="Your practitioner details"
      subtitle="As the clinic's doctor and admin, you're listed first. Add anyone else who treats patients here. Nobody is emailed now; you can invite them from the Team page later."
    >
      <Link
        href="/practice"
        className="mb-6 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Practice details
      </Link>
      {isLoading ? (
        <LoadingSkeleton variant="card" count={2} />
      ) : isError ? (
        <AppErrorState title="Couldn't load your application" onRetry={() => void refetch()} />
      ) : (
        <PractitionersForm
          application={data ?? null}
          owner={{ name: user?.name, email: user?.email }}
          onSaved={async (app) => {
            setApplication(app)
            await refetchUser()
            router.push('/agreement')
          }}
        />
      )}
    </ApplicationShell>
  )
}
