'use client'

import type { NpiCheck } from '@/lib/onboardingApi'
import * as React from 'react'
import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react'
import api from '@/lib/api'
import { apiErrorOf } from '@/lib/apiError'
import type { Practitioner, VerificationStatus } from '@/lib/onboardingApi'
import { isValidDea, isValidEin, isValidNpi, PRACTICE_TYPES } from '@/lib/practiceIds'
import { cn } from '@/lib/utils'

/** The application as GET /platform/clinics/:tenantId returns it to a reviewer (unmasked). */
export interface ReviewApplication {
  clinicId: string
  owner: { id: string; name: string; email: string; createdAt: string } | null
  profile:
    | (Record<string, unknown> & {
        legalName: string
        dbaName: string | null
        practiceType: string
        locationCount: number
        officePhone: string | null
        fax: string | null
        website: string | null
        primaryContactName: string
        primaryContactEmail: string
        primaryContactPhone: string | null
        secondaryContactName?: string | null
        secondaryContactEmail?: string | null
        secondaryContactPhone?: string | null
        practiceTypeOther?: string | null
        npiVerification?: {
          group?: NpiCheck | null
          practitioners?: Record<string, NpiCheck>
        } | null
        mailingSameAsPrimary: boolean
        mailingAddressLine1: string | null
        mailingCity: string | null
        mailingState: string | null
        mailingPostalCode: string | null
        groupNpi: string | null
        noNpi: boolean
        federalTaxId: string
        licenseNumber: string | null
        licenseState: string | null
        deaNumber: string | null
        estimatedSeats: number
        referralSource: string | null
        practitioners: Practitioner[]
      })
    | null
  location: {
    addressLine1: string | null
    addressLine2: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    timezone: string
  } | null
  agreements: {
    id: string
    version: string
    signerName: string
    signerTitle: string
    signatureText: string
    communicationsConsent: boolean
    ipAddress: string | null
    acceptedAt: string
  }[]
}

const typeLabel = (k: string) => PRACTICE_TYPES.find(([key]) => key === k)?.[1] ?? k

function Check({ value, valid }: { value: string | null; valid: boolean }) {
  if (!value) return <span className="text-slate-400">Not set</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="text-xs">{value}</code>
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
          valid ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        )}
      >
        {valid ? 'checksum ok' : 'invalid'}
      </span>
    </span>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-50 py-1.5 text-sm">
      <dt className="text-slate-500">{k}</dt>
      <dd className="min-w-0 break-words text-right text-slate-900">{v ?? 'Not set'}</dd>
    </div>
  )
}

/**
 * Platform reviewer panel on /platform/clinics/[tenantId]: the clinic's full
 * practice application (format checks on NPI / EIN / DEA; the reviewer
 * verifies them against the registries) and the review decision.
 */
export function ClinicApplicationReview({
  tenantId,
  status,
  submittedAt,
  reviewNotes,
  termsAccepted,
  application,
  onReviewed,
}: {
  tenantId: string
  status: VerificationStatus
  submittedAt: string | null
  reviewNotes: string | null
  termsAccepted: boolean
  application: ReviewApplication | null
  onReviewed: () => void
}) {
  const [notes, setNotes] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const p = application?.profile
  const l = application?.location
  const agreement = application?.agreements[0]

  const decide = async (decision: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT') => {
    setBusy(decision)
    setError(null)
    try {
      await api.post(`/platform/clinics/${tenantId}/review`, {
        decision,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      setNotes('')
      onReviewed()
    } catch (e) {
      setError(apiErrorOf(e).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      aria-label="Clinic application"
      data-testid="application-review"
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Clinic application</h2>
        <span className="text-xs text-slate-500">
          {submittedAt
            ? `Submitted ${new Date(submittedAt).toLocaleString()}`
            : 'Not submitted yet'}
        </span>
      </div>

      {!p ? (
        <p className="text-sm text-slate-500">
          The clinic hasn&apos;t filled in its practice details yet.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <dl>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Practice
            </h3>
            <Row k="Legal name" v={p.legalName} />
            <Row k="DBA" v={p.dbaName ?? 'Same as legal name'} />
            <Row
              k="Practice type"
              v={
                p.practiceType === 'OTHER' && p.practiceTypeOther
                  ? `Other (typed): ${p.practiceTypeOther}`
                  : typeLabel(p.practiceType)
              }
            />
            <Row k="Locations" v={String(p.locationCount)} />
            <Row
              k="Primary address"
              v={
                l
                  ? [l.addressLine1, l.addressLine2, l.city, l.state, l.postalCode]
                      .filter(Boolean)
                      .join(', ')
                  : 'Not set'
              }
            />
            <Row k="Timezone" v={l?.timezone} />
            <Row
              k="Office phone / fax"
              v={[p.officePhone, p.fax].filter(Boolean).join(' / ') || 'Not set'}
            />
            <Row k="Website" v={p.website} />
            <Row
              k="Mailing address"
              v={
                p.mailingSameAsPrimary
                  ? 'Same as primary'
                  : [p.mailingAddressLine1, p.mailingCity, p.mailingState, p.mailingPostalCode]
                      .filter(Boolean)
                      .join(', ')
              }
            />
          </dl>
          <dl>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Licensing, tax & contacts
            </h3>
            <Row
              k="Group NPI"
              v={
                p.noNpi ? (
                  'No NPI (declared)'
                ) : (
                  <>
                    <Check value={p.groupNpi} valid={isValidNpi(p.groupNpi ?? '')} />
                    <RegistryNote check={p.npiVerification?.group} />
                  </>
                )
              }
            />
            <Row
              k="Federal Tax ID"
              v={<Check value={p.federalTaxId} valid={isValidEin(p.federalTaxId)} />}
            />
            <Row
              k="State license"
              v={
                p.licenseNumber
                  ? `${p.licenseNumber}${p.licenseState ? ` (${p.licenseState})` : ''}`
                  : 'Not set'
              }
            />
            <Row
              k="DEA"
              v={
                p.deaNumber ? <Check value={p.deaNumber} valid={isValidDea(p.deaNumber)} /> : 'None'
              }
            />
            <Row
              k="Primary contact"
              v={`${p.primaryContactName} · ${p.primaryContactEmail}${p.primaryContactPhone ? ` · ${p.primaryContactPhone}` : ''}`}
            />
            <Row
              k="Secondary contact"
              v={
                [p.secondaryContactName, p.secondaryContactEmail, p.secondaryContactPhone]
                  .filter(Boolean)
                  .join(' · ') || 'None'
              }
            />
            <Row
              k="Team size / referral"
              v={`${p.estimatedSeats} · ${p.referralSource ?? 'Not given'}`}
            />
            <Row
              k="Owner account"
              v={
                application?.owner
                  ? `${application.owner.name} · ${application.owner.email}`
                  : 'Not set'
              }
            />
          </dl>
        </div>
      )}

      {p && p.practitioners.length > 0 && (
        <div className="overflow-x-auto">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Practitioners
          </h3>
          <table className="w-full min-w-max text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1 pr-4">Name</th>
                <th className="py-1 pr-4">Email</th>
                <th className="py-1 pr-4">NPI</th>
                <th className="py-1 pr-4">License</th>
                <th className="py-1">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {p.practitioners.map((x) => (
                <tr key={x.email}>
                  <td className="py-1.5 pr-4">
                    {x.name}
                    {x.credentials ? `, ${x.credentials}` : ''}
                  </td>
                  <td className="py-1.5 pr-4 text-slate-600">{x.email}</td>
                  <td className="py-1.5 pr-4">
                    <Check value={x.npi ?? null} valid={isValidNpi(x.npi ?? '')} />
                    <RegistryNote
                      check={x.npi ? p.npiVerification?.practitioners?.[x.npi] : undefined}
                    />
                  </td>
                  <td className="py-1.5 pr-4 text-slate-600">
                    {x.licenseNumber
                      ? `${x.licenseNumber}${x.licenseState ? ` (${x.licenseState})` : ''}`
                      : 'Not set'}
                  </td>
                  <td className="py-1.5 text-xs text-slate-600">
                    {[
                      x.isOwner && 'Primary account holder',
                      x.isSelf && 'Account creator',
                      x.isSelf && x.seesPatients === false && 'Not clinical',
                      x.title,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'None'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {agreement && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Agreement {agreement.version} signed &ldquo;
          <span className="font-serif italic">{agreement.signatureText}</span>&rdquo; by{' '}
          {agreement.signerName} ({agreement.signerTitle}) on{' '}
          {new Date(agreement.acceptedAt).toLocaleString()}
          {agreement.ipAddress ? ` from ${agreement.ipAddress}` : ''} · communications authorization{' '}
          {agreement.communicationsConsent ? 'given' : 'not given'}
        </p>
      )}

      <div className="space-y-3 border-t border-slate-100 pt-4">
        {reviewNotes && status !== 'PENDING_REVIEW' && (
          <p className="text-xs text-slate-500">
            Last note to the clinic: &ldquo;{reviewNotes}&rdquo;
          </p>
        )}
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-800">Note to the clinic</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Required when requesting changes or rejecting, e.g. which number didn't verify."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </label>
        {error && (
          <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => decide('APPROVE')}
            disabled={!!busy || status === 'APPROVED' || !termsAccepted}
            title={!termsAccepted ? 'The clinic has not signed the agreement yet' : undefined}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === 'APPROVE' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Approve
          </button>
          <button
            type="button"
            onClick={() => decide('REQUEST_CHANGES')}
            disabled={!!busy || status === 'CHANGES_REQUESTED' || notes.trim().length < 5}
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {busy === 'REQUEST_CHANGES' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Request changes
          </button>
          <button
            type="button"
            onClick={() => decide('REJECT')}
            disabled={!!busy || status === 'REJECTED' || notes.trim().length < 5}
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            {busy === 'REJECT' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            Reject
          </button>
        </div>
      </div>
    </section>
  )
}

/** CTO-29: what NPPES said about an NPI, and any override reason. */
function RegistryNote({ check }: { check?: NpiCheck | null }) {
  if (!check) return null
  const l = check.lookup
  const text =
    check.verdict === 'OK'
      ? `NPPES: ${l?.name ?? 'found'} (type ${l?.type ?? '?'})`
      : check.verdict === 'UNVERIFIED'
        ? 'NPPES: could not verify (checksum only)'
        : `NPPES: ${check.verdict.replace('_', ' ').toLowerCase()}${l?.name ? `, ${l.name}` : ''}${
            l?.type ? ` (type ${l.type})` : ''
          }`
  return (
    <span
      className={`block text-[11px] ${check.verdict === 'OK' ? 'text-emerald-700' : 'text-amber-800'}`}
      data-testid="npi-registry-note"
    >
      {text}
      {check.overrideReason ? `. Applicant's reason: ${check.overrideReason}` : ''}
    </span>
  )
}
