'use client'

/**
 * UI-07: A compact, additive guide that makes the booking-setup order obvious
 * (Disciplines -> Services -> Packages) and lets staff move between the three
 * setup screens without hunting across dashboard tabs. Purely navigational;
 * it reads no data and changes no booking/business logic.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const STEPS = [
  { label: 'Disciplines', href: '/dashboard/disciplines' },
  { label: 'Services', href: '/dashboard/services' },
  { label: 'Packages', href: '/dashboard/packages' },
] as const

export function BookingSetupSteps({ className }: { className?: string }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Booking setup steps"
      className={cn(
        'flex items-center gap-1 overflow-x-auto whitespace-nowrap rounded-[12px] border border-slate-200/80 bg-white p-1.5',
        className
      )}
    >
      {STEPS.map((step, index) => {
        const isCurrent = pathname === step.href || pathname?.startsWith(`${step.href}/`)

        return (
          <div key={step.href} className="flex shrink-0 items-center gap-1">
            <Link
              href={step.href}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-[12px] px-3 py-1.5 text-sm font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
                isCurrent
                  ? 'bg-accent text-white'
                  : 'text-slate-600 hover:bg-accent/10 hover:text-accent-700'
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  isCurrent ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                )}
                aria-hidden="true"
              >
                {index + 1}
              </span>
              {step.label}
            </Link>
            {index < STEPS.length - 1 && (
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
            )}
          </div>
        )
      })}
    </nav>
  )
}
