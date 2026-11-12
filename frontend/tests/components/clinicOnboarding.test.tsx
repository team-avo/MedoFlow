/** Clinic onboarding — review banner, setup checklist and the practitioner list. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { VerificationBanner } from '@/components/onboarding/VerificationBanner'
import { checklistItems, SetupChecklist } from '@/components/onboarding/SetupChecklist'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PractitionersForm, withOwnerFirst } from '@/components/onboarding/PractitionersForm'
import type { OnboardingStatus, Practitioner } from '@/lib/onboardingApi'
import { toPractitionerDraft } from '@/lib/schemas/onboarding'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const patchUser = vi.fn()
const apiPatch = vi.fn().mockResolvedValue({})
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { preferences: {} }, patchUser }),
}))
vi.mock('@/lib/api', () => ({ default: { patch: (...a: unknown[]) => apiPatch(...a) } }))

const savePractitioners = vi.fn()
const getStatus = vi.fn()
vi.mock('@/lib/onboardingApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/onboardingApi')>()),
  onboardingApi: {
    savePractitioners: (...a: unknown[]) => savePractitioners(...a),
    getStatus: () => getStatus(),
  },
}))

const owner = (tenant: Record<string, unknown>) => ({
  role: 'SUPER_ADMIN' as const,
  clinic: {
    id: 'c1',
    name: 'Clinic',
    tenant: {
      id: 't1',
      name: 'Clinic',
      onboardingCompletedAt: null,
      onboardingStep: 0,
      termsAcceptedAt: null,
      termsVersion: null,
      ...tenant,
    },
  },
})

describe('VerificationBanner', () => {
  it('shows nothing once approved, or to anyone but the owner', () => {
    const { container, rerender } = render(
      <VerificationBanner user={owner({ verificationStatus: 'APPROVED' })} />
    )
    expect(container).toBeEmptyDOMElement()
    rerender(
      <VerificationBanner
        user={{ ...owner({ verificationStatus: 'PENDING_REVIEW' }), role: 'FRONT_DESK' }}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('under review, changes requested (with the note and a link) and rejected', () => {
    const { rerender } = render(
      <VerificationBanner
        user={owner({ verificationStatus: 'PENDING_REVIEW', submittedForReviewAt: '2026-11-10' })}
      />
    )
    expect(screen.getByText('Your clinic is under review')).toBeInTheDocument()

    rerender(
      <VerificationBanner
        user={owner({ verificationStatus: 'CHANGES_REQUESTED', reviewNotes: 'Fix the NPI' })}
      />
    )
    expect(screen.getByText(/Changes requested/)).toBeInTheDocument()
    expect(screen.getByText(/Fix the NPI/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Update application' })).toHaveAttribute(
      'href',
      '/dashboard/clinic'
    )

    rerender(<VerificationBanner user={owner({ verificationStatus: 'REJECTED' })} />)
    expect(screen.getByText(/was not approved/)).toBeInTheDocument()
  })
})

describe('setup checklist', () => {
  const status = (o: Partial<OnboardingStatus> = {}): OnboardingStatus => ({
    completedAt: null,
    step: 0,
    termsAcceptedAt: null,
    verification: { status: 'PENDING_REVIEW', submittedAt: null, reviewedAt: null, notes: null },
    application: { practice: true, practitioners: true, agreement: false },
    checklist: {
      brand: true,
      locations: true,
      disciplines: true,
      services: false,
      providers: false,
      availability: false,
      website: false,
    },
    ...o,
  })

  it('lists application, review and Quick setup items with deep links; the website is optional', () => {
    const items = checklistItems(status())
    expect(items.map((i) => [i.key, i.done])).toEqual([
      ['application', false],
      ['review', false],
      ['brand', true],
      ['locations', true],
      ['disciplines', true],
      ['services', false],
      ['providers', false],
      ['availability', false],
      ['website', false],
    ])
    expect(items.every((i) => i.href.startsWith('/dashboard/'))).toBe(true)
    // CTO-23: only the website is optional.
    expect(items.filter((i) => i.optional).map((i) => i.key)).toEqual(['website'])
    const approved = checklistItems(
      status({
        application: { practice: true, practitioners: true, agreement: true },
        verification: { status: 'APPROVED', submittedAt: null, reviewedAt: null, notes: null },
      })
    )
    expect(approved.slice(0, 2).every((i) => i.done)).toBe(true)
  })

  const renderChecklist = () =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SetupChecklist />
      </QueryClientProvider>
    )

  it('renders the remaining items with progress over the required items only', async () => {
    getStatus.mockResolvedValue(status())
    renderChecklist()
    expect(await screen.findByText('3 of 8 done')).toBeInTheDocument()
    const website = screen.getByRole('link', { name: /Publish your website/ })
    expect(website).toHaveAttribute('href', '/dashboard/site')
    expect(website).toHaveTextContent('Optional')
  })

  it('collapses to one line, remembers the choice per user, and hides once the required items are done', async () => {
    getStatus.mockResolvedValue(status())
    const { unmount } = renderChecklist()
    const toggle = await screen.findByRole('button', { name: /Quick setup/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(patchUser).toHaveBeenCalledWith({ preferences: { setupChecklistCollapsed: true } })
    expect(apiPatch).toHaveBeenCalledWith('/auth/me', {
      preferences: { setupChecklistCollapsed: true },
    })
    unmount()

    getStatus.mockResolvedValue(
      status({
        application: { practice: true, practitioners: true, agreement: true },
        verification: { status: 'APPROVED', submittedAt: null, reviewedAt: null, notes: null },
        checklist: {
          brand: true,
          locations: true,
          disciplines: true,
          services: true,
          providers: true,
          availability: true,
          website: false, // optional: doesn't keep the panel around
        },
      })
    )
    const { container } = renderChecklist()
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalledTimes(3))
    await new Promise((r) => setTimeout(r, 0))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing (instead of crashing the page) on a partial status', async () => {
    getStatus.mockResolvedValue({})
    const { container } = renderChecklist()
    await vi.waitFor(() => expect(getStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

describe('PractitionersForm', () => {
  it('starts with the owner (no "This is me"), adds and removes rows, keeps one primary account holder and validates NPI', async () => {
    savePractitioners.mockResolvedValue({})
    const onSaved = vi.fn()
    render(
      <PractitionersForm
        application={null}
        owner={{ name: 'Olivia Owner', email: 'olivia@example.test' }}
        onSaved={onSaved}
      />
    )
    expect(screen.getByLabelText(/Full name/)).toHaveValue('Olivia Owner')
    // CTO-14: the owner is row 0, marked as you, with no extra self-add step.
    expect(screen.queryByLabelText('This is me')).not.toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByLabelText('I see patients')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: /Add practitioner/ }))
    expect(screen.getAllByLabelText(/Full name/)).toHaveLength(2)
    // The primary account holder is a single choice.
    const owners = screen.getAllByLabelText('Primary account holder')
    fireEvent.click(owners[1]!)
    expect(owners[0]).not.toBeChecked()
    expect(owners[1]).toBeChecked()
    // The owner's own row can't be removed; the added one can.
    expect(screen.getAllByRole('button', { name: /Remove/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }))
    expect(screen.getAllByLabelText(/Full name/)).toHaveLength(1)

    // The remaining row is no longer the account holder and has no NPI: blocked.
    fireEvent.click(screen.getByRole('button', { name: /Save & continue/ }))
    expect(
      await screen.findByText(/exactly one practitioner as the primary account holder/)
    ).toBeInTheDocument()
    expect(screen.getByText('NPI is required')).toBeInTheDocument()
    expect(savePractitioners).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Primary account holder'))
    fireEvent.change(screen.getByLabelText(/Individual NPI/), { target: { value: '1234567893' } })
    expect(screen.getByText(/NPI format and check digit look right/)).toBeInTheDocument()
    // CTO-16: a Title select with US options; "Other" takes free text.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Other' } })
    fireEvent.click(screen.getByRole('button', { name: /Save & continue/ }))
    expect(await screen.findByText('Type your title')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Your title/), {
      target: { value: 'Clinical Director' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save & continue/ }))
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(savePractitioners).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'Olivia Owner',
        npi: '1234567893',
        title: 'Clinical Director',
        isOwner: true,
        isSelf: true,
        seesPatients: true,
      }),
    ])
  })

  it('a non-clinical owner unticks "I see patients" and needs no NPI', async () => {
    savePractitioners.mockReset().mockResolvedValue({})
    const onSaved = vi.fn()
    render(
      <PractitionersForm
        application={null}
        owner={{ name: 'Mona Manager', email: 'mona@example.test' }}
        onSaved={onSaved}
      />
    )
    fireEvent.click(screen.getByLabelText('I see patients'))
    expect(screen.getByText(/No provider profile is created for you/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Practice Manager' } })
    fireEvent.click(screen.getByRole('button', { name: /Save & continue/ }))
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(savePractitioners).toHaveBeenCalledWith([
      expect.objectContaining({
        title: 'Practice Manager',
        isSelf: true,
        seesPatients: false,
        npi: null,
      }),
    ])
  })

  it('puts the owner first in an older saved list', () => {
    const row = (o: Partial<Practitioner>): Practitioner => ({
      name: 'X',
      email: 'x@example.test',
      isOwner: false,
      isSelf: false,
      ...o,
    })
    const drafts = [
      row({ name: 'Other', email: 'o@example.test', isOwner: true }),
      row({ isSelf: true }),
    ].map(toPractitionerDraft)
    expect(withOwnerFirst(drafts).map((d) => d.isSelf)).toEqual([true, false])
    // No self row at all: the owner is added at the top (not as account holder).
    const added = withOwnerFirst([drafts[0]!], { name: 'Olivia', email: 'olivia@example.test' })
    expect(added[0]).toMatchObject({ name: 'Olivia', isSelf: true, isOwner: false })
  })
})
