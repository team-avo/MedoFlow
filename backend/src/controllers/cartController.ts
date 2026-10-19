import type { Request, Response, NextFunction } from 'express'
import * as cartService from '../services/cartService'
import * as patientCommerceService from '../services/patientCommerceService'
import { requestMeta } from '../services/auditService'
import type { ShippingAddressInput } from '../validation/rxCartSchemas'
import { successResponse } from '../utils/apiResponse'
import { asyncHandler } from '../utils/asyncHandler'

const actorOf = (req: Request): cartService.Actor => ({
  userId: req.user!.id,
  ...requestMeta(req),
})

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
      req.body as cartService.AddCartItemInput,
      actorOf(req)
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

    const item = await cartService.updateCartItem(cart.id, itemId, quantity, clinicId, actorOf(req))
    successResponse(res, 200, 'Cart item updated', { item })
  }
)

export const removeItem = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const patientId = req.user!.id
    const cart = await cartService.getOrCreateCart(clinicId, patientId)

    const itemId = req.params.itemId as string
    await cartService.removeCartItem(cart.id, itemId, clinicId, actorOf(req))
    successResponse(res, 200, 'Cart item removed')
  }
)

export const clearCart = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const patientId = req.user!.id
    const cart = await cartService.getOrCreateCart(clinicId, patientId)

    await cartService.clearCart(cart.id, clinicId, actorOf(req))
    successResponse(res, 200, 'Cart cleared')
  }
)

export const checkout = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const patientId = req.user!.id

    const result = await cartService.checkoutCart(clinicId, patientId, actorOf(req))
    successResponse(res, 200, 'Checkout initiated', result)
  }
)

export const demoCheckout = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const clinicId = req.user!.clinicId!
    const patientId = req.user!.id

    const result = await cartService.demoCheckoutCart(clinicId, patientId, actorOf(req))
    successResponse(res, 200, 'Demo Checkout successful', result)
  }
)

/** PATCH /carts/items/:itemId/decision — accept or decline a prescribed item (F5.2). */
export const setItemDecision = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { decision } = req.body as { decision: 'ACCEPTED' | 'DECLINED' }
    const item = await cartService.setItemDecision(
      req.user!.clinicId!,
      req.user!.id,
      req.params.itemId as string,
      decision,
      actorOf(req)
    )
    successResponse(res, 200, 'Decision saved', { item })
  }
)

/** GET /carts/one-click — card and shipping address on file from booking (F5.3). */
export const getOneClick = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const onFile = await patientCommerceService.getOnFile(req.user!.clinicId!, req.user!.id)
    successResponse(res, 200, 'On-file details retrieved', { onFile })
  }
)

/** POST /carts/one-click-checkout — pay with the card on file (B5.4). */
export const oneClickCheckout = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const result = await patientCommerceService.oneClickCheckout(
      req.user!.clinicId!,
      req.user!.id,
      actorOf(req)
    )
    successResponse(res, 200, 'Payment complete', result)
  }
)

/** PUT /carts/shipping-address — saved at booking for one-click orders. */
export const saveShippingAddress = asyncHandler(
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const onFile = await patientCommerceService.saveShippingAddress(
      req.user!.clinicId!,
      req.user!.id,
      req.body as ShippingAddressInput,
      actorOf(req)
    )
    successResponse(res, 200, 'Shipping address saved', { onFile })
  }
)
