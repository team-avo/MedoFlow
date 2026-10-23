'use client'

/**
 * The public clinic site with its real actions: guest→server cart, cart
 * drawer, patient sign-in. Rendered by app/clinic-site (SSR + hydration).
 */
import React from 'react'
import type { RenderPayload } from '@/lib/site/types'
import { useAuth } from '@/contexts/AuthContext'
import { useCart } from '@/hooks/useCart'
import { useCartModal } from '@/components/store/CartModal'
import { useAuthModal } from '@/components/auth/AuthModal'
import { SiteRenderer } from './SiteRenderer'
import type { SiteActions, SiteMode } from './SiteContext'

export function LiveSite({
  payload,
  base,
  mode,
  fontClassName,
}: {
  payload: RenderPayload
  base: string
  mode: SiteMode
  fontClassName: string
}) {
  const { isAuthenticated, user } = useAuth()
  const cart = useCart()
  const cartModal = useCartModal()
  const authModal = useAuthModal()
  const theme = payload.site.settings.theme

  const actions = React.useMemo<SiteActions>(
    () => ({
      addToCart: (item, type) => {
        void cart
          .addToCart(item, type)
          .then(() =>
            cartModal.open({ themeColor: theme.colors.primary, routeId: payload.site.clinicId })
          )
      },
      openCart: () =>
        cartModal.open({ themeColor: theme.colors.primary, routeId: payload.site.clinicId }),
      openLogin: authModal.openLogin,
      cartCount: cart.totalItems,
      signedIn: isAuthenticated && user?.role === 'PATIENT',
    }),
    [
      cart,
      cartModal,
      authModal.openLogin,
      theme.colors.primary,
      payload.site.clinicId,
      isAuthenticated,
      user?.role,
    ]
  )

  return (
    <SiteRenderer
      payload={payload}
      base={base}
      mode={mode}
      actions={actions}
      fontClassName={fontClassName}
    />
  )
}
