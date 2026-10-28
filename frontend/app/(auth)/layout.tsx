import Link from 'next/link'
import { AppLogo } from '@/components/common/AppLogo'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background">
      {/* Left side: Hero/Branding (Hidden on mobile) */}
      <div className="hidden md:flex md:w-1/2 bg-primary relative overflow-hidden items-center justify-center p-12">
        <div className="relative z-10 max-w-md space-y-8 text-center lg:text-left">
          <Link
            href="/"
            className="inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/50 rounded-lg"
          >
            <AppLogo size="lg" variant="light" />
          </Link>
          <div className="space-y-4">
            <h1 className="text-4xl lg:text-5xl font-bold font-display text-primary-foreground leading-tight tracking-tight">
              Clinical precision. <br />
              <span className="text-primary-200">Operational excellence.</span>
            </h1>
            <p className="text-lg text-primary-100/90 leading-relaxed">
              The modern operating system for premium self-pay clinics. Join hundreds of providers
              delivering better outcomes.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-6">
            <div className="bg-white/10 rounded-2xl p-5 border border-white/20 space-y-1">
              <p className="text-2xl font-bold font-display text-primary-foreground">100%</p>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary-200">
                HIPAA Compliant
              </p>
            </div>
            <div className="bg-white/10 rounded-2xl p-5 border border-white/20 space-y-1">
              <p className="text-2xl font-bold font-display text-primary-foreground">24/7</p>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary-200">
                Patient Access
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right side: Auth Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-subtle md:bg-card border-l border-border">
        <div className="w-full max-w-[400px] space-y-8">
          <div className="md:hidden text-center mb-8">
            <Link href="/">
              <AppLogo size="md" />
            </Link>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}
