import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'

export const getInventory = async (clinicId: string) => {
  return prisma.inventoryItem.findMany({
    where: { clinicId },
    include: { product: true },
  })
}

export const getInventoryByProductId = async (productId: string, clinicId: string) => {
  const item = await prisma.inventoryItem.findFirst({
    where: { productId, clinicId },
    include: { product: true },
  })
  if (!item) {
    const err = new Error('Inventory item not found') as ApiError
    err.statusCode = 404
    throw err
  }
  return item
}

export interface AdjustInventoryInput {
  quantityInStock?: number
  reorderThreshold?: number
  supplier?: string
  batchNumber?: string
  expiryDate?: Date
  storageLocation?: string
}

export const adjustInventory = async (
  productId: string,
  clinicId: string,
  input: AdjustInventoryInput
) => {
  const existingProduct = await prisma.product.findFirst({
    where: { id: productId, clinicId },
  })

  if (!existingProduct) {
    const err = new Error('Product not found') as ApiError
    err.statusCode = 404
    throw err
  }

  return prisma.inventoryItem.upsert({
    where: { productId, clinicId },
    create: {
      clinicId,
      productId,
      quantityInStock: input.quantityInStock ?? 0,
      reorderThreshold: input.reorderThreshold,
      supplier: input.supplier,
      batchNumber: input.batchNumber,
      expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
      storageLocation: input.storageLocation,
    },
    update: {
      ...(input.quantityInStock !== undefined && { quantityInStock: input.quantityInStock }),
      ...(input.reorderThreshold !== undefined && { reorderThreshold: input.reorderThreshold }),
      ...(input.supplier !== undefined && { supplier: input.supplier }),
      ...(input.batchNumber !== undefined && { batchNumber: input.batchNumber }),
      ...(input.expiryDate !== undefined && {
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
      }),
      ...(input.storageLocation !== undefined && { storageLocation: input.storageLocation }),
    },
  })
}
