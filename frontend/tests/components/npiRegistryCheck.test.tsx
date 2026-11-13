/** CTO-29: the NPPES check under an NPI field: found, mismatch with a reason, unverified. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const lookupNpi = vi.fn()
vi.mock('@/lib/onboardingApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/onboardingApi')>()),
  onboardingApi: { lookupNpi: (...a: unknown[]) => lookupNpi(...a) },
}))

import { NpiRegistryCheck } from '@/components/onboarding/NpiRegistryCheck'

const lookup = (type: 1 | 2, status = 'FOUND') => ({
  npi: '1234567893',
  status,
  type,
  name: 'SYNTHETIC WELLNESS PARTNERS LLC',
  taxonomy: 'Clinic/Center, Primary Care',
  state: 'TX',
  checkedAt: '2026-11-12T00:00:00.000Z',
})

const renderCheck = (npi: string, onReason = vi.fn()) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <NpiRegistryCheck npi={npi} expect={2} idPrefix="group" reason="" onReasonChange={onReason} />
    </QueryClientProvider>
  )

describe('NpiRegistryCheck', () => {
  it('does nothing until the checksum passes', () => {
    renderCheck('1234567890')
    expect(lookupNpi).not.toHaveBeenCalled()
  })

  it('shows who the NPI belongs to when it matches', async () => {
    lookupNpi.mockResolvedValue({ lookup: lookup(2), verdict: 'OK', message: null })
    renderCheck('1234567893')
    expect(await screen.findByText(/In NPPES: SYNTHETIC WELLNESS PARTNERS LLC/)).toHaveTextContent(
      'Organisation (type 2) · Clinic/Center, Primary Care · TX'
    )
    expect(lookupNpi).toHaveBeenCalledWith('1234567893', 2)
  })

  it('a mismatch warns and asks for a reason to continue', async () => {
    lookupNpi.mockResolvedValue({
      lookup: lookup(1),
      verdict: 'WRONG_TYPE',
      message: 'This NPI is registered to an individual (type 1).',
    })
    const onReason = vi.fn()
    renderCheck('1987654328', onReason)
    expect(await screen.findByText(/registered to an individual/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Tell our reviewer why/), { target: { value: 'Solo' } })
    expect(onReason).toHaveBeenCalledWith('Solo')
  })

  it('an unreachable registry falls back with a note', async () => {
    lookupNpi.mockResolvedValue({
      lookup: { ...lookup(2), status: 'UNAVAILABLE' },
      verdict: 'UNVERIFIED',
      message: null,
    })
    renderCheck('1334455668')
    expect(await screen.findByText(/Couldn't verify with NPPES right now/)).toBeInTheDocument()
  })
})
