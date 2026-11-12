/**
 * The agreement step: "I agree to all of the above" (CTO-08), the Title
 * select pre-filled from the owner's practitioner row (CTO-16) and the
 * demo-only retype-the-clinic-name switch (CTO-10).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Application } from '@/lib/onboardingApi'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/components/onboarding/ApplicationShell', async (orig) => ({
  ...(await orig<typeof import('@/components/onboarding/ApplicationShell')>()),
  ApplicationShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      name: 'Olivia Owner',
      clinic: { name: 'Sunrise Clinic', tenant: { name: 'Sunrise Clinic' } },
    },
    refetchUser: vi.fn().mockResolvedValue(null),
  }),
}))

const signAgreement = vi.fn()
const getApplication = vi.fn()
vi.mock('@/lib/onboardingApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/onboardingApi')>()),
  onboardingApi: {
    getApplication: () => getApplication(),
    signAgreement: (...a: unknown[]) => signAgreement(...a),
  },
}))

import AgreementPage from '@/app/(onboarding)/agreement/page'

const application = (confirmClinicName: boolean): Application =>
  ({
    clinicName: 'Sunrise Clinic',
    config: { confirmClinicName },
    verification: { status: 'PENDING_REVIEW', submittedAt: null, reviewedAt: null, notes: null },
    progress: { practice: true, practitioners: true, agreement: false },
    location: null,
    agreement: null,
    profile: {
      id: 'p1',
      legalName: 'Sunrise Wellness LLC',
      dbaName: null,
      practiceType: 'LONGEVITY_MEDICAL',
      noNpi: true,
      groupNpi: null,
      federalTaxIdMasked: null,
      deaNumberMasked: null,
      licenseNumber: null,
      licenseState: null,
      practitioners: [
        {
          name: 'Olivia Owner',
          email: 'olivia@example.test',
          title: 'Medical Director',
          isOwner: true,
          isSelf: true,
        },
      ],
    },
  }) as unknown as Application

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AgreementPage />
    </QueryClientProvider>
  )

const ackBoxes = () =>
  screen
    .getAllByRole('checkbox')
    .filter(
      (b) =>
        !/I agree to all|read and agree to the authorization/.test(
          b.closest('label')?.textContent ?? ''
        )
    )

beforeEach(() => {
  signAgreement.mockReset().mockResolvedValue({ verificationStatus: 'PENDING_REVIEW' })
  replace.mockReset()
})

describe('agreement step', () => {
  it('"select all" ticks every acknowledgement, shows the mixed state, and the record keeps every key', async () => {
    getApplication.mockResolvedValue(application(false))
    renderPage()
    const all = (await screen.findByLabelText('I agree to all of the above')) as HTMLInputElement
    expect(ackBoxes()).toHaveLength(5)

    fireEvent.click(all)
    expect(ackBoxes().every((b) => (b as HTMLInputElement).checked)).toBe(true)
    expect(all.checked).toBe(true)

    // Unticking one clears "select all" and shows the mixed state.
    fireEvent.click(ackBoxes()[2]!)
    expect(all.checked).toBe(false)
    expect(all.indeterminate).toBe(true)
    fireEvent.click(all)
    expect(all.indeterminate).toBe(false)

    // The communications authorization is a separate consent: not ticked by "select all".
    const comms = screen.getByLabelText(/read and agree to the authorization/)
    expect(comms).not.toBeChecked()
    fireEvent.click(comms)

    // CTO-16: the title is pre-filled from the owner's practitioner row.
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Medical Director')
    fireEvent.change(screen.getByLabelText(/Signature/), { target: { value: 'olivia owner' } })

    // CTO-10 off: submits straight away, without the retype dialog or the name.
    fireEvent.click(screen.getByRole('button', { name: /Sign & submit application/ }))
    await waitFor(() => expect(signAgreement).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const body = signAgreement.mock.calls[0]![0] as Record<string, unknown>
    expect(body).toMatchObject({
      acknowledgements: {
        baa: true,
        hipaa: true,
        dataResidency: true,
        refundPolicy: true,
        authorizedSignatory: true,
      },
      communications: true,
      signerTitle: 'Medical Director',
    })
    expect(body).not.toHaveProperty('confirmClinicName')
    // CTO-25: straight to the dashboard.
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'))
  })

  it('with the demo switch on, the clinic name is retyped before submitting', async () => {
    getApplication.mockResolvedValue(application(true))
    renderPage()
    fireEvent.click(await screen.findByLabelText('I agree to all of the above'))
    fireEvent.click(screen.getByLabelText(/read and agree to the authorization/))
    fireEvent.change(screen.getByLabelText(/Signature/), { target: { value: 'Olivia Owner' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign & submit application/ }))
    const dialog = await screen.findByRole('dialog')
    expect(signAgreement).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Clinic name'), { target: { value: 'Sunrise Clinic' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & submit' }))
    await waitFor(() => expect(signAgreement).toHaveBeenCalled())
    expect(signAgreement.mock.calls[0]![0]).toMatchObject({ confirmClinicName: 'Sunrise Clinic' })
    expect(dialog).toBeTruthy()
  })
})
