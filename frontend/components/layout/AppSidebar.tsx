'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard,
  Calendar,
  Users,
  BarChart3,
  ClipboardList,
  Receipt,
  Video,
  FileText,
  Package,
  ShoppingCart,
  Tags,
  ShieldCheck,
  Sparkles,
  Zap,
  Globe,
  Inbox,
  LayoutTemplate,
  PenSquare,
} from 'lucide-react'
import { BrandLogo } from '@/components/common/BrandLogo'

interface SidebarItem {
  href: string
  label: string
  icon: any
}

interface SidebarSection {
  title: string
  items: SidebarItem[]
}

const patientSections: SidebarSection[] = [
  {
    title: 'My Care',
    items: [
      { href: '/account', label: 'Overview', icon: LayoutDashboard },
      { href: '/account/appointments', label: 'Visits', icon: Calendar },
      { href: '/account/billing', label: 'Billing & History', icon: Receipt },
    ],
  },
  {
    title: 'Shop',
    // `/store` is the single entry point; product and package browsing happen
    // via tabs inside the storefront.
    items: [{ href: '/store', label: 'Store', icon: ShoppingCart }],
  },
]

const providerSections: SidebarSection[] = [
  {
    title: 'Clinical',
    // "Queue" (the appointments list) is now the primary clinical surface.
    // Calendar view still exists at /dashboard/provider/calendar — reachable
    // from the dashboard's "Full Calendar" CTA — but not in the sidebar,
    // to avoid duplicating the same-data views.
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/appointments', label: 'Queue', icon: ClipboardList },
    ],
  },
  {
    title: 'Telehealth',
    items: [{ href: '/dashboard/provider/meetings', label: 'Video Room', icon: Video }],
  },
  {
    title: 'Insights',
    items: [{ href: '/dashboard/analytics', label: 'Performance', icon: BarChart3 }],
  },
  {
    title: 'Commerce',
    items: [{ href: '/store', label: 'Store', icon: ShoppingCart }],
  },
]

// SUPER_ADMIN sidebar is intentionally trim. Less-used routes still work by
// direct URL (e.g. /dashboard/disciplines, /dashboard/locations) — they just
// aren't promoted in the nav to keep the console focused on day-to-day work.
const superAdminSections: SidebarSection[] = [
  {
    title: 'Main',
    items: [
      { href: '/dashboard/admin', label: 'Command Center', icon: LayoutDashboard },
      { href: '/dashboard/staff', label: 'Team', icon: Users },
    ],
  },
  {
    title: 'Clinical',
    items: [
      { href: '/dashboard/patients', label: 'Patients', icon: Users },
      { href: '/dashboard/appointments', label: 'Appointments', icon: ClipboardList },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { href: '/dashboard/services', label: 'Services', icon: ClipboardList },
      { href: '/dashboard/forms', label: 'Forms', icon: FileText },
    ],
  },
  {
    title: 'Commerce',
    items: [
      { href: '/dashboard/products', label: 'Storefront', icon: ShoppingCart },
      { href: '/dashboard/packages', label: 'Packages', icon: Package },
      { href: '/dashboard/memberships', label: 'Memberships', icon: Tags },
      { href: '/dashboard/front-desk/invoices', label: 'Billing', icon: Receipt },
      { href: '/dashboard/commissions', label: 'Commissions', icon: Tags },
    ],
  },
  {
    title: 'Website',
    items: [
      { href: '/dashboard/site', label: 'Website', icon: Globe },
      { href: '/dashboard/site/editor', label: 'Editor', icon: PenSquare },
      { href: '/dashboard/site/templates', label: 'Templates', icon: LayoutTemplate },
      { href: '/dashboard/site/leads', label: 'Enquiries', icon: Inbox },
    ],
  },
  {
    title: 'Insights',
    items: [
      { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/dashboard/audit', label: 'Compliance', icon: ShieldCheck },
    ],
  },
]

// FRONT_DESK: operations-focused. Store (patient-facing shop) lives elsewhere —
// front-desk transacts via Checkout/POS, so a separate "Store" link here is
// duplicative and was removed.
const frontDeskSections: SidebarSection[] = [
  {
    title: 'Today',
    items: [
      { href: '/dashboard/front-desk', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/front-desk/pos', label: 'Checkout', icon: ShoppingCart },
    ],
  },
  {
    title: 'Clinical Ops',
    items: [
      { href: '/dashboard/appointments', label: 'Appointments', icon: ClipboardList },
      { href: '/dashboard/patients', label: 'Patients', icon: Users },
      { href: '/dashboard/forms', label: 'Intake Forms', icon: FileText },
    ],
  },
  {
    title: 'Finance',
    items: [{ href: '/dashboard/front-desk/invoices', label: 'Billing', icon: Receipt }],
  },
  {
    title: 'Website',
    items: [{ href: '/dashboard/site/leads', label: 'Enquiries', icon: Inbox }],
  },
]

// MARKETING: the clinic website only (Component 8).
const marketingSections: SidebarSection[] = [
  {
    title: 'Website',
    items: [
      { href: '/dashboard/site', label: 'Website', icon: Globe },
      { href: '/dashboard/site/editor', label: 'Editor', icon: PenSquare },
      { href: '/dashboard/site/templates', label: 'Templates', icon: LayoutTemplate },
    ],
  },
]

/**
 * Slug a nav href into a tour anchor id (e.g. /dashboard/admin -> nav-dashboard-admin).
 */
function anchorIdFor(href: string): string {
  const path = href.split('?')[0]?.replace(/^\//, '').replace(/\//g, '-') ?? ''
  return `nav-${path || 'home'}`
}

interface SidebarContentProps {
  /** when true, sidebar renders without `fixed` positioning (for use in a drawer) */
  variant?: 'fixed' | 'static'
}

export function SidebarContent({ variant = 'fixed' }: SidebarContentProps) {
  const pathname = usePathname()
  const { user } = useAuth()

  const sections =
    user?.role === 'PATIENT'
      ? patientSections
      : user?.role === 'PROVIDER'
        ? providerSections
        : user?.role === 'SUPER_ADMIN' || user?.role === 'STAFF'
          ? superAdminSections
          : user?.role === 'FRONT_DESK'
            ? frontDeskSections
            : user?.role === 'MARKETING'
              ? marketingSections
              : []

  const asideClass = cn(
    'flex flex-col text-white relative overflow-hidden',
    // Layered gradient — deeper at the top, slightly warmer at the bottom.
    'bg-gradient-to-b from-[#16304F] via-[#1D3A5F] to-[#273F63]',
    variant === 'fixed'
      ? 'fixed left-0 top-0 z-40 h-screen w-[264px] border-r border-white/5'
      : 'h-full w-full'
  )

  // Role-specific chip shown under the logo — gives the workspace an identity.
  const roleBadge =
    user?.role === 'PROVIDER'
      ? { label: 'Clinical Workspace', dot: '#14B8A6' }
      : user?.role === 'FRONT_DESK'
        ? { label: 'Operations Desk', dot: '#F59E0B' }
        : user?.role === 'SUPER_ADMIN' || user?.role === 'STAFF'
          ? { label: 'Admin Console', dot: '#6366F1' }
          : { label: 'Patient Portal', dot: '#EC4899' }

  // Role-specific bottom card — gentle nudge rather than a pushy upsell.
  const footerCard =
    user?.role === 'PROVIDER'
      ? {
          icon: Sparkles,
          title: 'AI Scribe tips',
          body: 'Get faster, cleaner SOAP notes in every consult.',
          cta: 'See tips',
          href: '/dashboard',
        }
      : user?.role === 'FRONT_DESK'
        ? {
            icon: Zap,
            title: 'Faster checkout',
            body: 'Keyboard shortcuts for invoices and POS.',
            cta: 'Show me',
            href: '/dashboard/front-desk',
          }
        : user?.role === 'SUPER_ADMIN' || user?.role === 'STAFF'
          ? {
              icon: Sparkles,
              title: 'Clinic playbook',
              body: 'Best-practice setup for services & commissions.',
              cta: 'Open guide',
              href: '/dashboard/admin',
            }
          : null

  return (
    <aside className={asideClass}>
      {/* Ambient brand glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -left-16 h-64 w-64 rounded-full bg-[#1C8B81]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[28%] -right-20 h-48 w-48 rounded-full bg-[#6366F1]/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-10 h-64 w-64 rounded-full bg-[#4C7DCC]/20 blur-3xl"
      />

      {/* Header: Logo + workspace chip */}
      <div className="relative shrink-0 px-5 pt-5 pb-4">
        <Link href="/dashboard" className="group/logo inline-flex items-center">
          <BrandLogo size="md" tone="light" />
        </Link>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70 backdrop-blur-sm">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: roleBadge.dot }}
          />
          {roleBadge.label}
        </div>
      </div>

      {/* Divider */}
      <div
        aria-hidden
        className="relative mx-5 h-px shrink-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
      />

      {/* Navigation */}
      <nav className="custom-scrollbar relative flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {sections.map((section, sIdx) => (
          <div key={section.title} className="space-y-1">
            <div className="flex items-center gap-2 px-3 pb-1">
              <span className="h-px flex-1 bg-white/5" aria-hidden />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
                {section.title}
              </p>
              <span className="h-px flex-1 bg-white/5" aria-hidden />
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const itemPath = item.href.split('?')[0] ?? item.href
                const isActive =
                  pathname === itemPath ||
                  (itemPath !== '/dashboard' && pathname.startsWith(itemPath))
                const Icon = item.icon
                const tourId = anchorIdFor(item.href)
                return (
                  <Link
                    key={`${item.href}-${item.label}`}
                    href={item.href}
                    data-tour-id={tourId}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-all duration-200',
                      isActive
                        ? 'bg-gradient-to-r from-white/[0.14] via-white/[0.06] to-transparent font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09),_0_1px_3px_rgba(0,0,0,0.12)]'
                        : 'text-white/65 hover:bg-white/5 hover:text-white'
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {/* Active: teal pill on the left edge */}
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-[3px] rounded-r-full bg-gradient-to-b from-[#14B8A6] via-[#0D9488] to-[#0F766E] shadow-[0_0_14px_rgba(20,184,166,0.55)]"
                      />
                    )}
                    <span
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200',
                        isActive
                          ? 'bg-gradient-to-br from-[#14B8A6]/25 to-[#0D9488]/10 text-white ring-1 ring-[#14B8A6]/30 shadow-[0_0_16px_rgba(20,184,166,0.25)]'
                          : 'bg-white/[0.04] text-white/55 ring-1 ring-white/5 group-hover:bg-white/10 group-hover:text-white group-hover:ring-white/15 group-hover:scale-105'
                      )}
                    >
                      <Icon className="h-[17px] w-[17px]" />
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {isActive && (
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 rounded-full bg-[#14B8A6] shadow-[0_0_8px_rgba(20,184,166,0.8)]"
                      />
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Role-flavored footer card */}
      {footerCard && (
        <div className="relative shrink-0 px-3 pb-4">
          <Link
            href={footerCard.href}
            className="group relative block overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-all hover:border-white/20 hover:bg-white/[0.06]"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full bg-[#14B8A6]/25 blur-2xl transition-opacity group-hover:opacity-70"
            />
            <div className="relative flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#14B8A6] to-[#0D9488] text-white shadow-sm">
                <footerCard.icon className="h-3.5 w-3.5" />
              </span>
              <p className="text-[13px] font-semibold text-white">{footerCard.title}</p>
            </div>
            <p className="relative mt-2 text-[11.5px] leading-relaxed text-white/60">
              {footerCard.body}
            </p>
            <p className="relative mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[#5EEAD4]">
              {footerCard.cta}
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </p>
          </Link>
        </div>
      )}
    </aside>
  )
}

export function AppSidebar() {
  return <SidebarContent variant="fixed" />
}
