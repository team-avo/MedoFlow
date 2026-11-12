'use client'

/**
 * The NPPES registry check under an NPI field (CTO-29). Once the checksum
 * passes, the server asks the public CMS registry who the number belongs to.
 * A mismatch (wrong type, not found, deactivated) is a warning the applicant
 * can override with a reason; an unreachable registry just says so.
 */
import { useQuery } from '@tanstack/react-query'
import { isValidNpi } from '@/lib/practiceIds'
import { onboardingApi } from '@/lib/onboardingApi'

export function NpiRegistryCheck({
  npi,
  expect,
  reason,
  onReasonChange,
  idPrefix,
}: {
  npi: string
  /** 2 = the practice's group NPI, 1 = a practitioner's own NPI. */
  expect: 1 | 2
  reason: string
  onReasonChange: (v: string) => void
  idPrefix: string
}) {
  const clean = npi.replace(/[\s-]/g, '')
  const enabled = isValidNpi(clean)
  const { data, isFetching, isError } = useQuery({
    queryKey: ['npi-lookup', clean, expect],
    queryFn: () => onboardingApi.lookupNpi(clean, expect),
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: false,
  })
  if (!enabled) return null
  if (isFetching) return <p className="text-xs text-slate-500">Checking the NPPES registry…</p>
  if (isError || !data || !data.lookup || data.verdict === 'UNVERIFIED') {
    return (
      <p className="text-xs text-slate-500" data-testid={`${idPrefix}-npi-registry`}>
        Couldn&apos;t verify with NPPES right now; we&apos;ll confirm it during review.
      </p>
    )
  }
  const l = data.lookup
  if (data.verdict === 'OK') {
    return (
      <p className="text-xs text-emerald-700" data-testid={`${idPrefix}-npi-registry`}>
        ✓ In NPPES: {l.name} · {l.type === 2 ? 'Organisation (type 2)' : 'Individual (type 1)'}
        {l.taxonomy ? ` · ${l.taxonomy}` : ''}
        {l.state ? ` · ${l.state}` : ''}
      </p>
    )
  }
  return (
    <div
      className="space-y-1.5 rounded-lg bg-amber-50 p-2"
      data-testid={`${idPrefix}-npi-registry`}
    >
      <p className="text-xs font-medium text-amber-900">
        {data.message}
        {l.name ? ` (NPPES: ${l.name})` : ''}
      </p>
      <label htmlFor={`${idPrefix}-npi-reason`} className="block text-xs text-amber-900">
        Continue anyway? Tell our reviewer why
      </label>
      <input
        id={`${idPrefix}-npi-reason`}
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        maxLength={300}
        className="w-full rounded-md border border-amber-200 bg-white px-2 py-1 text-xs"
        placeholder="e.g. Solo practice billing under my own NPI"
      />
    </div>
  )
}
