/** CTO-39: the platform Usage page: data, least used, not configured, error, export. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import React from 'react'

const getFeatureUsage = vi.fn()
const downloadFeatureUsageCsv = vi.fn()
vi.mock('@/lib/platformUsageApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/platformUsageApi')>()),
  getFeatureUsage: (...a: unknown[]) => getFeatureUsage(...a),
  downloadFeatureUsageCsv: (...a: unknown[]) => downloadFeatureUsageCsv(...a),
}))

import PlatformUsagePage from '@/app/platform/usage/page'
import type { FeatureUsageRow, UsageSummary } from '@/lib/platformUsageApi'

const row = (
  key: string,
  label: string,
  area: string,
  areaLabel: string,
  events: number,
  clinics: number
): FeatureUsageRow => ({
  key,
  label,
  area,
  areaLabel,
  events,
  clinics,
  lastUsed: events ? '2026-11-15T10:00:00.000Z' : null,
  weekly: [
    { week: '2026-11-02', events: Math.floor(events / 2), clinics },
    { week: '2026-11-09', events: Math.ceil(events / 2), clinics },
  ],
})

const summary = (): UsageSummary => ({
  configured: true,
  env: 'demo',
  days: 30,
  generatedAt: '2026-11-16T09:00:00.000Z',
  totals: {
    events: 42,
    activeClinics: 3,
    totalClinics: 4,
    featuresUsed: 2,
    featuresTotal: 3,
    scribeAdoption: 0.75,
  },
  weeks: ['2026-11-02', '2026-11-09'],
  areas: [
    { key: 'scribe', label: 'AI Scribe and consult' },
    { key: 'website', label: 'Website' },
  ],
  features: [
    row('scribe.approved', 'Scribe draft approved', 'scribe', 'AI Scribe and consult', 30, 3),
    row('site.published', 'Website published', 'website', 'Website', 12, 1),
    row('site.domain_added', 'Custom domain added', 'website', 'Website', 0, 0),
  ],
})

beforeEach(() => {
  getFeatureUsage.mockReset()
  downloadFeatureUsageCsv.mockReset()
})

describe('Platform Usage page', () => {
  it('shows KPIs, features by reach and the least used', async () => {
    getFeatureUsage.mockResolvedValue(summary())
    render(<PlatformUsagePage />)

    expect(await screen.findByText('3 / 4')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(getFeatureUsage).toHaveBeenCalledWith(30)

    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Scribe draft approved')
    expect(rows[0]).toHaveTextContent('3 (75%)')

    const least = screen.getByRole('list', { name: 'Least used features' })
    const items = within(least).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Custom domain added')
    expect(items[0]).toHaveTextContent('Not used')
  })

  it('filters by area and changes range', async () => {
    getFeatureUsage.mockResolvedValue(summary())
    render(<PlatformUsagePage />)
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: 'Website' }))
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Website' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '90 days' }))
    await vi.waitFor(() => expect(getFeatureUsage).toHaveBeenLastCalledWith(90))
  })

  it('explains the setup when usage analytics is not configured', async () => {
    getFeatureUsage.mockResolvedValue({ configured: false })
    render(<PlatformUsagePage />)
    expect(await screen.findByText('Usage analytics is not connected yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeDisabled()
  })

  it('shows a retryable error when PostHog cannot be read', async () => {
    getFeatureUsage.mockRejectedValueOnce({
      response: {
        data: { message: 'Usage data could not be loaded from PostHog. Try again shortly.' },
      },
    })
    render(<PlatformUsagePage />)
    expect(await screen.findByText(/could not be loaded from PostHog/)).toBeInTheDocument()
    getFeatureUsage.mockResolvedValue(summary())
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByText('3 / 4')).toBeInTheDocument()
  })

  it('exports the CSV for the selected range', async () => {
    getFeatureUsage.mockResolvedValue(summary())
    downloadFeatureUsageCsv.mockResolvedValue(undefined)
    render(<PlatformUsagePage />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
    expect(downloadFeatureUsageCsv).toHaveBeenCalledWith(30)
  })
})
