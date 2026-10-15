import prisma from '../config/prisma'
import type { ApiError } from '../types/errors'

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
  description?: string
  sku?: string
  price: number
}

export const createProduct = async (clinicId: string, input: CreateProductInput) => {
  return prisma.product.create({
    data: {
      clinicId,
      name: input.name,
      description: input.description,
      sku: input.sku,
      price: input.price,
    },
  })
}

export interface UpdateProductInput {
  name?: string
  description?: string
  sku?: string
  price?: number
  isActive?: boolean
}

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
