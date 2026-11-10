'use client'

import { useRouter } from 'next/navigation'
import { Sparkles, Palette, Calendar, Stethoscope, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'

const BENEFITS = [
  { icon: Palette, title: 'Brand the experience', body: 'Logo and colors that match your clinic.' },
  {
    icon: Stethoscope,
    title: 'Set up your services',
    body: 'Disciplines, pricing, and durations.',
  },
  {
    icon: Calendar,
    title: 'Go live with a calendar',
    body: 'Providers, locations, and availability.',
  },
] as const

export default function WelcomePage() {
  const router = useRouter()
  const { user } = useAuth()
  const nameParts = (user?.name ?? '').trim().split(/\s+/)
  // Skip honorifics (Dr., Mr., Ms., Mrs., Prof.) if they come first
  const firstMeaningful = nameParts.find((p) => !/^(dr|mr|ms|mrs|prof)\.?$/i.test(p)) ?? 'Doctor'
  const firstName = firstMeaningful

  return (
    <OnboardingShell
      stepKey="welcome"
      title={`Welcome, ${firstName}`}
      subtitle="Let's get your clinic live in about 5 minutes. You can skip any step — we'll keep a setup checklist on your dashboard so nothing gets lost."
      nextLabel="Let's go"
      hideBack
      onNext={async () => {
        router.push('/brand')
      }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        {BENEFITS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-slate-100 bg-slate-50/50 p-5">
            <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{body}</p>
          </div>
        ))}
      </div>

      {user?.clinic?.tenant?.verificationStatus === 'PENDING_REVIEW' && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Application submitted: under review</p>
            <p className="mt-0.5">
              We verify your NPI and licensing, usually within one business day. Set up your clinic
              now; your website and online booking switch on as soon as you are approved.
            </p>
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center gap-2 rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
        <Sparkles className="h-4 w-4 text-indigo-600" />
        We've pre-filled a "Main Location" for you. You can rename or add more later.
      </div>
    </OnboardingShell>
  )
}
