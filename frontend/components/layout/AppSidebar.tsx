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
  FileText,
  Layers,
  MapPin,
  Settings,
  Stethoscope,
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
  Building2,
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

// PROVIDER: the clinical day only (CTO-01/02/03). "Appointments" is the list
// formerly labelled "Queue". The old Google Meet "Video Room" is gone: video
// and AI Scribe start from the appointment itself. Doctors don't build carts
// by hand, so there's no Store tab; Rx to cart comes from the scribe.
// The calendar view (/dashboard/provider/calendar) is reachable from the
// dashboard's "Full Calendar" link.
const providerSections: SidebarSection[] = [
  {
    title: 'Clinical',
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/appointments', label: 'Appointments', icon: ClipboardList },
    ],
  },
  {
    title: 'Insights',
    items: [{ href: '/dashboard/analytics', label: 'Performance', icon: BarChart3 }],
  },
]

// SUPER_ADMIN (CTO-20): appointments (services) and products are both things
// a clinic sells, so they share one Commerce group; there's no separate
// Catalog. Settings comes last: clinic profile, locations and hours, forms.
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
    title: 'Commerce',
    items: [
      { href: '/dashboard/services', label: 'Services', icon: Stethoscope },
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
  {
    title: 'Settings',
    items: [
      { href: '/dashboard/clinic', label: 'Clinic profile', icon: Building2 },
      { href: '/dashboard/locations', label: 'Locations & hours', icon: MapPin },
      { href: '/dashboard/disciplines', label: 'Disciplines', icon: Layers },
      { href: '/dashboard/forms', label: 'Forms', icon: FileText },
      { href: '/dashboard/settings', label: 'Security', icon: Settings },
    ],
  },
]

// FRONT_DESK: operations-focused, same names as the admin console where they
// overlap. Front desk transacts via Checkout (POS), not the patient Store.
const frontDeskSections: SidebarSection[] = [
  {
    title: 'Today',
    items: [
      { href: '/dashboard/front-desk', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/front-desk/pos', label: 'Checkout', icon: ShoppingCart },
    ],
  },
  {
    title: 'Clinical',
    items: [
      { href: '/dashboard/appointments', label: 'Appointments', icon: ClipboardList },
      { href: '/dashboard/patients', label: 'Patients', icon: Users },
    ],
  },
  {
    title: 'Commerce',
    items: [{ href: '/dashboard/front-desk/invoices', label: 'Billing', icon: Receipt }],
  },
  {
    title: 'Website',
    items: [{ href: '/dashboard/site/leads', label: 'Enquiries', icon: Inbox }],
  },
  {
    title: 'Settings',
    items: [{ href: '/dashboard/forms', label: 'Forms', icon: FileText }],
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
      {/* Header: Logo + workspace chip */}
      <div className="relative shrink-0 px-5 pt-5 pb-4">
        <Link href="/dashboard" className="group/logo inline-flex items-center">
          <BrandLogo size="md" tone="light" />
        </Link>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
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
          <div
            key={section.title}
            className="space-y-1"
            data-testid="sidebar-section"
            data-section={section.title}
          >
            <div className="flex items-center gap-2 px-3 pb-1">
              <span className="h-px flex-1 bg-white/5" aria-hidden />
              <p
                className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45"
                data-testid="sidebar-section-title"
              >
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
                      'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-colors duration-200',
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
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-[3px] rounded-r-full bg-brand-on-dark shadow-[0_0_14px_rgb(var(--brand-on-dark-rgb)/0.55)]"
                      />
                    )}
                    <span
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-xl transition-colors duration-200',
                        isActive
                          ? 'bg-brand-on-dark/20 text-white ring-1 ring-brand-on-dark/30 shadow-[0_0_16px_rgb(var(--brand-on-dark-rgb)/0.25)]'
                          : 'bg-white/[0.04] text-white/55 ring-1 ring-white/5 group-hover:bg-white/10 group-hover:text-white group-hover:ring-white/15'
                      )}
                    >
                      <Icon className="h-[17px] w-[17px]" />
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {isActive && (
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 rounded-full bg-brand-on-dark shadow-[0_0_8px_rgb(var(--brand-on-dark-rgb)/0.8)]"
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
            className="group relative block overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:border-white/20 hover:bg-white/[0.06]"
          >
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
              <span className="transition-transform">→</span>
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
