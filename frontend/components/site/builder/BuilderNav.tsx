'use client'

/** Tabs across the website builder screens. */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { useSiteOverview } from './BuilderData'

const TABS = [
  { href: '/dashboard/site', label: 'Overview', roles: ['SUPER_ADMIN', 'MARKETING'] },
  { href: '/dashboard/site/editor', label: 'Editor', roles: ['SUPER_ADMIN', 'MARKETING'] },
  { href: '/dashboard/site/templates', label: 'Templates', roles: ['SUPER_ADMIN', 'MARKETING'] },
  { href: '/dashboard/site/media', label: 'Images', roles: ['SUPER_ADMIN', 'MARKETING'] },
  { href: '/dashboard/site/domains', label: 'Domains', roles: ['SUPER_ADMIN'] },
  { href: '/dashboard/site/redirects', label: 'Redirects', roles: ['SUPER_ADMIN', 'MARKETING'] },
  { href: '/dashboard/site/leads', label: 'Enquiries', roles: ['SUPER_ADMIN', 'FRONT_DESK'] },
]

export function BuilderNav() {
  const pathname = usePathname()
  const { user } = useAuth()
  const role = user?.role ?? ''
  const canEdit = role === 'SUPER_ADMIN' || role === 'MARKETING'
  const { data: site } = useSiteOverview()
  const tabs = TABS.filter((t) => t.roles.includes(role))
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2">
      <nav aria-label="Website builder" className="flex flex-wrap gap-1">
        {tabs.map((t) => {
          const active =
            t.href === '/dashboard/site' ? pathname === t.href : pathname?.startsWith(t.href)
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      {canEdit && site?.urls.canonical && site.publishedAt && (
        <a
          href={site.urls.canonical}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
        >
          View live site <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  )
}
