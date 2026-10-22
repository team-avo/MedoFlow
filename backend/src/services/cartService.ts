import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'
import type { CartItemType } from '@prisma/client'
import { PaymentStatus, Prisma, SubscriptionStatus } from '@prisma/client'

import stripe from '../config/stripe'
import { recalculateInvoiceTotals } from './invoiceService'
import * as commissionService from './commissionService'
import * as auditService from './auditService'
import { isPrescriptionClass } from './rxMappingService'

const apiError = (status: number, message: string, code?: string): ApiError => {
  const err = new Error(message) as ApiError
  err.statusCode = status
  if (code) err.code = code
  return err
}

const unsupportedMembershipError = () =>
  apiError(
    400,
    'Membership checkout is not enabled. Sell memberships only after Stripe subscription linkage is implemented.',
    'membership_checkout_unsupported'
  )

/** B5.5 scope guard: prescription products never go through the cart. */
const rxRouteError = () =>
  apiError(
    422,
    'Prescription products are sent to e-prescribing and cannot be bought from the cart',
    'RX_ROUTE_EPRESCRIBE'
  )

/** Who did it, for the audit row. */
export interface Actor {
  userId: string
  ipAddress?: string | null
  userAgent?: string | null
}

const audit = (
  clinicId: string,
  entityType: string,
  entityId: string,
  action: string,
  actor: Actor | undefined,
  newValue?: Record<string, unknown>
) =>
  actor
    ? auditService.logAudit({
        clinicId,
        entityType,
        entityId,
        action,
        newValue,
        performedById: actor.userId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })
    : Promise.resolve()

// Minimum necessary: the cart shows who prescribed an item, not their profile.
const itemInclude = {
  service: true,
  product: true,
  package: true,
  membership: true,
  prescribedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.CartItemInclude

export const getOrCreateCart = async (clinicId: string, patientId: string) => {
  let cart = await prisma.cart.findFirst({
    where: { clinicId, patientId, status: 'ACTIVE' },
    include: { items: { include: itemInclude, orderBy: { createdAt: 'asc' } } },
  })

  if (!cart) {
    cart = await prisma.cart.create({
      data: { clinicId, patientId, status: 'ACTIVE' },
      include: { items: { include: itemInclude, orderBy: { createdAt: 'asc' } } },
    })
  }

  return cart
}

export interface AddCartItemInput {
  itemType: CartItemType
  itemId: string // ID of the service, product, package, etc.
  quantity?: number
  appointmentId?: string // Optional if booking a service concurrently
}

export const addToCart = async (
  clinicId: string,
  patientId: string,
  input: AddCartItemInput,
  actor?: Actor
) => {
  const cart = await getOrCreateCart(clinicId, patientId)

  let unitPrice = new Prisma.Decimal(0)

  // Tenant-safety: look up the item constrained by the caller's clinicId.
  // Without this filter a patient of clinic A could add clinic B's item to
  // their cart by guessing its id.
  if (input.itemType === 'PRODUCT') {
    const product = await prisma.product.findFirst({ where: { id: input.itemId, clinicId } })
    if (!product) throw apiError(404, 'Product not found')
    if (isPrescriptionClass(product.fulfillmentClass)) throw rxRouteError()
    unitPrice = product.price
  } else if (input.itemType === 'SERVICE') {
    const service = await prisma.service.findFirst({ where: { id: input.itemId, clinicId } })
    if (!service) throw apiError(404, 'Service not found')
    unitPrice = service.defaultPrice
  } else if (input.itemType === 'PACKAGE') {
    const pkg = await prisma.package.findFirst({ where: { id: input.itemId, clinicId } })
    if (!pkg) throw apiError(404, 'Package not found')
    unitPrice = pkg.price
  } else if (input.itemType === 'MEMBERSHIP') {
    throw unsupportedMembershipError()
  }

  // Merge with an item the patient added themselves. A prescribed item keeps
  // its own row so its provenance and the patient's decision stay intact.
  const existingItem = await prisma.cartItem.findFirst({
    where: {
      cartId: cart.id,
      itemType: input.itemType,
      rxOrderLineId: null,
      ...(input.itemType === 'PRODUCT' ? { productId: input.itemId } : {}),
      ...(input.itemType === 'SERVICE' ? { serviceId: input.itemId } : {}),
      ...(input.itemType === 'PACKAGE' ? { packageId: input.itemId } : {}),
    },
  })

  const item = existingItem
    ? await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + (input.quantity || 1) },
      })
    : await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          itemType: input.itemType,
          quantity: input.quantity || 1,
          unitPrice,
          productId: input.itemType === 'PRODUCT' ? input.itemId : null,
          serviceId: input.itemType === 'SERVICE' ? input.itemId : null,
          packageId: input.itemType === 'PACKAGE' ? input.itemId : null,
          membershipId: null,
          appointmentId: input.appointmentId,
        },
      })

  await audit(clinicId, 'CartItem', item.id, 'CART_ITEM_ADDED', actor, {
    cartId: cart.id,
    itemType: input.itemType,
    quantity: item.quantity,
  })
  return item
}

/**
 * An item of the caller's own cart, or 404. Items are addressed by id, so
 * without the cartId filter one patient could change another's cart.
 */
const findOwnItem = async (cartId: string, itemId: string) => {
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId } })
  if (!item) throw apiError(404, 'Cart item not found')
  return item
}

export const updateCartItem = async (
  cartId: string,
  itemId: string,
  quantity: number,
  clinicId?: string,
  actor?: Actor
) => {
  await findOwnItem(cartId, itemId)
  if (quantity <= 0) return removeCartItem(cartId, itemId, clinicId, actor)

  const item = await prisma.cartItem.update({ where: { id: itemId }, data: { quantity } })
  if (clinicId) {
    await audit(clinicId, 'CartItem', itemId, 'CART_ITEM_UPDATED', actor, { cartId, quantity })
  }
  return item
}

export const removeCartItem = async (
  cartId: string,
  itemId: string,
  clinicId?: string,
  actor?: Actor
) => {
  await findOwnItem(cartId, itemId)
  const item = await prisma.cartItem.delete({ where: { id: itemId } })
  if (clinicId) await audit(clinicId, 'CartItem', itemId, 'CART_ITEM_REMOVED', actor, { cartId })
  return item
}

export const clearCart = async (cartId: string, clinicId?: string, actor?: Actor) => {
  const result = await prisma.cartItem.deleteMany({ where: { cartId } })
  if (clinicId) {
    await audit(clinicId, 'Cart', cartId, 'CART_CLEARED', actor, { removed: result.count })
  }
  return result
}

/** B5.3 / F5.2: the patient accepts or declines an item their provider prescribed. */
export const setItemDecision = async (
  clinicId: string,
  patientId: string,
  itemId: string,
  decision: 'ACCEPTED' | 'DECLINED',
  actor?: Actor
) => {
  const cart = await prisma.cart.findFirst({
    where: { clinicId, patientId, status: 'ACTIVE' },
    select: { id: true },
  })
  if (!cart) throw apiError(404, 'Cart item not found')
  const item = await findOwnItem(cart.id, itemId)
  if (!item.rxOrderLineId) {
    throw apiError(400, 'Only prescribed items need a decision', 'not_prescribed')
  }
  const updated = await prisma.cartItem.update({
    where: { id: itemId },
    data: { patientDecision: decision },
  })
  await audit(clinicId, 'CartItem', itemId, 'CART_ITEM_DECISION', actor, {
    cartId: cart.id,
    decision,
  })
  return updated
}

/**
 * The checkout rules shared by every way of paying for a cart:
 *  - prescribed items need the patient's accept/decline first;
 *  - declined items are not charged;
 *  - prescription products never reach payment (B5.5).
 */
export const preparePayableCart = async (clinicId: string, patientId: string) => {
  const cart = await prisma.cart.findFirst({
    where: { clinicId, patientId, status: 'ACTIVE' },
    include: { items: { include: { product: { select: { fulfillmentClass: true } } } } },
  })

  if (!cart || cart.items.length === 0) throw apiError(400, 'Cart is empty or not found')
  if (cart.items.some((item) => item.itemType === 'MEMBERSHIP')) {
    throw unsupportedMembershipError()
  }
  if (
    cart.items.some((item) => item.product && isPrescriptionClass(item.product.fulfillmentClass))
  ) {
    throw rxRouteError()
  }
  if (cart.items.some((item) => item.rxOrderLineId && item.patientDecision === 'PENDING')) {
    throw apiError(
      409,
      'Accept or decline the items your provider prescribed before paying',
      'RX_DECISION_REQUIRED'
    )
  }

  const payable = cart.items.filter((item) => item.patientDecision !== 'DECLINED')
  if (payable.length === 0)
    throw apiError(400, 'There is nothing to pay for', 'cart_nothing_payable')

  const fallbackProvider = await prisma.provider.findFirst({
    where: { clinicId, isActive: true },
    select: { id: true },
  })
  if (!fallbackProvider) {
    throw apiError(400, 'No active provider found for this clinic to assign billing')
  }

  return { cart, payable, fallbackProviderId: fallbackProvider.id }
}

type PayableCart = Awaited<ReturnType<typeof preparePayableCart>>

/** A DRAFT invoice for the payable items, with tax applied. */
export const createCartInvoice = async (
  clinicId: string,
  patientId: string,
  { payable, fallbackProviderId }: PayableCart,
  status: 'DRAFT' | 'PAID' = 'DRAFT'
) => {
  let totalAmount = new Prisma.Decimal(0)
  for (const item of payable) totalAmount = totalAmount.plus(item.unitPrice.times(item.quantity))

  const invoice = await prisma.invoice.create({
    data: {
      clinicId,
      patientId,
      providerId: fallbackProviderId,
      locationId: null,
      status,
      subtotal: totalAmount,
      taxAmount: 0,
      totalAmount,
      items: {
        create: payable.map((item) => ({
          serviceId: item.serviceId,
          productId: item.productId,
          packageId: item.packageId,
          membershipId: item.membershipId,
          // A prescribed item is attributed to the prescribing provider.
          providerId: item.prescribedByProviderId ?? fallbackProviderId,
          description: `Cart Item: ${item.itemType}`,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          totalPrice: item.unitPrice.times(item.quantity),
        })),
      },
    },
  })

  if (status === 'DRAFT') await recalculateInvoiceTotals(invoice.id)
  const updated = await prisma.invoice.findUnique({ where: { id: invoice.id, clinicId } })
  if (!updated) throw new Error('Failed to retrieve updated invoice')
  return updated
}

export const checkoutCart = async (clinicId: string, patientId: string, actor?: Actor) => {
  const prepared = await preparePayableCart(clinicId, patientId)
  const { cart, fallbackProviderId } = prepared
  const updatedInvoice = await createCartInvoice(clinicId, patientId, prepared)

  // Convert to cents for Stripe
  const amountInCents = Math.round(updatedInvoice.totalAmount.toNumber() * 100)

  let clientSecret: string | undefined = undefined
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      metadata: {
        cartId: cart.id,
        invoiceId: updatedInvoice.id,
        clinicId,
        patientId,
        type: 'CART_CHECKOUT',
      },
    })
    clientSecret = paymentIntent.client_secret ?? undefined

    await prisma.$transaction([
      prisma.invoice.update({
        where: { id: updatedInvoice.id, clinicId },
        data: { status: 'FINALIZED' },
      }),
      prisma.payment.create({
        data: {
          clinicId,
          providerId: fallbackProviderId,
          invoiceId: updatedInvoice.id,
          patientId,
          amount: updatedInvoice.totalAmount,
          status: PaymentStatus.PENDING,
          stripePaymentIntentId: paymentIntent.id,
          stripeClientSecret: paymentIntent.client_secret ?? null,
          paymentChannel: 'STRIPE',
          paymentMethod: 'CARD',
        },
      }),
      prisma.cart.update({
        where: { id: cart.id, clinicId },
        data: { status: 'CHECKED_OUT' },
      }),
    ])
  } catch (err) {
    console.error('Stripe Cart PaymentIntent Error:', err)
    throw apiError(502, 'Unable to start checkout payment', 'payment_intent_failed')
  }

  await audit(clinicId, 'Cart', cart.id, 'CART_CHECKOUT', actor, {
    invoiceId: updatedInvoice.id,
    channel: 'STRIPE_ELEMENTS',
  })

  return {
    invoice: updatedInvoice,
    clientSecret,
  }
}

export const demoCheckoutCart = async (clinicId: string, patientId: string, actor?: Actor) => {
  const prepared = await preparePayableCart(clinicId, patientId)
  const { cart, payable, fallbackProviderId } = prepared
  const invoice = await createCartInvoice(clinicId, patientId, prepared, 'PAID')

  // One PAID payment per checkout. (This used to be written twice, which
  // double-counted revenue for every demo order.)
  await prisma.payment.create({
    data: {
      clinicId,
      invoiceId: invoice.id,
      patientId,
      providerId: fallbackProviderId,
      appointmentId: null,
      amount: invoice.totalAmount,
      status: PaymentStatus.PAID,
      paymentChannel: 'DEMO',
      paymentMethod: 'DEMO_MODE',
      recordedAt: new Date(),
    },
  })

  // Fulfill items
  for (const item of payable) {
    if (item.productId) {
      await prisma.inventoryItem.updateMany({
        where: { productId: item.productId, clinicId },
        data: { quantityInStock: { decrement: item.quantity } },
      })
    }

    if (item.packageId) {
      const pkg = await prisma.package.findUnique({ where: { id: item.packageId, clinicId } })
      if (pkg) {
        await prisma.patientPackage.create({
          data: {
            clinicId,
            patientId,
            packageId: pkg.id,
            invoiceId: invoice.id,
            totalSessions: pkg.totalSessions ?? 0,
            expiresAt: pkg.expiresInDays
              ? new Date(Date.now() + pkg.expiresInDays * 24 * 60 * 60 * 1000)
              : null,
          },
        })
      }
    }

    if (item.membershipId) {
      await prisma.patientSubscription.create({
        data: {
          clinicId,
          patientId,
          membershipId: item.membershipId,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      })
    }
  }

  // Update cart status
  await prisma.cart.update({
    where: { id: cart.id, clinicId },
    data: { status: 'CHECKED_OUT' },
  })

  // Calculate commissions
  await commissionService.calculateCommissions(invoice.id)

  await audit(clinicId, 'Cart', cart.id, 'CART_CHECKOUT', actor, {
    invoiceId: invoice.id,
    channel: 'DEMO',
  })

  const withItems = await prisma.invoice.findUnique({
    where: { id: invoice.id, clinicId },
    include: { items: true },
  })
  return { invoice: withItems ?? invoice }
}
