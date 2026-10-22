import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { TourProvider } from '@/contexts/TourContext'
import { SystemModalProvider } from '@/components/system/SystemModalProvider'
import { QueryProvider } from '@/components/QueryProvider'
import { GlobalApiLoader } from '@/components/common/GlobalApiLoader'
import { TourOverlay } from '@/components/tour/TourOverlay'
import { Toaster } from '@/components/ui/sonner'

// Self-hosted fonts (app/fonts, SIL OFL 1.1 — licences alongside). The build
// used to download them from Google Fonts via next/font/google; an occasional
// unexpected Google response crashed `next build` (and so deploys), so the
// files — the same latin variable-weight woff2s Google serves — are in the repo.
const inter = localFont({
  src: './fonts/inter-latin-wght.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
})

const dmSans = localFont({
  src: './fonts/dm-sans-latin-wght.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
  variable: '--font-dm-sans',
})

export const metadata: Metadata = {
  title: 'Medoflow | The Operating System for Modern Clinics',
  description:
    'Stop piecing together scheduling, EHR, and billing tools. Run your entire practice on one unified timeline, from patient intake to revenue.',
  icons: {
    icon: '/Medoflow-logo.svg',
    apple: '/medoflow-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning: browser extensions (LanguageTool, Grammarly,
    // password managers) add attributes to <html>/<body> before React
    // hydrates. It applies to these two elements' own attributes only, so
    // real mismatches inside the app still surface.
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${dmSans.variable} font-sans antialiased bg-white`}
        suppressHydrationWarning
      >
        <QueryProvider>
          <AuthProvider>
            <TourProvider>
              <SystemModalProvider>
                {children}
                <TourOverlay />
                <GlobalApiLoader />
              </SystemModalProvider>
            </TourProvider>
          </AuthProvider>
        </QueryProvider>
        <Toaster />
      </body>
    </html>
  )
}
