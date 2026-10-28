'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  CalendarCheck,
  FileText,
  ShoppingBag,
  Ticket,
  Receipt,
  User as UserIcon,
  LayoutDashboard,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { LoadingSkeleton } from '@/components/ui-system'
import { cn } from '@/lib/utils'
import { accountRedirect } from '@/lib/routeGuards'

const NAV = [
  { href: '/account', label: 'Overview', icon: LayoutDashboard, tourId: 'account-overview' },
  { href: '/account/appointments', label: 'Appointments', icon: CalendarCheck },
  { href: '/account/summaries', label: 'Visit Summaries', icon: FileText },
  { href: '/account/purchases', label: 'Purchases', icon: ShoppingBag },
  { href: '/account/subscriptions', label: 'Subscriptions', icon: Ticket },
  { href: '/account/billing', label: 'Billing', icon: Receipt },
  { href: '/account/profile', label: 'Profile', icon: UserIcon, tourId: 'account-profile' },
]

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const { user, isLoading, isAuthenticated } = useAuth()

  // Pure guard (lib/routeGuards.ts); nothing renders until it allows this user.
  const redirectTo = isLoading ? null : accountRedirect(isAuthenticated ? user : null, pathname)

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo)
  }, [redirectTo, router])

  if (isLoading || !user || redirectTo) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <LoadingSkeleton variant="page" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">My Account</p>
        <h1 className="mt-1 break-words text-3xl font-bold text-slate-900">
          Welcome back, {user.name.split(' ')[0]}
        </h1>
      </div>

      <div className="grid gap-8 md:grid-cols-[220px_1fr]">
        <aside>
          <nav className="space-y-1">
            {NAV.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== '/account' && pathname.startsWith(item.href))
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  {...(item.tourId ? { 'data-tour-id': item.tourId } : {})}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors',
                    active
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-slate-100'
                  )}
                >
                  <Icon className={cn('h-4 w-4', active ? 'text-white' : 'text-slate-400')} />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  )
}
