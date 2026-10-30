/**
 * F2.6 — the patient's Visit Summaries page lists published summaries only
 * (the API returns nothing else), and says so when there are none.
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const patientApi = vi.hoisted(() => ({ getMySummaries: vi.fn() }))
vi.mock('@/lib/patientApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/patientApi')>()),
  ...patientApi,
}))

import AccountSummariesPage from '@/app/(public)/account/summaries/page'

const wrap = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AccountSummariesPage />
    </QueryClientProvider>
  )

beforeEach(() => vi.clearAllMocks())

describe('Visit Summaries', () => {
  it('shows each published summary with its visit date and provider', async () => {
    patientApi.getMySummaries.mockResolvedValue([
      {
        sessionId: 's1',
        visitRecordId: 'v1',
        appointmentId: 'appt_1',
        visitDate: '2026-10-20T15:00:00.000Z',
        providerName: 'Sam Rivera',
        publishedAt: '2026-10-20T16:00:00.000Z',
        summary: {
          diagnosis: 'Your back strain is healing.',
          treatmentPlan: 'Core exercises twice a day.',
          nextSteps: 'Come back in 4 days.',
        },
      },
    ])
    wrap()
    expect(await screen.findByText('Your back strain is healing.')).toBeInTheDocument()
    expect(screen.getByText('October 20, 2026')).toBeInTheDocument()
    expect(screen.getByText('With Sam Rivera')).toBeInTheDocument()
    expect(screen.getByText('Core exercises twice a day.')).toBeInTheDocument()
    expect(screen.getByText('Come back in 4 days.')).toBeInTheDocument()
    // The link carries an id only (no PHI in URLs, F0.3.1).
    expect(screen.getByRole('link', { name: 'View appointment' }).getAttribute('href')).toBe(
      '/account/appointments/appt_1'
    )
  })

  it('an empty list explains when summaries appear', async () => {
    patientApi.getMySummaries.mockResolvedValue([])
    wrap()
    expect(await screen.findByText('No visit summaries yet')).toBeInTheDocument()
  })
})
