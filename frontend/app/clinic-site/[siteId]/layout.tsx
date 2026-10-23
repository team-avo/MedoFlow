/**
 * Shell for every clinic website (reached only through middleware.ts —
 * never by its own URL). Provides the patient-side cart and sign-in the
 * site's buttons use, the site stylesheet and the theme fonts.
 */
import '@/components/site/site.css'
import { AuthModalProvider } from '@/components/auth/AuthModal'
import { CartModalProvider } from '@/components/store/CartModal'
import { CartProvider } from '@/hooks/useCart'

export default function ClinicSiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthModalProvider>
      <CartProvider>
        <CartModalProvider>{children}</CartModalProvider>
      </CartProvider>
    </AuthModalProvider>
  )
}
