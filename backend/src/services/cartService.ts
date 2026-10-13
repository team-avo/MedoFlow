import prisma from '../config/prisma'
import { ApiError } from '../types/errors'
import { CartItemType, CartStatus, PaymentStatus, Prisma, SubscriptionStatus } from '@prisma/client'

import stripe from '../config/stripe'
import { recalculateInvoiceTotals } from './invoiceService'
import * as commissionService from './commissionService'

const unsupportedMembershipError = () => {
  const err = new Error(
    'Membership checkout is not enabled. Sell memberships only after Stripe subscription linkage is implemented.'
  ) as ApiError
  err.statusCode = 400
  err.code = 'membership_checkout_unsupported'
  return err
}

export const getOrCreateCart = async (clinicId: string, patientId: string) => {
  let cart = await prisma.cart.findFirst({
    where: { clinicId, patientId, status: 'ACTIVE' },
    include: {
      items: {
        include: { service: true, product: true, package: true, membership: true },
      },
    },
  })

  if (!cart) {
    cart = await prisma.cart.create({
      data: { clinicId, patientId, status: 'ACTIVE' },
      include: {
        items: {
          include: { service: true, product: true, package: true, membership: true },
        },
      },
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

export const addToCart = async (clinicId: string, patientId: string, input: AddCartItemInput) => {
  const cart = await getOrCreateCart(clinicId, patientId)

  let unitPrice = new Prisma.Decimal(0)

  // Tenant-safety: look up the item constrained by the caller's clinicId.
  // Without this filter a patient of clinic A could add clinic B's item to
  // their cart by guessing its id.
  if (input.itemType === 'PRODUCT') {
    const product = await prisma.product.findFirst({ where: { id: input.itemId, clinicId } })
    if (!product) {
      const err = new Error('Product not found') as ApiError
      err.statusCode = 404
      throw err
    }
    unitPrice = product.price
  } else if (input.itemType === 'SERVICE') {
    const service = await prisma.service.findFirst({ where: { id: input.itemId, clinicId } })
    if (!service) {
      const err = new Error('Service not found') as ApiError
      err.statusCode = 404
      throw err
    }
    unitPrice = service.defaultPrice
  } else if (input.itemType === 'PACKAGE') {
    const pkg = await prisma.package.findFirst({ where: { id: input.itemId, clinicId } })
    if (!pkg) {
      const err = new Error('Package not found') as ApiError
      err.statusCode = 404
      throw err
    }
    unitPrice = pkg.price
  } else if (input.itemType === 'MEMBERSHIP') {
    throw unsupportedMembershipError()
  }

  // Check if item already exists in cart (based on itemId)
  const existingItem = await prisma.cartItem.findFirst({
    where: {
      cartId: cart.id,
      itemType: input.itemType,
      ...(input.itemType === 'PRODUCT' ? { productId: input.itemId } : {}),
      ...(input.itemType === 'SERVICE' ? { serviceId: input.itemId } : {}),
      ...(input.itemType === 'PACKAGE' ? { packageId: input.itemId } : {}),
    },
  })

  if (existingItem) {
    return prisma.cartItem.update({
      where: { id: existingItem.id },
      data: { quantity: existingItem.quantity + (input.quantity || 1) },
    })
  }

  return prisma.cartItem.create({
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
}

export const updateCartItem = async (cartId: string, itemId: string, quantity: number) => {
  if (quantity <= 0) {
    return prisma.cartItem.delete({ where: { id: itemId } })
  }

  return prisma.cartItem.update({
    where: { id: itemId },
    data: { quantity },
  })
}

export const removeCartItem = async (cartId: string, itemId: string) => {
  return prisma.cartItem.delete({ where: { id: itemId } })
}

export const clearCart = async (cartId: string) => {
  return prisma.cartItem.deleteMany({ where: { cartId } })
}

export const checkoutCart = async (clinicId: string, patientId: string) => {
  const cart = await prisma.cart.findFirst({
    where: { clinicId, patientId, status: 'ACTIVE' },
    include: { items: true },
  })

  if (!cart || cart.items.length === 0) {
    const err = new Error('Cart is empty or not found') as ApiError
    err.statusCode = 400
    throw err
  }

  if (cart.items.some((item) => item.itemType === 'MEMBERSHIP')) {
    throw unsupportedMembershipError()
  }

  let totalAmount = new Prisma.Decimal(0)
  for (const item of cart.items) {
    totalAmount = totalAmount.plus(item.unitPrice.times(item.quantity))
  }

  // Find a fallback provider since the database requires providerId on Invoices
  // In a retail/cart context, we assign the first active provider of the clinic.
  const fallbackProvider = await prisma.provider.findFirst({
    where: { clinicId, isActive: true },
    select: { id: true },
  })

  if (!fallbackProvider) {
    const err = new Error('No active provider found for this clinic to assign billing') as ApiError
    err.statusCode = 400
    throw err
  }

  // Create an invoice from the cart
  const invoice = await prisma.invoice.create({
    data: {
      clinicId,
      patientId,
      providerId: fallbackProvider.id,
      locationId: null,
      status: 'DRAFT',
      subtotal: totalAmount,
      taxAmount: 0,
      totalAmount,
      items: {
        create: cart.items.map((item) => ({
          serviceId: item.serviceId,
          productId: item.productId,
          packageId: item.packageId,
          membershipId: item.membershipId,
          providerId: fallbackProvider.id,
          description: `Cart Item: ${item.itemType}`,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          totalPrice: item.unitPrice.times(item.quantity),
        })),
      },
    },
  })

  // Calculate tax and update invoice totals
  await recalculateInvoiceTotals(invoice.id)

  // Re-fetch invoice to get updated amounts for Stripe
  const updatedInvoice = await prisma.invoice.findUnique({
    where: { id: invoice.id, clinicId },
  })

  if (!updatedInvoice) throw new Error('Failed to retrieve updated invoice')

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
          providerId: fallbackProvider.id,
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
    const apiError = new Error('Unable to start checkout payment') as ApiError
    apiError.statusCode = 502
    apiError.code = 'payment_intent_failed'
    throw apiError
  }

  return {
    invoice: updatedInvoice,
    clientSecret,
  }
}

export const demoCheckoutCart = async (clinicId: string, patientId: string) => {
  const cart = await prisma.cart.findFirst({
    where: { clinicId, patientId, status: 'ACTIVE' },
    include: { items: true },
  })

  if (!cart || cart.items.length === 0) {
    const err = new Error('Cart is empty or not found') as ApiError
    err.statusCode = 400
    throw err
  }

  let totalAmount = new Prisma.Decimal(0)
  for (const item of cart.items) {
    totalAmount = totalAmount.plus(item.unitPrice.times(item.quantity))
  }

  // Find a fallback provider since the database requires providerId on Invoices
  const fallbackProvider = await prisma.provider.findFirst({
    where: { clinicId, isActive: true },
    select: { id: true },
  })

  if (!fallbackProvider) {
    const err = new Error('No active provider found for this clinic to assign billing') as ApiError
    err.statusCode = 400
    throw err
  }

  // Create a PAID invoice
  const invoice = await prisma.invoice.create({
    data: {
      clinicId,
      patientId,
      providerId: fallbackProvider.id,
      locationId: null,
      appointmentId: null,
      status: 'PAID',
      subtotal: totalAmount,
      taxAmount: 0,
      totalAmount,
      items: {
        create: cart.items.map((item) => ({
          serviceId: item.serviceId,
          productId: item.productId,
          packageId: item.packageId,
          membershipId: item.membershipId,
          providerId: fallbackProvider.id,
          disciplineId: null,
          description: `Demo Cart Item: ${item.itemType}`,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          totalPrice: item.unitPrice.times(item.quantity),
        })),
      },
    },
    include: { items: true },
  })

  // Create a PAID payment record
  await prisma.payment.create({
    data: {
      clinicId,
      invoiceId: invoice.id,
      patientId,
      providerId: fallbackProvider.id,
      appointmentId: null,
      amount: totalAmount,
      status: PaymentStatus.PAID,
      paymentChannel: 'DEMO',
      paymentMethod: 'DEMO_MODE',
      recordedAt: new Date(),
    },
  })

  // Create a PAID payment record
  await prisma.payment.create({
    data: {
      clinicId,
      invoiceId: invoice.id,
      patientId,
      providerId: null,
      appointmentId: null,
      amount: totalAmount,
      status: PaymentStatus.PAID,
      paymentChannel: 'DEMO',
      paymentMethod: 'DEMO_MODE',
      recordedAt: new Date(),
    },
  })

  // Fulfill items
  for (const item of cart.items) {
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

  return { invoice }
}
