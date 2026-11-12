/**
 * Demo feedback WS4: plan cards (pricing page / landing #pricing) and the
 * sign-up helpers.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const getPlans = vi.fn()
vi.mock('@/lib/tenantApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/tenantApi')>()),
  getPlans: () => getPlans(),
}))

import { PlanCards } from '@/components/marketing/PlanCards'
import { priceLabel, toSubdomain, isValidSubdomain } from '@/lib/tenantApi'

const catalog = (billingMode: 'trial' | 'demo') => ({
  billingMode,
  trialDays: 14,
  plans: [
    {
      key: 'FREE',
      name: 'Free',
      monthlyPrice: 0,
      tagline: 't',
      highlights: ['Booking'],
      selfServe: true,
    },
    {
      key: 'GROWTH',
      name: 'Growth',
      monthlyPrice: 149,
      tagline: 't',
      highlights: ['Video'],
      selfServe: true,
      recommended: true,
    },
    {
      key: 'ENTERPRISE',
      name: 'Enterprise',
      monthlyPrice: null,
      tagline: 't',
      highlights: [],
      selfServe: false,
    },
  ],
})

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  )

describe('PlanCards', () => {
  it('trial: prices, a trial link per self-serve plan, sales for Enterprise, the trial note', async () => {
    getPlans.mockResolvedValue(catalog('trial'))
    wrap(<PlanCards />)
    expect(await screen.findByRole('link', { name: 'Start free trial: Growth' })).toHaveAttribute(
      'href',
      '/get-started?plan=GROWTH'
    )
    expect(screen.getByText('$149/mo')).toBeInTheDocument()
    expect(screen.getByText('Most popular')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Contact sales' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:/)
    )
    expect(screen.getByText(/14-day free trial/)).toBeInTheDocument()
    expect(screen.queryByTestId('demo-plans-banner')).toBeNull()
  })

  it('demo: the banner says plans are illustrative, and no trial wording', async () => {
    getPlans.mockResolvedValue(catalog('demo'))
    wrap(<PlanCards />)
    expect(await screen.findByTestId('demo-plans-banner')).toHaveTextContent(/illustrative/)
    expect(screen.getByRole('link', { name: 'Create your clinic: Free' })).toBeInTheDocument()
    expect(screen.queryByText(/14-day free trial/)).toBeNull()
  })
})

describe('sign-up helpers', () => {
  it('turns typed text into a valid web address', () => {
    expect(toSubdomain('Sunrise Family Clinic!')).toBe('sunrise-family-clinic-')
    expect(toSubdomain('--Dr. Ana   & Co')).toBe('dr-ana-co')
    expect(isValidSubdomain('sunrise-family-clinic')).toBe(true)
    expect(isValidSubdomain('ab')).toBe(false)
    expect(isValidSubdomain('-bad')).toBe(false)
  })

  it('labels prices', () => {
    expect(priceLabel({ monthlyPrice: 0 })).toBe('Free')
    expect(priceLabel({ monthlyPrice: 49 })).toBe('$49/mo')
    expect(priceLabel({ monthlyPrice: null })).toBe('Custom')
  })
})
