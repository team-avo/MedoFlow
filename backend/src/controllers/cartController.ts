import type { Request, Response, NextFunction } from 'express'
import * as cartService from '../services/cartService'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'

export const getCart = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId
    const patientId = req.user!.id
    // PLATFORM_ADMIN / SUPER_ADMIN accounts without a clinic have no cart —
    // hitting Prisma with clinicId=null triggers a validation error, so we
    // short-circuit with an empty cart shape the client already handles.
    if (!clinicId) {
      successResponse(res, 200, 'Cart retrieved successfully', {
        cart: { id: null, items: [], status: 'ACTIVE' },
      })
      return
    }
    const cart = await cartService.getOrCreateCart(clinicId, patientId)
    successResponse(res, 200, 'Cart retrieved successfully', { cart })
  }
)

export const addItem = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const patientId = req.user!.id
    const item = await cartService.addToCart(
      clinicId,
      patientId,
      req.body as cartService.AddCartItemInput
    )
    successResponse(res, 201, 'Item added to cart', { item })
  }
)

export const updateItem = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const patientId = req.user!.id
    const cart = await cartService.getOrCreateCart(clinicId, patientId)

    const itemId = req.params.itemId as string
    const { quantity } = req.body as { quantity: number }

    const item = await cartService.updateCartItem(cart.id, itemId, quantity)
    successResponse(res, 200, 'Cart item updated', { item })
  }
)

export const removeItem = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const patientId = req.user!.id
    const cart = await cartService.getOrCreateCart(clinicId, patientId)

    const itemId = req.params.itemId as string
    await cartService.removeCartItem(cart.id, itemId)
    successResponse(res, 200, 'Cart item removed')
  }
)

export const clearCart = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const patientId = req.user!.id
    const cart = await cartService.getOrCreateCart(clinicId, patientId)

    await cartService.clearCart(cart.id)
    successResponse(res, 200, 'Cart cleared')
  }
)

export const checkout = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const patientId = req.user!.id

    const result = await cartService.checkoutCart(clinicId, patientId)
    successResponse(res, 200, 'Checkout initiated', result)
  }
)

export const demoCheckout = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const patientId = req.user!.id

    const result = await cartService.demoCheckoutCart(clinicId, patientId)
    successResponse(res, 200, 'Demo Checkout successful', result)
  }
)
