'use client'

import Link from 'next/link'
import { AlertTriangle, Clock, XCircle } from 'lucide-react'
import type { User } from '@/lib/types'

/**
 * Clinic-owner banner on every dashboard page while the clinic isn't live:
 * under review, changes requested (with the reviewer's note) or rejected.
 * Nothing renders once the clinic is approved, or for anyone but the owner.
 */
export function VerificationBanner({ user }: { user: Pick<User, 'role' | 'clinic'> | null }) {
  if (!user || user.role !== 'SUPER_ADMIN') return null
  const tenant = user.clinic?.tenant
  const status = tenant?.verificationStatus
  if (!status || status === 'APPROVED') return null

  if (status === 'CHANGES_REQUESTED') {
    return (
      <div
        role="status"
        data-testid="verification-banner"
        className="flex flex-wrap items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:px-8"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Changes requested on your clinic application</p>
          {tenant?.reviewNotes && (
            <p className="mt-0.5 whitespace-pre-wrap">&ldquo;{tenant.reviewNotes}&rdquo;</p>
          )}
        </div>
        <Link
          href="/dashboard/clinic"
          className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
        >
          Update application
        </Link>
      </div>
    )
  }

  if (status === 'REJECTED') {
    return (
      <div
        role="status"
        data-testid="verification-banner"
        className="flex flex-wrap items-start gap-3 border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 md:px-8"
      >
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Your clinic application was not approved</p>
          {tenant?.reviewNotes && (
            <p className="mt-0.5 whitespace-pre-wrap">{tenant.reviewNotes}</p>
          )}
          <p className="mt-0.5">
            Your website and online booking stay off. Contact support with any questions.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      role="status"
      data-testid="verification-banner"
      className="flex flex-wrap items-start gap-3 border-b border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 md:px-8"
    >
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {tenant?.submittedForReviewAt
            ? 'Your clinic is under review'
            : 'Finish your clinic application'}
        </p>
        <p className="mt-0.5">
          {tenant?.submittedForReviewAt
            ? 'Your public website and online booking switch on once we approve the application, usually within one business day. Keep setting up in the meantime.'
            : 'Submit your practice details and agreement so we can review the clinic and switch on your website and online booking.'}
        </p>
      </div>
      <Link
        href="/dashboard/clinic"
        className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
      >
        View application
      </Link>
    </div>
  )
}
