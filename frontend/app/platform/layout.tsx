'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Building2, Users, ShieldAlert } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { LoadingSkeleton } from '@/components/ui-system'
import { cn } from '@/lib/utils'
import { platformRedirect } from '@/lib/routeGuards'

const NAV = [{ href: '/platform/clinics', label: 'Clinics', icon: Users }] as const

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isLoading, isAuthenticated } = useAuth()

  const redirectTo = isLoading ? null : platformRedirect(isAuthenticated ? user : null)

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo)
  }, [redirectTo, router])

  if (isLoading || !user || redirectTo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingSkeleton variant="avatar" count={1} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/platform/clinics" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-slate-900">
              MedoFlow Platform
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname?.startsWith(item.href + '/')
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
                    active ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-900'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="flex min-w-0 max-w-[16rem] items-center text-xs text-slate-500">
            <Building2 className="mr-1 h-3.5 w-3.5 shrink-0" />
            <span className="truncate" title={user.email}>
              {user.email}
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  )
}
