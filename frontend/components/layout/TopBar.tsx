'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  AlertCircle,
  Bell,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  LogOut,
  Menu,
  Settings,
  User as UserIcon,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { UserAvatar } from '@/components/common/UserAvatar'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { getAnalyticsDashboard, type ClinicDashboardResponse } from '@/lib/analyticsApi'

interface TopBarProps {
  onOpenMobileNav?: () => void
  onRestartTour?: () => void
}

/**
 * Prisma-style CUIDs (our default id format) always start with a lowercase `c`
 * and are ~24 chars of lowercase alphanumerics. UUIDs are the dashed 36-char
 * variant. We drop both from breadcrumbs — they're visual noise.
 */
function isOpaqueId(seg: string): boolean {
  return (
    /^c[a-z0-9]{20,30}$/.test(seg) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(seg)
  )
}

function formatCrumb(seg: string): string {
  if (seg === 'dashboard') return 'Dashboard'
  return seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Dashboard-wide top bar. Replaces the old inline header strip in DashboardLayout.
 * - Left: hamburger (mobile) + breadcrumbs
 * - Right: notifications bell (UI stub), avatar dropdown
 */
export function TopBar({ onOpenMobileNav, onRestartTour }: TopBarProps) {
  const pathname = usePathname() ?? ''
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const [alertMenuOpen, setAlertMenuOpen] = React.useState(false)
  const [alertsSeen, setAlertsSeen] = React.useState(false)
  const alertMenuRef = React.useRef<HTMLDivElement | null>(null)

  const isAdminRole = user?.role === 'SUPER_ADMIN' || user?.role === 'STAFF'
  const { data: alertData } = useQuery({
    queryKey: ['topbar-alerts', user?.clinicId],
    queryFn: () => getAnalyticsDashboard({}),
    enabled: isAdminRole && !!user?.clinicId,
    staleTime: 5 * 60 * 1000,
  })
  const alerts =
    alertData?.mode === 'clinic'
      ? (alertData as ClinicDashboardResponse).dashboard.commandCenter.alerts
      : []
  const alertCount = alerts.length
  const hasAlerts = alertCount > 0

  // Reset "seen" state whenever a new alert appears
  React.useEffect(() => {
    if (hasAlerts) setAlertsSeen(false)
  }, [alertCount, hasAlerts])

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
      if (alertMenuRef.current && !alertMenuRef.current.contains(event.target as Node)) {
        setAlertMenuOpen(false)
      }
    }
    if (menuOpen || alertMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen, alertMenuOpen])

  const crumbs = React.useMemo(() => {
    const parts = pathname.split('/').filter(Boolean)
    return parts
      .map((seg, idx) => ({
        raw: seg,
        label: formatCrumb(seg),
        href: '/' + parts.slice(0, idx + 1).join('/'),
      }))
      .filter((c) => !isOpaqueId(c.raw))
  }, [pathname])

  const roleLabel = user?.role?.replace('_', ' ') ?? ''

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 md:px-8">
      {/* Left: hamburger (mobile) + breadcrumbs */}
      <button
        type="button"
        onClick={onOpenMobileNav}
        className="-ml-2 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      <nav
        aria-label="Breadcrumb"
        className="hidden min-w-0 flex-1 items-center gap-1 text-sm text-slate-500 md:flex"
      >
        {crumbs.map((crumb, idx) => (
          <React.Fragment key={crumb.href}>
            {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
            {idx === crumbs.length - 1 ? (
              <span className="truncate font-medium text-slate-900">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="truncate hover:text-slate-900">
                {crumb.label}
              </Link>
            )}
          </React.Fragment>
        ))}
      </nav>

      {/* Mobile: the current page title in place of the breadcrumbs. */}
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 md:hidden">
        {crumbs[crumbs.length - 1]?.label ?? ''}
      </p>

      {/* Right: actions */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Alert indicator — SUPER_ADMIN / STAFF only */}
        {isAdminRole && (
          <div className="relative" ref={alertMenuRef}>
            <button
              type="button"
              onClick={() => {
                setAlertMenuOpen((v) => !v)
                setAlertsSeen(true)
              }}
              className={cn(
                'relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                hasAlerts ? 'text-amber-600 hover:bg-amber-50' : 'text-slate-400 hover:bg-slate-100'
              )}
              aria-label={
                hasAlerts ? `${alertCount} active alert${alertCount !== 1 ? 's' : ''}` : 'No alerts'
              }
            >
              {/* Unseen alerts: a static amber tint, no ripple or bounce. */}
              {hasAlerts && !alertsSeen && (
                <span className="absolute inset-0 rounded-lg bg-amber-400/20" />
              )}
              <AlertCircle className="relative h-5 w-5" />
              {hasAlerts && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow">
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </button>

            {alertMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl"
              >
                <div className="border-b border-slate-100 px-4 py-3 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                  <p className="text-sm font-semibold text-slate-900">
                    Active Alerts
                    {hasAlerts && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                        {alertCount}
                      </span>
                    )}
                  </p>
                </div>
                <div className="max-h-80 overflow-y-auto p-3 space-y-2">
                  {hasAlerts ? (
                    alerts.map((alert) => (
                      <div
                        key={alert.id}
                        className={cn(
                          'flex items-start gap-3 rounded-xl p-3 text-sm border',
                          alert.severity === 'critical'
                            ? 'bg-rose-50 text-rose-800 border-rose-100'
                            : 'bg-amber-50 text-amber-800 border-amber-100'
                        )}
                      >
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        <div className="min-w-0 break-words">
                          <p className="font-semibold">{alert.title}</p>
                          <p className="text-[12px] mt-0.5 opacity-80">{alert.message}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-700">
                      <span className="text-base">✓</span>
                      <div>
                        <p className="font-semibold">All clear</p>
                        <p className="text-[12px] opacity-80">No active alerts right now.</p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="border-t border-slate-100 px-4 py-2.5">
                  <Link
                    href="/dashboard/admin"
                    onClick={() => setAlertMenuOpen(false)}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 transition-colors"
                  >
                    View Command Center →
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
          aria-label="Notifications (coming soon)"
          disabled
        >
          <Bell className="h-5 w-5" />
        </button>

        <div className="relative ml-1" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              // max-w lets the name's `truncate` engage instead of widening the bar.
              'flex max-w-[13rem] items-center gap-2.5 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2 text-left shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 sm:pr-3 lg:max-w-[16rem]',
              menuOpen && 'border-slate-300 bg-slate-50'
            )}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={user?.name ? `Open ${user.name}'s menu` : 'Open user menu'}
          >
            <UserAvatar
              seed={`${user?.id ?? ''}-${user?.name ?? ''}`}
              alt={user?.name ?? 'User'}
              className="h-8 w-8 shrink-0 rounded-full"
              sizes="32px"
            />
            <span className="hidden min-w-0 flex-col text-left leading-tight sm:flex">
              <span className="truncate text-sm font-semibold text-slate-900">
                {user?.name ?? 'User'}
              </span>
              {roleLabel && (
                <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {roleLabel}
                </span>
              )}
            </span>
            <ChevronDown
              className={cn(
                'hidden h-4 w-4 shrink-0 text-slate-400 transition-transform sm:block',
                menuOpen && 'rotate-180'
              )}
            />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-lg"
            >
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-sm font-semibold text-slate-900 truncate">{user?.name}</p>
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {roleLabel}
                </p>
              </div>
              <div className="py-1">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    onRestartTour?.()
                  }}
                  disabled={!onRestartTour}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <HelpCircle className="h-4 w-4 text-slate-400" />
                  Restart tour
                </button>
                <Link
                  href="/dashboard/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Settings className="h-4 w-4 text-slate-400" />
                  Security
                </Link>
                <Link
                  href="/account/profile"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <UserIcon className="h-4 w-4 text-slate-400" />
                  Profile
                </Link>
              </div>
              <div className="border-t border-slate-100 py-1">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    logout()
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-rose-600 hover:bg-rose-50"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
