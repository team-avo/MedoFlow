import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'
import type { ProductFulfillmentClass } from '@prisma/client'
import { uniqueEntitySlug } from '../site/services/slugService'

export const getProducts = async (clinicId: string) => {
  return prisma.product.findMany({
    where: { clinicId, isActive: true },
    include: {
      inventoryItem: true,
    },
  })
}

export const getProductById = async (id: string, clinicId: string) => {
  const product = await prisma.product.findFirst({
    where: { id, clinicId },
    include: {
      inventoryItem: true,
    },
  })

  if (!product) {
    const err = new Error('Product not found') as ApiError
    err.statusCode = 404
    throw err
  }

  return product
}

export interface CreateProductInput {
  name: string
  description?: string | null
  sku?: string | null
  price: number
  taxApplicable?: boolean
  /** B5.5: RX_* products are never sold through the cart. */
  fulfillmentClass?: ProductFulfillmentClass
  /** B5.1: other names the Rx→Cart mapper should recognise. */
  aliases?: string[]
}

export const createProduct = async (clinicId: string, input: CreateProductInput) => {
  return prisma.product.create({
    data: {
      clinicId,
      name: input.name,
      slug: await uniqueEntitySlug('product', clinicId, input.name),
      description: input.description,
      sku: input.sku,
      price: input.price,
      taxApplicable: input.taxApplicable,
      fulfillmentClass: input.fulfillmentClass,
      aliases: input.aliases,
    },
  })
}

export type UpdateProductInput = Partial<CreateProductInput> & { isActive?: boolean }

export const updateProduct = async (id: string, clinicId: string, input: UpdateProductInput) => {
  const existing = await prisma.product.findFirst({
    where: { id, clinicId },
  })

  if (!existing) {
    const err = new Error('Product not found') as ApiError
    err.statusCode = 404
    throw err
  }

  return prisma.product.update({
    where: { id, clinicId },
    data: input,
  })
}

export const deleteProduct = async (id: string, clinicId: string) => {
  const existing = await prisma.product.findFirst({
    where: { id, clinicId },
  })

  if (!existing) {
    const err = new Error('Product not found') as ApiError
    err.statusCode = 404
    throw err
  }

  // Soft delete
  return prisma.product.update({
    where: { id, clinicId },
    data: { isActive: false },
  })
}
