'use client'

/**
 * PublicNav — marketing header for the public shell.
 *
 * Behavior:
 *  - Transparent over the navy hero, solid white once scrolled past it.
 *  - Auth-aware: shows login/signup for guests, avatar menu for patients,
 *    or a "Dashboard" link for providers.
 *  - On mobile, section links collapse into a hamburger → right drawer.
 *    The auth CTAs stay visible so sign-up is one tap away, always.
 */

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CalendarCheck,
  CalendarPlus,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  ShoppingCart,
  User as UserIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BrandLogo } from '@/components/common/BrandLogo'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useAuth } from '@/contexts/AuthContext'
import { useAuthModal } from '@/components/auth/AuthModal'
import { useCart } from '@/hooks/useCart'
import { useCartModal } from '@/components/store/CartModal'
import { useBookingModal } from '@/components/booking/BookingModal'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { toast } from 'sonner'

export function PublicNav() {
  const pathname = usePathname()
  const isLanding = pathname === '/'
  const { user, isAuthenticated, isLoading, logout } = useAuth()
  const { openLogin } = useAuthModal()
  const bookingModal = useBookingModal()
  const { totalItems } = useCart()

  const [scrolled, setScrolled] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const menuRef = React.useRef<HTMLDivElement | null>(null)

  // Scroll-state: swap chrome once the hero (~520px tall) is behind us.
  React.useEffect(() => {
    if (!isLanding) return
    const onScroll = () => setScrolled(window.scrollY > 64)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [isLanding])

  // Close drawer and dismiss stale toasts whenever we navigate away.
  React.useEffect(() => {
    setDrawerOpen(false)
    toast.dismiss()
  }, [pathname])

  // Outside-click for avatar menu.
  React.useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const isPatient = user?.role === 'PATIENT'
  const translucent = isLanding && !scrolled

  const shellCls = translucent
    ? 'bg-transparent border-transparent'
    : 'bg-white/75 backdrop-blur-xl shadow-[0_1px_0_rgba(229,231,235,0.8),0_8px_24px_-12px_rgba(30,58,95,0.08)]'

  const linkBase = 'text-[13px] font-medium transition-colors'
  const linkCls = translucent
    ? `${linkBase} text-white/70 hover:text-white`
    : `${linkBase} text-ink-muted hover:text-ink`

  const hamburgerCls = translucent
    ? 'text-white/80 hover:text-white hover:bg-white/10'
    : 'text-ink-muted hover:text-ink hover:bg-canvas'

  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${shellCls}`}>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6 md:h-18 lg:px-8">
        {/* Logo + primary nav (desktop only) */}
        <div className="flex min-w-0 items-center gap-10">
          <Link href="/" aria-label="Medoflow home" className="shrink-0">
            <BrandLogo size="md" tone={translucent ? 'light' : 'dark'} />
          </Link>
          <nav className="hidden items-center gap-7 lg:flex">
            {/* Guests see no section links — only the Log in CTA on the right.
                Logged-in patients get Store. */}
            {isAuthenticated && isPatient && (
              <Link href="/store" className={linkCls}>
                Store
              </Link>
            )}
          </nav>
        </div>

        {/* Right: auth-aware actions + mobile hamburger */}
        <div className="flex items-center gap-2 sm:gap-3">
          {isLoading ? null : isAuthenticated ? (
            isPatient ? (
              <>
                <button
                  type="button"
                  onClick={bookingModal.open}
                  className="mf-btn mf-btn-sm mf-btn-primary hidden sm:inline-flex whitespace-nowrap"
                >
                  <CalendarPlus className="h-4 w-4" />
                  <span>Book appointment</span>
                </button>
                <AvatarMenu
                  ref={menuRef}
                  open={menuOpen}
                  setOpen={setMenuOpen}
                  userName={user?.name ?? 'Account'}
                  userEmail={user?.email ?? ''}
                  userId={user?.id ?? ''}
                  onLogout={logout}
                  onBook={bookingModal.open}
                  translucent={translucent}
                  cartCount={totalItems}
                />
              </>
            ) : (
              <Link
                href="/dashboard"
                className={`mf-btn mf-btn-sm ${translucent ? 'mf-btn-primary' : 'mf-btn-outline'}`}
              >
                <LayoutDashboard className="h-4 w-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </Link>
            )
          ) : (
            <button
              type="button"
              onClick={openLogin}
              className={`mf-btn mf-btn-sm ${translucent ? 'mf-btn-primary' : 'mf-btn-outline'} whitespace-nowrap`}
            >
              Clinic login
            </button>
          )}

          {/* Hamburger — only meaningful for logged-in patients on phones.
              Guests already have the "Log in" button in the nav, so a drawer
              that just repeats it adds noise. Non-patient authenticated users
              have their own dashboard and don't surface through this shell. */}
          {isAuthenticated && isPatient && (
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Open menu"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors lg:hidden ${hamburgerCls}`}
                >
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-[82vw] max-w-[360px] border-l border-hairline bg-white p-0"
              >
                <MobileDrawer
                  userName={user?.name ?? 'Account'}
                  userEmail={user?.email ?? ''}
                  onBook={() => {
                    setDrawerOpen(false)
                    bookingModal.open()
                  }}
                  onLogout={() => {
                    setDrawerOpen(false)
                    logout()
                  }}
                />
              </SheetContent>
            </Sheet>
          )}
        </div>
      </div>
    </header>
  )
}

// ─────────────────────────── Mobile drawer ───────────────────────────

type MobileDrawerProps = {
  userName: string
  userEmail: string
  onBook: () => void
  onLogout: () => void
}

function MobileDrawer({ userName, userEmail, onBook, onLogout }: MobileDrawerProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-hairline px-5 py-4">
        <BrandLogo size="sm" tone="dark" />
        <div className="mt-4">
          <p className="truncate text-[13px] font-semibold text-ink">{userName}</p>
          <p className="truncate text-[11.5px] text-ink-muted">{userEmail}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-5">
        <p className="mf-eyebrow mb-3 text-ink-muted">Your account</p>
        <ul className="space-y-1">
          <li>
            <button
              type="button"
              onClick={onBook}
              className="flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[15px] font-medium text-ink hover:bg-canvas"
            >
              <CalendarPlus className="h-4 w-4 text-ink-faint" />
              Book appointment
            </button>
          </li>
          <li>
            <Link
              href="/account/appointments"
              className="flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium text-ink hover:bg-canvas"
            >
              <CalendarCheck className="h-4 w-4 text-ink-faint" />
              Appointments
            </Link>
          </li>
          <li>
            <Link
              href="/store"
              className="flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium text-ink hover:bg-canvas"
            >
              <ShoppingCart className="h-4 w-4 text-ink-faint" />
              Store
            </Link>
          </li>
          <li>
            <Link
              href="/account/billing"
              className="flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium text-ink hover:bg-canvas"
            >
              <Receipt className="h-4 w-4 text-ink-faint" />
              Billing
            </Link>
          </li>
          <li>
            <Link
              href="/account/profile"
              className="flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium text-ink hover:bg-canvas"
            >
              <UserIcon className="h-4 w-4 text-ink-faint" />
              Profile
            </Link>
          </li>
        </ul>
      </nav>

      <div className="border-t border-hairline p-5">
        <button
          type="button"
          onClick={onLogout}
          className="flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[15px] font-medium text-destructive hover:bg-destructive/5"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────── Avatar menu ─────────────────────────────

type AvatarMenuProps = {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  userName: string
  userEmail: string
  userId: string
  onLogout: () => void
  onBook: () => void
  translucent: boolean
  cartCount: number
}

const AvatarMenu = React.forwardRef<HTMLDivElement, AvatarMenuProps>(function AvatarMenuInner(
  { open, setOpen, userName, userEmail, userId, onLogout, onBook, translucent, cartCount },
  ref
) {
  return (
    <>
      <CartButton translucent={translucent} cartCount={cartCount} />

      {/* Avatar dropdown only on desktop — on mobile the hamburger drawer
          carries the identical menu, so showing both creates duplication. */}
      <div className="relative hidden lg:block" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`flex items-center gap-2 rounded-full p-1 pr-3 transition-colors ${
            translucent ? 'hover:bg-white/10' : 'hover:bg-canvas'
          }`}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <UserAvatar
            seed={`${userId}-${userName}`}
            alt={userName}
            className="h-7 w-7 rounded-full"
            sizes="28px"
          />
          <span
            className={`hidden text-[13px] font-medium sm:inline ${
              translucent ? 'text-white' : 'text-ink'
            }`}
          >
            {userName.split(' ')[0]}
          </span>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-[12px] border border-hairline bg-white"
            style={{ boxShadow: '0 20px 40px -20px rgba(0,0,0,0.18)' }}
          >
            <div className="border-b border-hairline px-4 py-3">
              <p className="truncate text-[13px] font-medium text-ink">{userName}</p>
              <p className="truncate text-[11.5px] text-ink-muted">{userEmail}</p>
            </div>
            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onBook()
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-ink hover:bg-canvas"
              >
                <CalendarPlus className="h-4 w-4 text-ink-faint" />
                Book appointment
              </button>
              <MenuItem href="/account" icon={LayoutDashboard} onClick={() => setOpen(false)}>
                My account
              </MenuItem>
              <MenuItem
                href="/account/appointments"
                icon={CalendarCheck}
                onClick={() => setOpen(false)}
              >
                Appointments
              </MenuItem>
              <MenuItem href="/account/billing" icon={Receipt} onClick={() => setOpen(false)}>
                Billing
              </MenuItem>
              <MenuItem href="/account/profile" icon={UserIcon} onClick={() => setOpen(false)}>
                Profile
              </MenuItem>
            </div>
            <div className="border-t border-hairline py-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onLogout()
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-destructive hover:bg-destructive/5"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
})

function CartButton({ translucent, cartCount }: { translucent: boolean; cartCount: number }) {
  const cartModal = useCartModal()
  return (
    <button
      type="button"
      onClick={() => cartModal.open()}
      className={`relative p-2 transition-colors ${
        translucent ? 'text-white/80 hover:text-white' : 'text-ink-muted hover:text-ink'
      }`}
      aria-label={cartCount > 0 ? `Cart — ${cartCount} items` : 'Cart'}
    >
      <ShoppingCart className="h-5 w-5" />
      {cartCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-teal text-[9px] font-bold text-white">
          {cartCount}
        </span>
      )}
    </button>
  )
}

function MenuItem({
  href,
  icon: Icon,
  onClick,
  children,
}: {
  href: string
  icon: LucideIcon
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2 text-[13px] text-ink hover:bg-canvas"
      role="menuitem"
    >
      <Icon className="h-4 w-4 text-ink-faint" />
      {children}
    </Link>
  )
}
