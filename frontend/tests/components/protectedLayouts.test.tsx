/**
 * F0.2.4 — a protected route never renders its content before auth has
 * resolved, nor for a user the guard sends elsewhere.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { User } from '@/lib/types'

const replace = vi.fn()
const push = vi.fn()
let pathname = '/dashboard'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, refresh: vi.fn() }),
  usePathname: () => pathname,
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

let auth: { user: User | null; isLoading: boolean; isAuthenticated: boolean }
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/contexts/TourContext', () => ({ useTour: () => ({ start: vi.fn() }) }))
vi.mock('@/components/layout/AppSidebar', () => ({ AppSidebar: () => <nav>sidebar</nav> }))
vi.mock('@/components/layout/AppSidebarMobile', () => ({ AppSidebarMobile: () => null }))
vi.mock('@/components/layout/TopBar', () => ({ TopBar: () => <header>topbar</header> }))

import { DashboardLayout } from '@/components/layout/DashboardLayout'
import AccountLayout from '@/app/(public)/account/layout'
import PlatformLayout from '@/app/platform/layout'

const PHI_MARKER = 'Synthetic Patient Chart — DOB 1980-02-03'
const Chart = () => <p>{PHI_MARKER}</p>

const user = (role: User['role']): User => ({
  id: 'u1',
  name: 'Synthetic Staff',
  email: 'staff@example.test',
  role,
  clinicId: 'c1',
  clinic: {
    id: 'c1',
    name: 'Clinic',
    tenant: {
      id: 't1',
      name: 'T',
      onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
      onboardingStep: 9,
      termsAcceptedAt: '2026-01-01T00:00:00.000Z',
      termsVersion: '1',
    },
  },
})

beforeEach(() => {
  replace.mockReset()
  push.mockReset()
  pathname = '/dashboard'
})

describe('DashboardLayout', () => {
  it('while auth is resolving: a skeleton only, never the page', () => {
    auth = { user: null, isLoading: true, isAuthenticated: false }
    render(
      <DashboardLayout>
        <Chart />
      </DashboardLayout>
    )
    expect(screen.queryByText(PHI_MARKER)).not.toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('anonymous: nothing rendered, redirected to sign-in', () => {
    auth = { user: null, isLoading: false, isAuthenticated: false }
    pathname = '/dashboard/patients'
    const { container } = render(
      <DashboardLayout>
        <Chart />
      </DashboardLayout>
    )
    expect(container).toBeEmptyDOMElement()
    expect(replace).toHaveBeenCalledWith('/?auth=login&returnUrl=%2Fdashboard%2Fpatients')
  })

  it('a patient on /dashboard: nothing rendered, sent to /account', () => {
    auth = { user: user('PATIENT'), isLoading: false, isAuthenticated: true }
    render(
      <DashboardLayout>
        <Chart />
      </DashboardLayout>
    )
    expect(screen.queryByText(PHI_MARKER)).not.toBeInTheDocument()
    expect(replace).toHaveBeenCalledWith('/account')
  })

  it('a provider on an admin route: nothing rendered (no flash before the redirect)', () => {
    auth = { user: user('PROVIDER'), isLoading: false, isAuthenticated: true }
    pathname = '/dashboard/staff'
    render(
      <DashboardLayout>
        <Chart />
      </DashboardLayout>
    )
    expect(screen.queryByText(PHI_MARKER)).not.toBeInTheDocument()
    expect(replace).toHaveBeenCalledWith('/dashboard')
  })

  it('an allowed user sees the page', () => {
    auth = { user: user('PROVIDER'), isLoading: false, isAuthenticated: true }
    render(
      <DashboardLayout>
        <Chart />
      </DashboardLayout>
    )
    expect(screen.getByText(PHI_MARKER)).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('Patient portal and platform layouts', () => {
  it('portal: loading and staff users never see patient content', () => {
    pathname = '/account/billing'
    auth = { user: null, isLoading: true, isAuthenticated: false }
    const { rerender } = render(
      <AccountLayout>
        <Chart />
      </AccountLayout>
    )
    expect(screen.queryByText(PHI_MARKER)).not.toBeInTheDocument()

    auth = { user: user('PROVIDER'), isLoading: false, isAuthenticated: true }
    rerender(
      <AccountLayout>
        <Chart />
      </AccountLayout>
    )
    expect(screen.queryByText(PHI_MARKER)).not.toBeInTheDocument()
    expect(replace).toHaveBeenCalledWith('/dashboard')

    auth = { user: user('PATIENT'), isLoading: false, isAuthenticated: true }
    rerender(
      <AccountLayout>
        <Chart />
      </AccountLayout>
    )
    expect(screen.getByText(PHI_MARKER)).toBeInTheDocument()
  })

  it('platform: only platform admins', () => {
    auth = { user: user('SUPER_ADMIN'), isLoading: false, isAuthenticated: true }
    const { rerender } = render(
      <PlatformLayout>
        <Chart />
      </PlatformLayout>
    )
    expect(screen.queryByText(PHI_MARKER)).not.toBeInTheDocument()
    expect(replace).toHaveBeenCalledWith('/dashboard')

    auth = { user: user('PLATFORM_ADMIN'), isLoading: false, isAuthenticated: true }
    rerender(
      <PlatformLayout>
        <Chart />
      </PlatformLayout>
    )
    expect(screen.getByText(PHI_MARKER)).toBeInTheDocument()
  })
})
