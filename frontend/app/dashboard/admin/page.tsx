'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { getAnalyticsDashboard, type ClinicDashboardResponse } from '@/lib/analyticsApi'
import {
  AppCard,
  AppCardHeader,
  AppCardTitle,
  AppCardContent,
  AppPageHeader,
  DateRangeFilter,
  LoadingSkeleton,
} from '@/components/ui-system'
import React, { useState, useEffect } from 'react'
import type { DateRangeOption, DateRange } from '@/components/ui-system/DateRangeFilter'
import { PageContainer } from '@/components/layout'
import {
  TrendingUp,
  Users,
  CreditCard,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  ShoppingBag,
  Gauge,
  Sparkles,
  ExternalLink,
  Globe2,
  Wand2,
  DollarSign,
  Package,
  Tag,
  Clock,
  CalendarCheck,
  ListX,
  UserX,
  Banknote,
  BarChart3,
  FileText,
  Receipt,
} from 'lucide-react'
import { AppButton } from '@/components/ui-system'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LaunchWebsiteModal } from '@/components/site/builder/LaunchWebsiteModal'
import { siteApi } from '@/lib/site/siteApi'
import { getClinic } from '@/lib/clinicApi'

export default function AdminDashboardPage() {
  const { user } = useAuth()
  if (user && user.role !== 'SUPER_ADMIN') {
    return null
  }
  return <AdminDashboardContent />
}

function AdminDashboardContent() {
  const { user } = useAuth()

  const [dateRangeOption, setDateRangeOption] = useState<DateRangeOption>('ALL_TIME')
  const [dateRangeValues, setDateRangeValues] = useState<DateRange>({})
  const [generatorOpen, setGeneratorOpen] = useState(false)

  const router = useRouter()
  const searchParams = useSearchParams()
  useEffect(() => {
    if (searchParams.get('openWebsite') === '1') {
      setGeneratorOpen(true)
      const remaining = new URLSearchParams(searchParams.toString())
      remaining.delete('openWebsite')
      const suffix = remaining.toString()
      router.replace(`/dashboard/admin${suffix ? `?${suffix}` : ''}`)
    }
  }, [searchParams, router])

  const { data: currentClinic } = useQuery({
    queryKey: ['clinic-current', user?.clinicId],
    queryFn: () => getClinic(user!.clinicId as string),
    enabled: !!user?.clinicId,
  })

  // Component 8: the website is live once it has been published; its address
  // is the canonical one (custom domain, subdomain, or <app>/s/<slug>).
  const { data: siteOverview } = useQuery({
    queryKey: ['site', 'overview'],
    queryFn: siteApi.getSite,
    enabled: !!user?.clinicId,
  })
  const websiteLive = !!siteOverview?.publishedAt
  const websiteUrl = websiteLive ? siteOverview!.urls.canonical : null

  const { data, isLoading } = useQuery({
    queryKey: ['admin-overview', dateRangeOption],
    queryFn: () =>
      getAnalyticsDashboard({
        dateFrom: dateRangeValues.startDate?.toISOString().slice(0, 10),
        dateTo: dateRangeValues.endDate?.toISOString().slice(0, 10),
      }),
    enabled: !!user?.clinicId,
  })

  const clinicData = data?.mode === 'clinic' ? (data as ClinicDashboardResponse).dashboard : null
  const stats = clinicData?.commandCenter

  return (
    <PageContainer className="space-y-6">
      <AppPageHeader
        title="Command Center"
        description="High-level clinic health and financial overview"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {!websiteLive && (
              <button
                type="button"
                onClick={() => setGeneratorOpen(true)}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90"
              >
                <Sparkles className="h-4 w-4" />
                Generate Website
              </button>
            )}
            <DateRangeFilter
              value={dateRangeOption}
              onChange={(opt, range) => {
                setDateRangeOption(opt)
                setDateRangeValues(range)
              }}
            />
          </div>
        }
      />

      <LaunchWebsiteModal
        open={generatorOpen}
        onOpenChange={setGeneratorOpen}
        defaultName={currentClinic?.name ?? user?.clinic?.name ?? ''}
      />

      <WebsiteStatusBanner
        clinicName={currentClinic?.name ?? user?.clinic?.name ?? 'your clinic'}
        websiteUrl={websiteUrl}
        themeColor={currentClinic?.themeColor ?? null}
        logoUrl={currentClinic?.logoUrl ?? null}
        onGenerate={() => setGeneratorOpen(true)}
      />

      {/* ── Row 1: Primary KPIs ───────────────────────────────────────── */}
      {isLoading ? (
        <LoadingSkeleton variant="stat" count={4} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total Revenue"
            value={`$${(stats?.finance.totalRevenue ?? 0).toLocaleString()}`}
            sub="vs last 30 days"
            badge="+12%"
            badgeUp
            icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
            iconBg="bg-emerald-50"
            tourId="kpi-revenue"
          />
          <KpiCard
            label="Appointments"
            value={String(stats?.operations.totalAppointments ?? 0)}
            sub="Total clinical volume"
            badge="Steady"
            icon={<CalendarCheck className="h-4 w-4 text-blue-600" />}
            iconBg="bg-blue-50"
            tourId="kpi-appointments"
          />
          <KpiCard
            label="Store Orders"
            value={String(stats?.commerce.ordersCount ?? 0)}
            sub="Checked out this period"
            badge={`${((stats?.commerce.attachRate ?? 0) * 100).toFixed(0)}% attach`}
            icon={<ShoppingBag className="h-4 w-4 text-purple-600" />}
            iconBg="bg-purple-50"
            tourId="kpi-orders"
          />
          <KpiCard
            label="Clinic Capacity"
            value={`${(stats?.operations.clinicCapacityRate ?? 0).toFixed(1)}%`}
            sub="Avg provider utilisation"
            badge={(stats?.operations.clinicCapacityRate ?? 0) >= 70 ? 'Optimal' : 'Below target'}
            badgeUp={(stats?.operations.clinicCapacityRate ?? 0) >= 70}
            icon={<Gauge className="h-4 w-4 text-teal-600" />}
            iconBg="bg-teal-50"
            tourId="kpi-capacity"
          />
        </div>
      )}

      {/* ── Row 2: Clinical · Finance · Commerce ─────────────────────── */}
      {isLoading ? (
        <LoadingSkeleton variant="stat" count={3} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Clinical pulse */}
          <AppCard>
            <AppCardHeader className="pb-3">
              <AppCardTitle className="flex items-center gap-2 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-50">
                  <Activity className="h-3.5 w-3.5 text-blue-600" />
                </span>
                Clinical Pulse
              </AppCardTitle>
            </AppCardHeader>
            <AppCardContent className="space-y-3">
              <MetricRow
                label="Cancellation rate"
                value={`${(stats?.operations.cancellationRate ?? 0).toFixed(1)}%`}
                icon={<ListX className="h-3.5 w-3.5 text-rose-400" />}
                warn={(stats?.operations.cancellationRate ?? 0) > 15}
              />
              <MetricRow
                label="No-show rate"
                value={`${(stats?.operations.noShowRate ?? 0).toFixed(1)}%`}
                icon={<UserX className="h-3.5 w-3.5 text-amber-400" />}
                warn={(stats?.operations.noShowRate ?? 0) > 10}
              />
              <MetricRow
                label="Avg visit duration"
                value={`${stats?.operations.averageAppointmentDuration ?? 0} min`}
                icon={<Clock className="h-3.5 w-3.5 text-slate-400" />}
              />
              <MetricRow
                label="Upcoming load"
                value={String(stats?.operations.upcomingLoadCount ?? 0)}
                icon={<CalendarCheck className="h-3.5 w-3.5 text-teal-500" />}
              />
              <MetricRow
                label="Waitlist"
                value={`${stats?.operations.waitlistCount ?? 0} (${(stats?.operations.waitlistConversionRate ?? 0).toFixed(0)}% conv.)`}
                icon={<Users className="h-3.5 w-3.5 text-indigo-400" />}
              />
            </AppCardContent>
          </AppCard>

          {/* Finance snapshot */}
          <AppCard>
            <AppCardHeader className="pb-3">
              <AppCardTitle className="flex items-center gap-2 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50">
                  <Banknote className="h-3.5 w-3.5 text-emerald-600" />
                </span>
                Revenue Breakdown
              </AppCardTitle>
            </AppCardHeader>
            <AppCardContent className="space-y-3">
              <MetricRow
                label="Collected"
                value={`$${(stats?.finance.collectedRevenue ?? 0).toLocaleString()}`}
                icon={<DollarSign className="h-3.5 w-3.5 text-emerald-500" />}
              />
              <MetricRow
                label="Net collected"
                value={`$${(stats?.finance.netCollectedRevenue ?? 0).toLocaleString()}`}
                icon={<DollarSign className="h-3.5 w-3.5 text-emerald-400" />}
              />
              <MetricRow
                label="Outstanding"
                value={`$${(stats?.finance.outstandingReceivables ?? 0).toLocaleString()}`}
                icon={<Receipt className="h-3.5 w-3.5 text-amber-400" />}
                warn={(stats?.finance.outstandingReceivables ?? 0) > 0}
              />
              <MetricRow
                label="Refunded"
                value={`$${(stats?.finance.refundedAmount ?? 0).toLocaleString()}`}
                icon={<ArrowDownRight className="h-3.5 w-3.5 text-rose-400" />}
              />
              <MetricRow
                label="Avg per visit"
                value={`$${(stats?.finance.averageRevenuePerVisit ?? 0).toFixed(0)}`}
                icon={<BarChart3 className="h-3.5 w-3.5 text-blue-400" />}
              />
            </AppCardContent>
          </AppCard>

          {/* Commerce health */}
          <AppCard>
            <AppCardHeader className="pb-3">
              <AppCardTitle className="flex items-center gap-2 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-purple-50">
                  <ShoppingBag className="h-3.5 w-3.5 text-purple-600" />
                </span>
                Commerce Health
              </AppCardTitle>
            </AppCardHeader>
            <AppCardContent className="space-y-3">
              <MetricRow
                label="Product revenue"
                value={`$${(stats?.commerce.productRevenue ?? 0).toLocaleString()}`}
                icon={<Tag className="h-3.5 w-3.5 text-purple-400" />}
              />
              <MetricRow
                label="Package revenue"
                value={`$${(stats?.commerce.packageRevenue ?? 0).toLocaleString()}`}
                icon={<Package className="h-3.5 w-3.5 text-indigo-400" />}
              />
              <MetricRow
                label="Membership revenue"
                value={`$${(stats?.commerce.membershipRevenue ?? 0).toLocaleString()}`}
                icon={<CreditCard className="h-3.5 w-3.5 text-pink-400" />}
              />
              <MetricRow
                label="Active memberships"
                value={String(stats?.memberships.activeCount ?? 0)}
                icon={<Users className="h-3.5 w-3.5 text-teal-500" />}
              />
              <MetricRow
                label="Churn rate"
                value={`${((stats?.memberships.churnRate ?? 0) * 100).toFixed(1)}%`}
                icon={<ArrowDownRight className="h-3.5 w-3.5 text-rose-400" />}
                warn={(stats?.memberships.churnRate ?? 0) > 0.05}
              />
            </AppCardContent>
          </AppCard>
        </div>
      )}

      {/* ── Row 3: Quick Actions ──────────────────────────────────────── */}
      <AppCard>
        <AppCardHeader className="pb-3">
          <AppCardTitle className="text-sm">Quick Actions</AppCardTitle>
        </AppCardHeader>
        <AppCardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              {
                href: '/dashboard/staff',
                icon: Users,
                label: 'Team',
                color: 'text-blue-600',
                bg: 'bg-blue-50',
              },
              {
                href: '/dashboard/services',
                icon: Activity,
                label: 'Services',
                color: 'text-teal-600',
                bg: 'bg-teal-50',
              },
              {
                href: '/dashboard/patients',
                icon: FileText,
                label: 'Patients',
                color: 'text-violet-600',
                bg: 'bg-violet-50',
              },
              {
                href: '/dashboard/products',
                icon: ShoppingBag,
                label: 'Storefront',
                color: 'text-purple-600',
                bg: 'bg-purple-50',
              },
              {
                href: '/dashboard/front-desk/invoices',
                icon: Receipt,
                label: 'Billing',
                color: 'text-amber-600',
                bg: 'bg-amber-50',
              },
              {
                href: '/dashboard/analytics',
                icon: TrendingUp,
                label: 'Analytics',
                color: 'text-emerald-600',
                bg: 'bg-emerald-50',
              },
            ].map(({ href, icon: Icon, label, color, bg }) => (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/50 p-4 text-center text-[13px] font-semibold text-slate-700 transition-colors hover:border-slate-200 hover:bg-white hover:shadow-sm"
              >
                <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', bg)}>
                  <Icon className={cn('h-5 w-5', color)} />
                </span>
                {label}
              </Link>
            ))}
          </div>
        </AppCardContent>
      </AppCard>
    </PageContainer>
  )
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  sub,
  badge,
  badgeUp,
  icon,
  iconBg,
  tourId,
}: {
  label: string
  value: string
  sub: string
  badge: string
  badgeUp?: boolean
  icon: React.ReactNode
  iconBg: string
  tourId?: string
}) {
  return (
    <AppCard data-tour-id={tourId} className="relative overflow-hidden">
      <AppCardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <p
            className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400"
            title={label}
          >
            {label}
          </p>
          <span
            className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', iconBg)}
          >
            {icon}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="min-w-0 truncate text-2xl font-bold tabular-nums text-slate-900">
            {value}
          </h3>
          {badge && (
            <span
              className={cn(
                'flex items-center whitespace-nowrap text-xs font-semibold',
                badgeUp === true
                  ? 'text-emerald-600'
                  : badgeUp === false
                    ? 'text-rose-500'
                    : 'text-slate-400'
              )}
            >
              {badgeUp === true && <ArrowUpRight className="h-3 w-3 mr-0.5" />}
              {badge}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-[11px] text-slate-400">{sub}</p>
      </AppCardContent>
    </AppCard>
  )
}

function MetricRow({
  label,
  value,
  icon,
  warn,
}: {
  label: string
  value: string
  icon: React.ReactNode
  warn?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 text-sm text-slate-500">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <span
        className={cn(
          'shrink-0 text-sm font-semibold tabular-nums',
          warn ? 'text-amber-600' : 'text-slate-800'
        )}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * WebsiteStatusBanner — sits above the Command Center KPIs so the patient
 * site is the first thing the admin sees on every visit.
 */
function WebsiteStatusBanner({
  clinicName,
  websiteUrl,
  themeColor,
  logoUrl,
  onGenerate,
}: {
  clinicName: string
  websiteUrl: string | null
  themeColor: string | null
  logoUrl: string | null
  onGenerate: () => void
}) {
  if (!websiteUrl) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 p-6 sm:p-8">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-md">
              <Wand2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-violet-600">
                One-tap setup · 30 seconds
              </p>
              <h2 className="mt-1 text-2xl font-black text-slate-900">
                Your patient website isn't live yet.
              </h2>
              <p className="mt-1 max-w-xl text-sm text-slate-600">
                Generate a branded booking site for {clinicName}. Patients can sign up and book the
                moment it's live.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onGenerate}
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 text-sm font-bold text-white shadow-md transition-opacity hover:opacity-90"
          >
            <Sparkles className="h-4 w-4" />
            Generate Website
          </button>
        </div>
      </div>
    )
  }

  const accent = themeColor || '#0D9488'
  return (
    <div
      className="relative overflow-hidden rounded-2xl border bg-white p-6 sm:p-8"
      style={{ borderColor: `${accent}30` }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background: `radial-gradient(circle at 0% 0%, ${accent}25 0%, transparent 55%), radial-gradient(circle at 100% 100%, ${accent}10 0%, transparent 50%)`,
        }}
      />
      <div className="relative flex flex-col items-start gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={`${clinicName} logo`}
              className="h-12 w-12 shrink-0 rounded-2xl border border-white object-cover shadow-sm"
            />
          ) : (
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm"
              style={{ backgroundColor: accent }}
            >
              <Globe2 className="h-6 w-6" />
            </div>
          )}
          <div className="min-w-0">
            <p
              className="text-[10px] font-black uppercase tracking-widest"
              style={{ color: accent }}
            >
              Patient website · Live
            </p>
            <h2 className="mt-1 truncate text-xl font-black text-slate-900 sm:text-2xl">
              {clinicName}
            </h2>
            <code className="mt-1 inline-flex items-center gap-1 truncate font-mono text-xs text-slate-500">
              {websiteUrl.replace(/^https?:\/\//, '')}
            </code>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: accent }}
          >
            <ExternalLink className="h-4 w-4" />
            Open site
          </a>
          <a
            href="/dashboard/site"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Wand2 className="h-4 w-4" />
            Edit website
          </a>
        </div>
      </div>
    </div>
  )
}
