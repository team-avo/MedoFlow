'use client'

import Link from 'next/link'
import {
  CalendarCheck,
  FileText,
  ShoppingBag,
  Ticket,
  Receipt,
  User,
  ArrowRight,
} from 'lucide-react'
import { AppCard, AppCardContent } from '@/components/ui-system'

const TILES = [
  {
    href: '/account/appointments',
    label: 'Appointments',
    description: 'Upcoming & past visits',
    icon: CalendarCheck,
    accent: 'bg-indigo-50 text-indigo-600',
  },
  {
    href: '/account/summaries',
    label: 'Visit Summaries',
    description: 'SOAP notes, prescriptions, documents',
    icon: FileText,
    accent: 'bg-emerald-50 text-emerald-600',
  },
  {
    href: '/account/purchases',
    label: 'Purchases',
    description: 'Product order history',
    icon: ShoppingBag,
    accent: 'bg-amber-50 text-amber-600',
  },
  {
    href: '/account/subscriptions',
    label: 'Subscriptions & Packages',
    description: 'Memberships, remaining sessions',
    icon: Ticket,
    accent: 'bg-purple-50 text-purple-600',
  },
  {
    href: '/account/billing',
    label: 'Billing & Payments',
    description: 'Invoices and dues',
    icon: Receipt,
    accent: 'bg-sky-50 text-sky-600',
  },
  {
    href: '/account/profile',
    label: 'Profile',
    description: 'Personal details & preferences',
    icon: User,
    accent: 'bg-rose-50 text-rose-600',
  },
]

export default function AccountOverviewPage() {
  return (
    <div className="space-y-6">
      <AppCard>
        <AppCardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Book your next appointment</p>
            <p className="mt-1 text-sm text-slate-600">
              Pick a time with any of your clinic's providers — online, in seconds.
            </p>
          </div>
          <Link
            data-tour-id="account-book"
            href="/store"
            className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Book appointment
            <ArrowRight className="h-4 w-4" />
          </Link>
        </AppCardContent>
      </AppCard>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => {
          const Icon = t.icon
          return (
            <Link
              key={t.href}
              href={t.href}
              className="group block rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-colors hover:shadow-md"
            >
              <div
                className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl ${t.accent}`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-slate-900">{t.label}</p>
              <p className="mt-1 text-xs text-slate-600">{t.description}</p>
              <p className="mt-3 flex items-center gap-1 text-xs font-medium text-indigo-600 opacity-0 transition-opacity group-hover:opacity-100">
                Open <ArrowRight className="h-3 w-3" />
              </p>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
