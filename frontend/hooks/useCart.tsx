'use client'

/**
 * Cart hook + provider.
 *
 * The hook itself is a thin reader of the singleton context held by
 * <CartProvider>. Mounting the provider once at the app root (in
 * (public)/layout.tsx) means every consumer — the cart drawer, the
 * navbar badge, individual product cards — share the SAME state. When
 * one of them adds an item, the badge in the navbar updates immediately.
 *
 * Public API is unchanged from the previous per-component hook, so no
 * call sites need to be touched.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import api from '@/lib/api'
import { toast } from 'sonner'
import { clientLog } from '@/lib/clientLog'

export interface CartItem {
  id: string
  itemId: string
  itemType: 'PRODUCT' | 'PACKAGE' | 'MEMBERSHIP' | 'SERVICE'
  name: string
  unitPrice: number
  quantity: number
  product?: any
  package?: any
  membership?: any
  service?: any
}

const LOCAL_CART_KEY = 'medoflow_guest_cart'

interface CartContextValue {
  cart: { items: CartItem[] }
  totalItems: number
  subtotal: number
  isLoading: boolean
  isAuthenticated: boolean
  addToCart: (item: any, type: CartItem['itemType'], quantity?: number) => Promise<void>
  updateQuantity: (cartItemId: string, quantity: number) => Promise<void>
  removeItem: (cartItemId: string) => Promise<void>
  fetchCartItems: () => Promise<void>
  clearGuestCart: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [cart, setCart] = useState<{ items: CartItem[] }>({ items: [] })
  const [isLoading, setIsLoading] = useState(true)

  const persistGuestCart = useCallback((next: { items: CartItem[] }) => {
    setCart(next)
    localStorage.setItem(LOCAL_CART_KEY, JSON.stringify(next))
  }, [])

  const fetchCartItems = useCallback(async () => {
    setIsLoading(true)
    if (isAuthenticated) {
      try {
        const res = await api.get('/carts')
        const raw = res.data.data.cart
        const items = (raw.items ?? []).map((item: any) => ({
          ...item,
          name:
            item.product?.name ??
            item.package?.name ??
            item.membership?.name ??
            item.service?.name ??
            'Item',
          unitPrice: Number(item.unitPrice ?? 0),
        }))
        setCart({ ...raw, items })
      } catch (err) {
        clientLog.error('Failed to fetch server cart', err)
      }
    } else {
      const savedCart = localStorage.getItem(LOCAL_CART_KEY)
      if (savedCart) {
        try {
          setCart(JSON.parse(savedCart))
        } catch (e) {
          clientLog.error('Failed to parse local cart', e)
        }
      } else {
        setCart({ items: [] })
      }
    }
    setIsLoading(false)
  }, [isAuthenticated])

  // Fetch on mount and whenever auth state flips.
  useEffect(() => {
    fetchCartItems()
  }, [fetchCartItems])

  // Sync guest cart to server when user logs in.
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      const savedCart = localStorage.getItem(LOCAL_CART_KEY)
      if (savedCart) {
        try {
          const { items } = JSON.parse(savedCart)
          if (items && items.length > 0) {
            const syncCart = async () => {
              for (const item of items) {
                try {
                  await api.post('/carts/items', {
                    itemType: item.itemType,
                    itemId: item.itemId,
                    quantity: item.quantity,
                  })
                } catch (e) {
                  clientLog.error('Failed to sync cart item', e)
                }
              }
              localStorage.removeItem(LOCAL_CART_KEY)
              fetchCartItems()
              toast.success('Your guest cart has been synced to your account!')
            }
            syncCart()
          }
        } catch (e) {
          clientLog.error('Failed to parse and sync guest cart', e)
        }
      }
    }
  }, [isAuthenticated, isLoading, fetchCartItems])

  const addToCart = useCallback(
    async (item: any, type: CartItem['itemType'], quantity = 1) => {
      if (isAuthenticated) {
        try {
          await api.post('/carts/items', {
            itemType: type,
            itemId: item.id,
            quantity,
          })
          toast.success(`Added ${item.name} to cart`)
          await fetchCartItems()
        } catch (error) {
          clientLog.error('Failed to add to server cart', error)
          toast.error('Could not add item to cart.')
        }
      } else {
        const next = { items: [...cart.items] }
        const existingIndex = next.items.findIndex(
          (i) => i.itemId === item.id && i.itemType === type
        )
        if (existingIndex > -1) {
          next.items[existingIndex]!.quantity += quantity
        } else {
          next.items.push({
            id: `guest_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            itemId: item.id,
            itemType: type,
            name: item.name,
            unitPrice: Number(item.price || item.monthlyPrice || 0),
            quantity,
            product: type === 'PRODUCT' ? item : undefined,
            package: type === 'PACKAGE' ? item : undefined,
            membership: type === 'MEMBERSHIP' ? item : undefined,
          })
        }
        persistGuestCart(next)
        toast.success(`Added ${item.name} to cart`)
      }
    },
    [isAuthenticated, cart.items, fetchCartItems, persistGuestCart]
  )

  const removeItem = useCallback(
    async (cartItemId: string) => {
      if (isAuthenticated) {
        try {
          await api.delete(`/carts/items/${cartItemId}`)
          await fetchCartItems()
        } catch (err) {
          clientLog.error('Failed to remove cart item', err)
          toast.error('Could not remove item.')
        }
      } else {
        const next = { items: cart.items.filter((i) => i.id !== cartItemId) }
        persistGuestCart(next)
      }
    },
    [isAuthenticated, cart.items, fetchCartItems, persistGuestCart]
  )

  const updateQuantity = useCallback(
    async (cartItemId: string, quantity: number) => {
      if (quantity < 1) {
        return removeItem(cartItemId)
      }
      if (isAuthenticated) {
        try {
          await api.put(`/carts/items/${cartItemId}`, { quantity })
          await fetchCartItems()
        } catch (err) {
          clientLog.error('Failed to update cart item', err)
          toast.error('Could not update quantity.')
        }
      } else {
        const next = {
          items: cart.items.map((i) => (i.id === cartItemId ? { ...i, quantity } : i)),
        }
        persistGuestCart(next)
      }
    },
    [isAuthenticated, cart.items, fetchCartItems, persistGuestCart, removeItem]
  )

  const clearGuestCart = useCallback(() => {
    localStorage.removeItem(LOCAL_CART_KEY)
    if (!isAuthenticated) {
      setCart({ items: [] })
    }
  }, [isAuthenticated])

  const totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0)
  const subtotal = cart.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0)

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      totalItems,
      subtotal,
      isLoading,
      isAuthenticated,
      addToCart,
      updateQuantity,
      removeItem,
      fetchCartItems,
      clearGuestCart,
    }),
    [
      cart,
      totalItems,
      subtotal,
      isLoading,
      isAuthenticated,
      addToCart,
      updateQuantity,
      removeItem,
      fetchCartItems,
      clearGuestCart,
    ]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) {
    throw new Error('useCart must be used inside <CartProvider>')
  }
  return ctx
}
